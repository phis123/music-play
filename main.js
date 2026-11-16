// music-play · 主进程
const { app, BrowserWindow, ipcMain, dialog, screen, globalShortcut, Tray, Menu, nativeImage, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises

// 兼容受管目录 / 低完整性级别启动：若默认 %APPDATA%\music-play 不可写，自动回退到程序旁 userdata 目录
;(function ensureWritablePaths() {
  try {
    const defDir = app.getPath('userData')
    fs.mkdirSync(defDir, { recursive: true })
    const probe = path.join(defDir, '._wprobe')
    fs.writeFileSync(probe, '1')
    fs.unlinkSync(probe)
  } catch {
    try {
      const baseDir = path.join(path.dirname(process.execPath), 'userdata')
      const sessDir = path.join(baseDir, 'session')
      const tmpDir = path.join(baseDir, 'temp')
      fs.mkdirSync(sessDir, { recursive: true })
      fs.mkdirSync(tmpDir, { recursive: true })
      app.setPath('userData', baseDir)
      app.setPath('sessionData', sessDir)
      app.setPath('temp', tmpDir)
      process.env.TEMP = tmpDir
      process.env.TMP = tmpDir
    } catch { }
  }
})()

const netapi = require('./netapi')
const { parseLrc } = require('./lib/lrc')

const AUDIO_EXT = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.opus'])
// ---------- 曲库扫描性能（P1-4）：有限并发 + 增量缓存 + 进度/取消 ----------
// SCAN_CONCURRENCY = 4：music-metadata 的 parseFile 以磁盘 I/O + 标签解码为主，
// 4 路并行已能填满磁盘顺序读的空闲；再高（8+）在机械硬盘 / 低配机上只会加剧
// 随机 I/O 与内存占用（每路各持一份解析缓冲），收益递减且可能拖慢前台播放。
// 如需调优只改这一个常量。
const SCAN_CONCURRENCY = 4
const SCAN_MAX_TRACKS = 5000
const SCAN_CACHE_FILE = 'scan-cache.json'
const SCAN_CACHE_VERSION = 1
// 由渲染层“取消”按钮经 'library:scan-cancel' 置位；扫描在每批处理间隙检查。
let scanCancelRequested = false

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
// 此前这里是作者本机绝对路径，已移除：新安装不应默认指向
// 一个不存在的个人目录，否则首次启动会静默空库。已有 user-config.json
// 或 MUSIC_ROOT 时仍优先使用它们；用户也可随时用“选择目录”更改。
const DEFAULT_ROOT = process.env.MUSIC_ROOT || app.getPath('music')

let win = null
let root = DEFAULT_ROOT

// ---------- IPC 路径边界校验（P0-2） ----------
// 渲染层被注入时，IPC 传入的任意路径都不可信：所有读写删 handler 只允许
// 操作「用户明确授权过的目录」内的文件。授权目录 = 当前曲库根 + 用户经
// 系统对话框（dialog:pickFolder）或 library:scan 明确选过的目录（只增不减，
// 避免多目录场景下换过曲库根后旧曲库的收藏/删歌被误伤）。集中校验，不重构各 handler。
const authorizedDirs = new Set()

// Windows 下路径比较不区分大小写；POSIX 保持原样。
function _normForCompare(p) {
  return process.platform === 'win32' ? String(p).toLowerCase() : String(p)
}

// 解析符号链接，返回规范路径。目标不存在时逐级向上找存在的父目录解析后再拼回。
function _canonicalize(p) {
  const abs = path.resolve(p)
  try {
    return fs.realpathSync(abs)
  } catch {
    let cur = abs
    const rest = []
    for (;;) {
      const parent = path.dirname(cur)
      if (parent === cur) return abs // 已到文件系统根，仍无存在的祖先
      rest.unshift(path.basename(cur))
      cur = parent
      try {
        return path.join(fs.realpathSync(cur), ...rest)
      } catch { /* 继续向上找存在的祖先 */ }
    }
  }
}

function _isInside(dir, file) {
  const d = _normForCompare(path.resolve(dir))
  const f = _normForCompare(file)
  return f === d || f.startsWith(d + path.sep)
}

// 把目录加入授权集合（先规范化，目录本身是符号链接时也按真实目标授权）。
function authorizeDir(dir) {
  if (typeof dir !== 'string' || !dir) return
  try {
    authorizedDirs.add(_canonicalize(dir))
  } catch { /* 授权失败时不抛错，调用方仍按原流程返回 */ }
}

// 在授权目录内则返回规范化后的路径，否则抛错（错误信息不含绝对路径）。
// allowUserData：同时允许 app.getPath('userData') 内路径（供内部写配置/缓存类
// 场景复用；本次没有任何 handler 开启）。
function assertInsideLibrary(filePath, { allowUserData = false } = {}) {
  if (typeof filePath !== 'string' || !filePath) {
    throw Object.assign(new Error('PATH_OUTSIDE_LIBRARY：路径不在曲库授权目录内'), { code: 'PATH_OUTSIDE_LIBRARY' })
  }
  const resolved = _canonicalize(filePath)
  for (const dir of authorizedDirs) {
    if (_isInside(dir, resolved)) return resolved
  }
  if (allowUserData) {
    try {
      if (_isInside(_canonicalize(app.getPath('userData')), resolved)) return resolved
    } catch { /* 取不到 userData 路径时按越界处理 */ }
  }
  throw Object.assign(new Error('PATH_OUTSIDE_LIBRARY：路径不在曲库授权目录内'), { code: 'PATH_OUTSIDE_LIBRARY' })
}

// 不抛错的版本，供“派生路径”（同目录 .lrc/.jpg）复查：返回是否在库内。
function isInsideLibrary(filePath) {
  try {
    assertInsideLibrary(filePath)
    return true
  } catch {
    return false
  }
}

// 默认曲库根即授权目录；配置里的 root 在 loadUserConfig 采用时再追加授权。
authorizeDir(root)

function cfgPath() {
  return path.join(app.getPath('userData'), 'user-config.json')
}
function loadUserConfig() {
  try {
    const f = cfgPath()
    if (fs.existsSync(f)) {
      const cfg = JSON.parse(fs.readFileSync(f, 'utf8'))
      if (cfg && cfg.root && fs.existsSync(cfg.root)) {
        root = cfg.root
        authorizeDir(cfg.root)
        return cfg
      }
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

// ---------- 单实例锁：重复双击只聚焦已有窗口，不再起第二个 ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
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

async function walk(dir, out, depth = 0) {
  if (depth > 8) return
  let ents
  try { ents = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await walk(p, out, depth + 1)
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) out.push(p)
  }
}

// ---------- LRC 解析：同时间戳（±30ms）相邻两行 → 原文/译文配对 ----------
// 实现在 lib/lrc.js（纯函数，可在 plain node 里测试），此处只引用，不改行为。

ipcMain.handle('library:scan', async (_e, dir) => {
  if (!dir) loadUserConfig()
  const target = dir || root
  // dir 必须存在且为目录，否则拒绝并保留旧 root（不持久化、不改 root）
  let st = null
  try { st = fs.statSync(target) } catch { st = null }
  if (!st || !st.isDirectory()) {
    return { root, tracks: [], error: 'PATH_INVALID：目录不存在或不是目录' }
  }
  root = target
  authorizeDir(target)
  if (dir) saveUserConfig({ root: target })
  scanCancelRequested = false
  const sender = _e && _e.sender
  const sendProgress = (p) => {
    try { if (sender && !sender.isDestroyed()) sender.send('library:scan-progress', p) } catch { /* 渲染进程已关不影响扫描 */ }
  }
  const files = []
  await walk(target, files)
  // 不再静默截断：仍只返回前 5000 首（渲染层一次承载上限不变），但把总数与
  // 截断标志一并返回，渲染层据此提示用户。
  const total = files.length
  const truncated = total > SCAN_MAX_TRACKS
  const limited = files.slice(0, SCAN_MAX_TRACKS)
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
      newCache[f] = { size: stat.size, mtimeMs: stat.mtimeMs, title: c.title, artist: c.artist, album: c.album, duration: c.duration, bitrate: c.bitrate, hasLrc }
      return { path: f, title: c.title, artist: c.artist, album: c.album, duration: c.duration, bitrate: c.bitrate, hasLrc }
    }
    let title = path.basename(f, path.extname(f))
    let artist = '', album = '', duration = 0, bitrate = 0
    if (mm) {
      try {
        const meta = await mm.parseFile(f, { duration: true, skipCovers: true })
        title = meta.common.title || title
        artist = meta.common.artist || ''
        album = meta.common.album || ''
        duration = meta.format.duration || 0
        bitrate = Math.round((meta.format.bitrate || 0) / 1000)
      } catch { /* 退回文件名 */ }
    }
    // 没有标签时用文件名兜底
    if (!artist || title === path.basename(f, path.extname(f))) {
      const g = parseName(path.basename(f, path.extname(f)))
      if (g.artist) { title = g.title; artist = g.artist }
    }
    if (stat) newCache[f] = { size: stat.size, mtimeMs: stat.mtimeMs, title, artist, album, duration, bitrate, hasLrc }
    return { path: f, title, artist, album, duration, bitrate, hasLrc }
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
  // 只保留本次扫描到的文件条目（已删除文件的旧缓存随之丢弃，避免缓存文件无界增长）；
  // 取消时只保存已处理部分的条目，未处理文件下次重新解析。
  saveScanCache(newCache)
  tracks.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  return { root: target, tracks, total, truncated, cancelled: scanCancelRequested }
})

ipcMain.on('library:scan-cancel', () => { scanCancelRequested = true })

ipcMain.handle('lyrics:get', async (_e, filePath) => {
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
})


// ---------- 封面（带缓存，按需取） ----------
const coverCache = new Map()
const fileUrl = (p) => 'file:///' + encodeURI(String(p).replace(/\\/g, '/'))

ipcMain.handle('cover:get', async (_e, filePath) => {
  // 越界路径按“无封面”处理，不泄露路径信息
  try { filePath = assertInsideLibrary(filePath) } catch { return '' }
  if (coverCache.has(filePath)) return coverCache.get(filePath)
  // 优先用侧车高清封面（下载时写的 .jpg）
  const sideCover = filePath.replace(/\.[^.]+$/, '') + '.jpg'
  if (fs.existsSync(sideCover) && isInsideLibrary(sideCover)) { // 侧车封面是库外符号链接时不跟随读取
    const u = fileUrl(sideCover)
    coverCache.set(filePath, u)
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
  coverCache.set(filePath, url)
  return url
})

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  if (r.canceled) return null
  authorizeDir(r.filePaths[0])
  return r.filePaths[0]
})

// ---------- 内置网易云 API ----------
ipcMain.handle('net:songs', async (_e, kw) => netapi.searchSongs(kw))
ipcMain.handle('net:voices', async (_e, payload) => {
  // payload 可以是字符串（播客 tab）或 { name, artist }（选中歌曲后找声音）
  if (typeof payload === 'string') return netapi.searchVoicesSmart(payload, '')
  return netapi.searchVoicesSmart(payload.name, payload.artist, payload.duration || 0)
})
ipcMain.handle('lyrics:auto', async (_e, { title, artist, filePath }) => {
  try {
    const r = await netapi.autoLyric({ title, artist })
    if (!r.ok) return { ok: false, reason: r.reason }
    // 写旁挂歌词，下次直接命中
    if (filePath) {
      let side = ''
      try {
        side = assertInsideLibrary(filePath).replace(/\.[^.]+$/, '') + '.lrc'
      } catch {
        return { ok: false, reason: 'PATH_OUTSIDE_LIBRARY：路径不在曲库授权目录内' }
      }
      try { fs.writeFileSync(side, r.text, 'utf8') }
      catch (e) { return { ok: false, reason: 'WRITE_FAILED' + (e.code ? '(' + e.code + ')' : '') + '：写入歌词文件失败' } }
    }
    const lines = parseLrc(r.text.replace(/^\uFEFF/, ''))
    return { ok: lines.length > 0, lines, song: r.song, paired: lines.filter((l) => l.pair).length }
  } catch (e) {
    return { ok: false, reason: String(e.message || e) }
  }
})

ipcMain.handle('net:playlist', async (_e, id) => netapi.playlistSongs(id))
ipcMain.handle('net:songDetail', async (_e, id) => netapi.songDetail(id))

ipcMain.handle('net:preview', async (_e, trackId) => netapi.trackUrl(trackId))
ipcMain.handle('net:download', async (_e, payload) => {
  // 覆盖目标必须在库内才传给 downloadVoice；越界时抛错，渲染层按下载失败处理
  if (payload && payload.targetPath) assertInsideLibrary(payload.targetPath)
  return netapi.downloadVoice({ ...payload, dir: root })
})
ipcMain.handle('net:replaceSource', async (_e, payload) => {
  // 同上：覆盖目标必须在库内
  if (payload && payload.targetPath) assertInsideLibrary(payload.targetPath)
  const res = await netapi.downloadVoice({
    voice: payload.voice,
    song: payload.song,
    overwritePath: payload.targetPath,
    dir: root,
  })
  if (payload.targetPath) coverCache.delete(payload.targetPath)
  return res
})


// ---------- 收藏（复制到「我喜欢的音乐」文件夹） ----------
const FAV_DIR_NAME = '我喜欢的音乐'
ipcMain.handle('lib:fav', async (_e, { filePath, on }) => {
  try {
    // 收藏是“复制源文件进收藏目录”：源文件必须在库内（目标端原有 path.basename 保留）
    if (on) assertInsideLibrary(filePath)
    const dir = path.join(root, FAV_DIR_NAME)
    await fsp.mkdir(dir, { recursive: true })
    const dst = path.join(dir, path.basename(filePath))
    const srcLrc = filePath.replace(/\.[^.]+$/, '.lrc')
    const dstLrc = dst.replace(/\.[^.]+$/, '.lrc')
    if (on) {
      if (!fs.existsSync(dst)) await fsp.copyFile(filePath, dst)
      if (fs.existsSync(srcLrc) && isInsideLibrary(srcLrc) && !fs.existsSync(dstLrc)) await fsp.copyFile(srcLrc, dstLrc)
      return { ok: true, file: dst }
    }
    if (fs.existsSync(dst)) await fsp.unlink(dst)
    if (fs.existsSync(dstLrc)) await fsp.unlink(dstLrc)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e.message || e) }
  }
})

ipcMain.handle('lib:coverFix', async (_e, tracks) => {
  const list = Array.isArray(tracks) ? tracks.slice(0, 60) : []
  let done = 0, skipped = 0
  const errors = []
  for (const t of list) {
    // 越界曲目不写盘，记入 errors（不中断其余曲目）
    let trackPath = ''
    try { trackPath = assertInsideLibrary(t.path) } catch {
      errors.push({ name: t.title || t.path, reason: 'PATH_OUTSIDE_LIBRARY：路径不在曲库授权目录内' })
      continue
    }
    const side = trackPath.replace(/\.[^.]+$/, '') + '.jpg'
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
})

ipcMain.handle('lib:delete', async (_e, filePath) => {
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
})

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  root,
}))

// ---------- 无边框窗口控制 ----------
ipcMain.on('win:minimize', () => win && win.minimize())
ipcMain.on('win:toggle-max', () => {
  if (!win) return
  win.isMaximized() ? win.unmaximize() : win.maximize()
})
ipcMain.on('win:close', () => win && win.close())



// ---------- 托盘（锁定后的保底解锁入口） ----------
const TRAY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAyUlEQVR4nO2X0Q2DMAxEnVM3aBeCwWGhMgNVPyIBjZ04tRMkuL8o+N6ZSMEQdVbQFryHYZX2X/Os8gxW4NogwRqsDQJPeIkHPOElXvCG5zzRAi55oxWcY0Br8Jymqj1O4JJJgBRI2jtqywJ1FrTdp9bSHqfIBHUW7gB0H8HVj+ARhwbr7wB3FyzjuBtUUGoYC7l1rVA7TP6jLQuawti1Vfdf/XTtPRMc3zRyD3jCkwG8QnCe0BZYwsUAViFyHuH0v2akDNLyPjHRB4+YZ9o9UTaiAAAAAElFTkSuQmCC'
let tray = null

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: floatWin ? '关闭悬浮歌词' : '打开悬浮歌词',
      click: () => {
        if (floatWin) { floatWin.close(); floatWin = null }
        else { createFloatWindow(); setTimeout(() => { if (win) win.webContents.send('float:opened') }, 300) }
      },
    },
    {
      label: floatLocked ? '解锁悬浮歌词（鼠标可点）' : '锁定悬浮歌词（鼠标穿透）',
      enabled: !!floatWin,
      click: () => setFloatLock(!floatLocked),
    },
    { type: 'separator' },
    { label: '显示主窗口', click: () => { if (win) { win.show(); win.focus() } } },
    { type: 'separator' },
    { label: '退出 music-play', click: () => app.quit() },
  ])
}

function createTray() {
  try {
    const icon = nativeImage.createFromDataURL(TRAY_PNG)
    tray = new Tray(icon)
    tray.setToolTip('music-play 悬浮歌词')
    tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()))
    tray.on('double-click', () => {
      if (!floatWin) { createFloatWindow(); return }
      setFloatLock(!floatLocked)          // 双击托盘：快速切锁定
    })
  } catch (e) {
    // 托盘不可用不影响主功能
  }
}

// ---------- 解锁快捷键（多候选，注册成功才算数） ----------
let unlockKey = ''
const KEY_CANDIDATES = [
  ['Control+Alt+L', 'Ctrl+Alt+L'],
  ['Control+Alt+U', 'Ctrl+Alt+U'],
  ['Control+Shift+L', 'Ctrl+Shift+L'],
  ['Alt+Shift+L', 'Alt+Shift+L'],
]

function registerUnlockShortcut() {
  for (const [acc, label] of KEY_CANDIDATES) {
    try {
      if (globalShortcut.register(acc, () => setFloatLock(!floatLocked))) {
        unlockKey = label
        return
      }
    } catch { /* 下一个 */ }
  }
  unlockKey = '托盘图标右键'
}

// ---------- 悬浮歌词窗 ----------
let floatWin = null

function createFloatWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const w = 900, h = 200
  floatWin = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round((width - w) / 2),
    y: height - h - 80,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    hasShadow: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  try { if (!tray) createTray() } catch { }
  floatWin.setAlwaysOnTop(true, 'screen-saver')
  floatWin.setVisibleOnAllWorkspaces(true)
  floatWin.loadFile(path.join(__dirname, 'renderer', 'float.html'))
  floatWin.webContents.on('did-finish-load', () => {
    if (floatWin && !floatWin.isDestroyed()) {
      floatWin.webContents.send('float:keyinfo', { key: unlockKey, locked: floatLocked })
    }
  })
  floatWin.on('closed', () => {
    floatWin = null
    floatLocked = false
    try { if (tray) { tray.destroy(); tray = null } } catch { }
  })
  return floatWin
}

ipcMain.handle('float:toggle', () => {
  if (floatWin) { floatWin.close(); floatWin = null; return false }
  createFloatWindow()
  return true
})
ipcMain.handle('float:isOpen', () => !!floatWin)
ipcMain.on('float:push', (_e, payload) => {
  if (floatWin && !floatWin.isDestroyed()) floatWin.webContents.send('float:update', payload)
})
ipcMain.on('float:lock', (_e, locked) => setFloatLock(locked))
ipcMain.on('float:menu', () => {
  buildTrayMenu().popup({ window: win || undefined })
})
ipcMain.on('float:cmd', (_e, cmd) => {
  if (win && !win.isDestroyed()) win.webContents.send('player:cmd', cmd)
})
ipcMain.on('float:close', () => {
  if (floatWin && !floatWin.isDestroyed()) floatWin.close()
})
ipcMain.on('float:resize', (_e, h) => {
  if (floatWin && !floatWin.isDestroyed()) {
    const b = floatWin.getBounds()
    floatWin.setBounds({ x: b.x, y: b.y + (b.height - h), width: b.width, height: h })
  }
})

function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.ico')
  win = new BrowserWindow({
    width: 1200, height: 780,
    minWidth: 960, minHeight: 620,
    frame: false,
    backgroundColor: '#ffffff',
    show: false,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => win.show())
  // 主窗关闭时一并关掉悬浮歌词，避免留下幽灵窗口
  win.on('closed', () => {
    if (floatWin && !floatWin.isDestroyed()) floatWin.close()
    win = null
  })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

let floatLocked = false
function setFloatLock(locked) {
  floatLocked = !!locked
  if (floatWin && !floatWin.isDestroyed()) {
    floatWin.setIgnoreMouseEvents(floatLocked, { forward: true })
    floatWin.webContents.send('float:locked', floatLocked)
  }
}

app.whenReady().then(() => {
  createWindow()
  registerUnlockShortcut()
  netapi.ensureServer().catch((e) => console.warn('[ncm] 启动失败:', e.message))
})
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  try { if (tray) { tray.destroy(); tray = null } } catch { }
})
app.on('second-instance', () => {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
})

app.on('window-all-closed', () => app.quit())
