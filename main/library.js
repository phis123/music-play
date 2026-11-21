'use strict'
/**
 * main/library.js — 曲库域：扫描（含增量缓存与代际取消）、封面、收藏、删除、用户配置
 *
 * 安全边界：所有路径操作一律经过 lib/path-guard.js 的 assertInsideLibrary /
 * assertSafeWriteTarget（此处包装成带 userDataDir 的版本），不新增任何绕过入口。
 * library:scan 的 dir 必须已在授权集合内（新目录唯一入口是 dialog:pickFolder）。
 */
const { app, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const { parseLrc } = require('../lib/lrc')
const { estimateFileGainDbSync } = require('../lib/loudness')
const {
  authorizeDir,
  assertInsideLibrary: _assertInsideLib,
  isInsideLibrary,
  assertSafeWriteTarget: _assertSafeWrite,
} = require('../lib/path-guard')
const { pathToFileURL } = require('url')
const netapi = require('../netapi')
const windows = require('./windows')

// ---------- 路径校验包装 ----------
const assertInsideLibrary = (filePath, opts = {}) => _assertInsideLib(filePath, {
  ...opts,
  userDataDir: opts && opts.allowUserData ? app.getPath('userData') : '',
})
const assertSafeWriteTarget = (filePath, opts = {}) => _assertSafeWrite(filePath, {
  ...opts,
  userDataDir: opts && opts.allowUserData ? app.getPath('userData') : '',
})

const fileUrl = (p) => pathToFileURL(path.resolve(String(p))).href

// 曲库扫描核心逻辑已下沉到 ./lib/library-scan.js（纯函数 + 注入 readdir），此处只保留
// 常量来源与 fs 接线，保证 `library:scan` 对外行为不变。
const {
  DEFAULT_AUDIO_EXTS,
  MAX_SCAN_DEPTH,
  DEFAULT_SCAN_MAX_TRACKS,
  collectAudioFiles,
  applyTruncation,
  mergeScanGen,
  acceptScanCancel,
  sortTracksByTitle,
} = require('../lib/library-scan')
const AUDIO_EXT = new Set(DEFAULT_AUDIO_EXTS)

// ---------- 曲库扫描性能（P1-4）：有限并发 + 增量缓存 + 进度/取消 ----------
// SCAN_CONCURRENCY = 4：music-metadata 的 parseFile 以磁盘 I/O + 标签解码为主，
// 4 路并行已能填满磁盘顺序读的空闲；再高（8+）在机械硬盘 / 低配机上只会加剧
// 随机 I/O 与内存占用（每路各持一份解析缓冲），收益递减且可能拖慢前台播放。
// 如需调优只改这一个常量。
const SCAN_CONCURRENCY = 4
const SCAN_MAX_TRACKS = DEFAULT_SCAN_MAX_TRACKS
const SCAN_CACHE_FILE = 'scan-cache.json'
const SCAN_CACHE_VERSION = 2
// 由渲染层“取消”按钮经 'library:scan-cancel' 置位；扫描在每批处理间隙检查。
let scanCancelRequested = false
/** 每次扫描的代际号：并发/重叠扫描时旧扫描不会误清新扫描的取消标志 */
let scanGen = 0

function scanCachePath() {
  return path.join(app.getPath('userData'), SCAN_CACHE_FILE)
}
// 增量缓存：{ [绝对路径]: { size, mtimeMs, title, artist, album, duration, bitrate, hasLrc } }
// 读写失败一律降级为空缓存 / 跳过写盘，绝不因此让扫描失败。
function loadScanCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(scanCachePath(), 'utf8'))
    if (raw && raw.version === SCAN_CACHE_VERSION && raw.entries && typeof raw.entries === 'object') return raw.entries
  } catch { /* 缓存损坏或不存在：全量扫描 */ }
  return {}
}
function saveScanCache(entries) {
  try {
    fs.mkdirSync(path.dirname(scanCachePath()), { recursive: true })
    fs.writeFileSync(scanCachePath(), JSON.stringify({ version: SCAN_CACHE_VERSION, updatedAt: Date.now(), entries }, null, 2), 'utf8')
  } catch { /* 写缓存失败不影响本次扫描结果 */ }
}

// 有限并发任务队列（手写，不引入新依赖）：limit 个 worker 各自取下一个任务，
// 绝不无上限 Promise.all。shouldStop 由调用方提供，在取下一个任务前检查。
async function runLimited(items, limit, worker, shouldStop) {
  let next = 0
  const runners = Array.from({ length: Math.max(0, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      if (shouldStop && shouldStop()) return
      const item = items[next++]
      try { await worker(item) } catch { /* 单个任务失败不中断整批 */ }
    }
  })
  await Promise.all(runners)
}

// hasLrc 批量比对：每个目录只 readdir 一次，收集全部 .lrc 的“去扩展名小写”集合；
// 某目录 readdir 失败时对该目录回退为逐首 fs.existsSync。
async function buildLrcSets(dirs) {
  const map = new Map()
  for (const dir of dirs) {
    try {
      const names = await fsp.readdir(dir)
      const set = new Set()
      for (const n of names) {
        if (path.extname(n).toLowerCase() === '.lrc') set.add(path.basename(n, '.lrc').toLowerCase())
      }
      map.set(dir, set)
    } catch { /* 该目录缺失比对集合，调用方回退 existsSync */ }
  }
  return map
}

// 默认曲库：优先 MUSIC_ROOT 环境变量，否则用系统音乐目录。
// （历史遗留的作者本机绝对路径已移除，避免新安装默认指向不存在的个人目录。）
const DEFAULT_ROOT = process.env.MUSIC_ROOT ||
  (app && typeof app.getPath === 'function' ? app.getPath('music') : path.join(require('os').homedir(), 'Music'))

let root = DEFAULT_ROOT

// 默认曲库根即授权目录；配置里的 root 在 loadUserConfig 采用时再追加授权（实现在 ./lib/path-guard.js）。
authorizeDir(root)

function cfgPath() {
  return path.join(app.getPath('userData'), 'user-config.json')
}
function hasAudioFilesSync(dir) {
  try {
    const names = fs.readdirSync(dir)
    return names.some((n) => AUDIO_EXT.has(path.extname(n).toLowerCase()))
  } catch {
    return false
  }
}

function loadUserConfig() {
  try {
    const f = cfgPath()
    if (fs.existsSync(f)) {
      const cfg = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (cfg && cfg.root && fs.existsSync(cfg.root)) {
        // 如果之前误存了空的默认 Music 目录，而应用旁边的 resources 目录有歌，则优先自动切回有歌目录
        const siblingRes = path.resolve(__dirname, '..', '..')
        if (cfg.root === DEFAULT_ROOT && !hasAudioFilesSync(cfg.root) && hasAudioFilesSync(siblingRes)) {
          root = siblingRes
          authorizeDir(siblingRes)
          return { ...cfg, root: siblingRes }
        }
        root = cfg.root
        authorizeDir(cfg.root)
        return cfg
      }
    }
    const siblingRes = path.resolve(__dirname, '..', '..')
    if (!hasAudioFilesSync(root) && hasAudioFilesSync(siblingRes)) {
      root = siblingRes
      authorizeDir(siblingRes)
    }
  } catch { }
  return {}
}
function saveUserConfig(patch) {
  try {
    const cur = loadUserConfig()
    const next = { ...cur, ...patch }
    fs.mkdirSync(path.dirname(cfgPath()), { recursive: true })
    fs.writeFileSync(cfgPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch { }
}

function getRoot() {
  return root
}

// music-metadata v10+ 是纯 ESM，只能动态 import
let _mm = null
async function mmModule() {
  if (!_mm) _mm = await import('music-metadata')
  return _mm
}

// 无标签时从文件名猜 标题/歌手：\"001-月光-胡彦斌\" → 月光 / 胡彦斌
function parseName(base) {
  let s = base.replace(/^\d{1,3}\s*[-_.、)\]]\s*/, '')          // 去掉序号
  s = s.replace(/\s*[\[【（(][^\]】）)]*[\]】）)]\s*$/, '').trim() // 去掉结尾方括号标签
  const m = s.match(/^(.*?)\s+-\s+(.+)$/)                        // 优先「 - 」分隔
  if (m && !/\s/.test(m[2]) && m[2].length <= 20) return { title: m[1].trim(), artist: m[2].trim() }
  const one = s.match(/^([^-]{1,60})-([^-]{1,20})$/)              // 无空格单横线
  if (one && one[2].trim().length <= 12) return { title: one[1].trim(), artist: one[2].trim() }
  return { title: s || base, artist: '' }
}

// 目录遍历的判定逻辑在 lib/library-scan.js，这里只把 fs 接进去：
// readdir 用 fsp.readdir，路径拼接用 path.join，深度/上限/扩展名与原实现一致。
function collectAudio(dir) {
  return collectAudioFiles(dir, {
    exts: AUDIO_EXT,
    max: SCAN_MAX_TRACKS,
    maxDepth: MAX_SCAN_DEPTH,
    readdir: (d, opts) => fsp.readdir(d, opts),
    join: (d, name) => path.join(d, name),
  })
}

// ---------- 封面（带 LRU 容量上限缓存，按需取） ----------
const MAX_COVER_CACHE = 240
const coverCache = new Map()
function setCoverCache(k, v) {
  if (coverCache.has(k)) coverCache.delete(k)
  else if (coverCache.size >= MAX_COVER_CACHE) {
    const oldest = coverCache.keys().next().value
    if (oldest !== undefined) coverCache.delete(oldest)
  }
  coverCache.set(k, v)
}
/** 曲目被替换/删除后让缓存失效（net:replaceSource、lib:coverFix、lib:delete 共用） */
function invalidateCover(filePath) {
  coverCache.delete(filePath)
}
function clearCoverCache() {
  coverCache.clear()
}

// ---------- 曲库扫描 ----------
async function handleScan(event, dir) {
  if (!dir) loadUserConfig()
  const target = dir || root
  // dir 必须存在且为目录，否则拒绝并保留旧 root（不持久化、不改 root）
  let st = null
  try { st = fs.statSync(target) } catch { st = null }
  if (!st || !st.isDirectory()) {
    return { root, tracks: [], error: 'PATH_INVALID：目录不存在或不是目录' }
  }
  // 安全：渲染层传来的 dir 不可信，只允许扫描「已授权目录」。
  // 新目录的唯一入口是 dialog:pickFolder（用户显式选择后 authorizeDir）。
  if (dir) {
    let authorized = isInsideLibrary(target)
    if (!authorized) {
      // 兼容：配置里记录的 root 在 loadUserConfig 时已授权，但 dir 往往带尾分隔符/大小写差异
      try {
        const cfgRoot = loadUserConfig() && loadUserConfig().root
        if (cfgRoot && path.resolve(cfgRoot) === path.resolve(target)) authorized = true
      } catch { /* 忽略 */ }
    }
    if (!authorized) {
      return { root, tracks: [], error: 'PATH_NOT_AUTHORIZED：目录未经用户选择授权，请使用「选择目录」' }
    }
  }
  root = target
  authorizeDir(target)
  if (dir) saveUserConfig({ root: target })
  const myGen = ++scanGen
  scanCancelRequested = false
  const sender = event && event.sender
  const sendProgress = (p) => {
    try { if (sender && !sender.isDestroyed()) sender.send('library:scan-progress', p) } catch { /* 渲染进程已关不影响扫描 */ }
  }
  // 遍历阶段只保留前 SCAN_MAX_TRACKS 个路径（控制超大目录内存占用），同时统计真实总数
  const scanned = await collectAudio(target)
  const { tracks: limited, truncated, total } = applyTruncation(scanned.paths, {
    max: SCAN_MAX_TRACKS,
    total: scanned.total,
  })
  const lrcSets = await buildLrcSets([...new Set(limited.map((f) => path.dirname(f)))])
  const hasLrcFor = (f) => {
    const set = lrcSets.get(path.dirname(f))
    if (set) return set.has(path.basename(f, path.extname(f)).toLowerCase())
    const lrcPath = path.join(path.dirname(f), path.basename(f, path.extname(f)) + '.lrc')
    return fs.existsSync(lrcPath)
  }
  const cache = loadScanCache()
  const mm = await mmModule().catch(() => null)
  const tracks = []
  const newCache = {}
  let done = 0
  let lastSent = 0
  const emitProgress = () => {
    lastSent = done
    sendProgress({ phase: 'parse', done, total: limited.length, totalFiles: total, cancelled: scanCancelRequested })
  }
  const parseOne = async (f) => {
    let stat = null
    try { stat = await fsp.stat(f) } catch { /* 取不到 stat 时按缓存未命中处理 */ }
    const hasLrc = hasLrcFor(f)
    // 缓存命中：(path, size, mtimeMs) 全一致才复用，直接跳过 parseFile。
    if (stat && cache[f] && cache[f].size === stat.size && cache[f].mtimeMs === stat.mtimeMs) {
      const c = cache[f]
      const gainDb = typeof c.gainDb === 'number' ? c.gainDb : estimateFileGainDbSync(f)
      newCache[f] = { size: stat.size, mtimeMs: stat.mtimeMs, title: c.title, artist: c.artist, album: c.album, duration: c.duration, bitrate: c.bitrate, hasLrc, gainDb }
      return { path: f, title: c.title, artist: c.artist, album: c.album, duration: c.duration, bitrate: c.bitrate, hasLrc, gainDb }
    }
    let title = path.basename(f, path.extname(f))
    let artist = '', album = '', duration = 0, bitrate = 0, tagGain = null
    if (mm) {
      try {
        const meta = await mm.parseFile(f, { duration: true, skipCovers: true })
        title = meta.common.title || title
        artist = meta.common.artist || ''
        album = meta.common.album || ''
        duration = meta.format.duration || 0
        bitrate = Math.round((meta.format.bitrate || 0) / 1000)
        if (meta.common.replaygain_track_gain) tagGain = meta.common.replaygain_track_gain
      } catch { /* 退回文件名 */ }
    }
    // 没有标签时用文件名兜底
    if (!artist || title === path.basename(f, path.extname(f))) {
      const g = parseName(path.basename(f, path.extname(f)))
      if (g.artist) { title = g.title; artist = g.artist }
    }
    const gainDb = estimateFileGainDbSync(f, tagGain)
    if (stat) newCache[f] = { size: stat.size, mtimeMs: stat.mtimeMs, title, artist, album, duration, bitrate, hasLrc, gainDb }
    return { path: f, title, artist, album, duration, bitrate, hasLrc, gainDb }
  }
  // 有限并发解析；每完成一批（每 10 首或全部完成）推送一次真实进度。
  // 取消只在取下一个任务前检查：在途的最多 SCAN_CONCURRENCY 首会跑完当前解析。
  await runLimited(limited, SCAN_CONCURRENCY, async (f) => {
    const t = await parseOne(f)
    if (t) tracks.push(t)
    done++
    if (done - lastSent >= 10 || done === limited.length) emitProgress()
  }, () => scanCancelRequested)
  if (scanCancelRequested) emitProgress()
  const stillCurrent = mergeScanGen(scanGen, myGen)
  // 只保留本次扫描到的文件条目（已删除文件的旧缓存随之丢弃，避免缓存文件无界增长）；
  // 取消时只保存已处理部分的条目，未处理文件下次重新解析。
  if (stillCurrent) saveScanCache(newCache)
  sortTracksByTitle(tracks)
  return { root: target, tracks, total, truncated, cancelled: scanCancelRequested }
}

/** library:scan-cancel：只取消当前代际；不传则视为取消最新一次扫描 */
function handleScanCancel(gen) {
  if (acceptScanCancel(gen, scanGen)) scanCancelRequested = true
}

// ---------- 歌词（本地侧车 .lrc / 内嵌） ----------
async function handleLyricsGet(filePath) {
  // 越界路径按“无歌词”处理，不泄露路径信息
  try { filePath = assertInsideLibrary(filePath) } catch { return { source: 'none', lines: [], paired: 0 } }
  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  // 多个歌词候选：同名 .lrc 优先，其次常见的双语/翻译后缀
  const names = [
    `${base}.lrc`, `${base}.双语.lrc`, `${base}.双行.lrc`, `${base}.trans.lrc`,
    `${base}.zh.lrc`, `${base}.ja.lrc`, `${base}.bilingual.lrc`,
  ]
  const found = []
  for (const n of names) {
    const fp = path.join(dir, n)
    if (!fs.existsSync(fp)) continue
    if (!isInsideLibrary(fp)) continue // 侧车 .lrc 是库外符号链接时不跟随读取
    try {
      const text = (await fsp.readFile(fp, 'utf8')).replace(/^\uFEFF/, '')
      const lines = parseLrc(text)
      if (lines.length) found.push({ file: n, lines, paired: lines.filter((l) => l.pair).length })
    } catch { /* 跳过损坏文件 */ }
  }
  // 有「原文/译文配对」的优先；否则用第一个能解析的
  const best = found.find((f) => f.paired > 0) || found[0]
  if (best) return { source: 'lrc', file: best.file, lines: best.lines, paired: best.paired }
  try {
    const mm = await mmModule()
    const meta = await mm.parseFile(filePath, { skipCovers: true })
    const embedded = (meta.common.lyrics || []).find(Boolean)
    if (embedded) {
      const lines = parseLrc(embedded)
      if (lines.length) return { source: 'embedded', lines, paired: lines.filter((l) => l.pair).length }
    }
  } catch { /* ignore */ }
  return { source: 'none', lines: [], paired: 0 }
}

// ---------- 封面取用 ----------
async function handleCoverGet(filePath) {
  // 越界路径按“无封面”处理，不泄露路径信息
  try { filePath = assertInsideLibrary(filePath) } catch { return '' }
  if (coverCache.has(filePath)) {
    const hit = coverCache.get(filePath)
    setCoverCache(filePath, hit)
    return hit
  }
  // 优先用侧车高清封面（下载时写的 .jpg）
  const sideCover = filePath.replace(/\.[^.]+$/, '') + '.jpg'
  if (fs.existsSync(sideCover) && isInsideLibrary(sideCover)) { // 侧车封面是库外符号链接时不跟随读取
    const u = fileUrl(sideCover)
    setCoverCache(filePath, u)
    return u
  }
  let url = ''
  try {
    const mm = await mmModule()
    const meta = await mm.parseFile(filePath, { duration: false, skipCovers: false })
    const pic = (meta.common.picture || [])[0]
    if (pic && pic.data) {
      const b64 = Buffer.from(pic.data).toString('base64')
      url = `data:${pic.format || 'image/jpeg'};base64,${b64}`
    }
  } catch { /* 忽略 */ }
  setCoverCache(filePath, url)
  return url
}

// ---------- 目录选择 / 增益 ----------
async function handlePickFolder() {
  const r = await dialog.showOpenDialog(windows.getMainWindow(), { properties: ['openDirectory'] })
  if (r.canceled) return null
  authorizeDir(r.filePaths[0])
  return r.filePaths[0]
}

async function handleAudioGain(filePath) {
  try {
    const checked = assertInsideLibrary(filePath)
    return estimateFileGainDbSync(checked)
  } catch {
    return 0
  }
}

// ---------- 收藏（复制到「我喜欢的音乐」文件夹） ----------
const FAV_DIR_NAME = '我喜欢的音乐'
async function handleFav({ filePath, on }) {
  try {
    // 收藏是“复制源文件进收藏目录”：源文件必须在库内（目标端原有 path.basename 保留）
    const checkedSrc = assertInsideLibrary(filePath)
    const dir = path.join(root, FAV_DIR_NAME)
    await fsp.mkdir(dir, { recursive: true })
    // 收藏目录本身若是指向库外的符号链接/junction，一律拒绝，避免复制或删除落到库外
    if (!isInsideLibrary(dir)) return { ok: false, reason: 'FAV_DIR_OUTSIDE_LIBRARY：收藏目录不在曲库内' }
    const dst = path.join(dir, path.basename(checkedSrc))
    const srcLrc = checkedSrc.replace(/\.[^.]+$/, '.lrc')
    const dstLrc = dst.replace(/\.[^.]+$/, '.lrc')
    // 派生目标做符号链接防护（已存在且指向库外则拒绝）
    let safeDst = dst
    let safeDstLrc = dstLrc
    try { safeDst = assertSafeWriteTarget(dst) } catch { return { ok: false, reason: 'FAV_DST_UNSAFE：收藏目标路径不安全' } }
    try { safeDstLrc = assertSafeWriteTarget(dstLrc) } catch { safeDstLrc = '' }
    if (on) {
      if (!fs.existsSync(safeDst)) await fsp.copyFile(checkedSrc, safeDst)
      if (safeDstLrc && fs.existsSync(srcLrc) && isInsideLibrary(srcLrc) && !fs.existsSync(safeDstLrc)) {
        await fsp.copyFile(srcLrc, safeDstLrc)
      }
      return { ok: true, file: safeDst }
    }
    if (fs.existsSync(safeDst) && isInsideLibrary(safeDst)) await fsp.unlink(safeDst)
    if (safeDstLrc && fs.existsSync(safeDstLrc) && isInsideLibrary(safeDstLrc)) await fsp.unlink(safeDstLrc)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e.message || e) }
  }
}

async function handleCoverFix(tracks) {
  const list = Array.isArray(tracks) ? tracks.slice(0, 60) : []
  let done = 0, skipped = 0
  const errors = []
  for (const t of list) {
    // 越界曲目或派生 .jpg 为符号链接时不写盘，记入 errors（不中断其余曲目）
    let side = ''
    try {
      const trackPath = assertInsideLibrary(t.path)
      side = assertSafeWriteTarget(trackPath.replace(/\.[^.]+$/, '') + '.jpg')
    } catch {
      errors.push({ name: t.title || t.path, reason: 'PATH_OUTSIDE_LIBRARY：路径不在曲库授权目录内' })
      continue
    }
    if (fs.existsSync(side)) { skipped++; continue }
    try {
      const buf = await netapi.coverBuffer({ name: t.title, artist: t.artist, cover: t.cover })
      if (buf && buf.length) {
        fs.writeFileSync(side, buf)
        coverCache.delete(t.path)
        done++
      } else {
        errors.push({ name: t.title || t.path, reason: '未在网易云搜到匹配的高清封面' })
      }
    } catch (e) {
      errors.push({ name: t.title || t.path, reason: String(e.message || e) })
    }
  }
  coverCache.clear()
  return { done, skipped, total: list.length, errors }
}

// 删除文件：扩展名白名单 + 只能删库内文件 + 回收站失败不回退直接删除
async function handleDelete(filePath) {
  try {
    const checked = assertInsideLibrary(filePath)
    const base = checked.replace(/\.[^.]+$/, '')
    const targets = [checked, base + '.lrc', base + '.jpg']
    let removed = 0
    let trashFailed = false
    for (const f of targets) {
      if (!fs.existsSync(f)) continue
      if (!isInsideLibrary(f)) continue // 派生文件是库外符号链接时不删
      try { await shell.trashItem(f); removed++ }
      catch { trashFailed = true /* 回收站失败不再回退直接删除，返回失败让用户知晓 */ }
    }
    coverCache.delete(filePath)
    coverCache.delete(checked)
    if (trashFailed) return { ok: false, reason: 'TRASH_FAILED：移入回收站失败，文件未删除', removed }
    return { ok: true, removed }
  } catch (e) {
    return { ok: false, reason: String(e.message || e) }
  }
}

module.exports = {
  // 配置与根目录
  loadUserConfig,
  saveUserConfig,
  getRoot,
  // 路径校验（供 net.js 复用同一套 userDataDir 语义）
  assertInsideLibrary,
  assertSafeWriteTarget,
  // 封面缓存失效
  invalidateCover,
  clearCoverCache,
  // IPC 业务实现
  handleScan,
  handleScanCancel,
  handleLyricsGet,
  handleCoverGet,
  handlePickFolder,
  handleAudioGain,
  handleFav,
  handleCoverFix,
  handleDelete,
}
