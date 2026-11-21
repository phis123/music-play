// 曲库扫描的纯逻辑（无 Electron / 无 fs 直接依赖，可在 plain node 里单测）。
//
// 背景：`library:scan` 的核心逻辑（扩展名过滤、5000 首上限与截断统计、扫描代际
// 失效、取消判定、标题排序、目录遍历的判定顺序）原先内联在 main.js 的 walk() 与
// ipcMain.handle 里，既无法单测、也要靠 Electron 才能跑起来。这里把它下沉为纯函数，
// 目录遍历的 fs 交互仍留在 main.js —— 通过注入 `readdir` 完成（见 collectAudioFiles）。
//
// 硬约束：对外行为零变化。main.js 用同样的常量、同样的条目顺序、同样的判定规则，
// 因此 `library:scan` 的返回结构 { root, tracks, total, truncated, cancelled }、
// scanGen 代际语义、取消路径全部照旧。
'use strict'

/** 支持的音频扩展名（与 main.js 原 AUDIO_EXT 完全一致，唯一来源） */
const DEFAULT_AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.opus']

/** 目录递归深度上限（原 walk() 的 `depth > 8` 早退） */
const MAX_SCAN_DEPTH = 8

/** 曲库扫描默认上限（原 SCAN_MAX_TRACKS） */
const DEFAULT_SCAN_MAX_TRACKS = 5000

/** 跳过原因（skipped[].reason 的合法取值） */
const SKIP_DIRECTORY = 'directory'
const SKIP_EXT_NOT_ALLOWED = 'ext-not-allowed'
const SKIP_INVALID_ENTRY = 'invalid-entry'

/**
 * 归一化扩展名集合：统一小写、自动补前导点。
 * 传入 Set / 数组 / 单字符串都接受；非法输入回退默认集合。
 * @param {string|string[]|Set<string>} [exts]
 * @returns {Set<string>}
 */
function normalizeExts(exts) {
  if (exts == null) return new Set(DEFAULT_AUDIO_EXTS)
  const list = typeof exts === 'string' ? [exts] : Array.from(exts)
  const out = new Set()
  for (const raw of list) {
    if (typeof raw !== 'string' || !raw.trim()) continue
    const e = raw.trim().toLowerCase()
    out.add(e.startsWith('.') ? e : '.' + e)
  }
  return out.size ? out : new Set(DEFAULT_AUDIO_EXTS)
}

/**
 * 把 fs.Dirent / {name, isDirectory} / 纯文件名归一成内部条目。
 * 兼容 Dirent 的 isDirectory()/isFile() 方法形态与普通布尔字段形态；
 * 只看「是不是目录」，其余（普通文件 / 符号链接 / 未知）都按文件参与扩展名判定，
 * 与旧 walk() 的 `if (isDirectory) 递归 else if (扩展名命中)` 完全一致。
 */
function toEntry(entry) {
  if (typeof entry === 'string') return { name: entry, isDirectory: false }
  if (!entry || typeof entry.name !== 'string') return { name: '', isDirectory: false }
  const isDir = typeof entry.isDirectory === 'function' ? !!entry.isDirectory() : !!entry.isDirectory
  return { name: entry.name, isDirectory: isDir }
}

/** 取小写扩展名（不含目录信息的纯文件名） */
function extOf(name) {
  const s = String(name || '')
  const i = s.lastIndexOf('.')
  return i <= 0 ? '' : s.slice(i).toLowerCase()
}

/**
 * 单条目判定（保序的关键：遍历时逐个条目调用，顺序与旧 walk() 完全一致）。
 * @param {object|string} entry
 * @param {{exts?: string|string[]|Set<string>}} [options]
 * @returns {{name: string, kind: 'audio'|'directory'|'other'|'invalid'}}
 */
function classifyEntry(entry, options) {
  const opts = options || {}
  const exts = normalizeExts(opts.exts)
  const e = toEntry(entry)
  if (!e.name) return { name: '', kind: 'invalid' }
  if (e.isDirectory) return { name: e.name, kind: 'directory' }
  return { name: e.name, kind: exts.has(extOf(e.name)) ? 'audio' : 'other' }
}

/**
 * 整目录批量视图：一次 readdir 结果里哪些是音频文件、哪些被跳过及原因。
 * 注意：`files` 与 `skipped` 各自保序，但两组的相对顺序不保留；需要「先递归子目录再
 * 收文件」这种严格交错顺序时用 classifyEntry 逐条目判定（collectAudioFiles 即如此）。
 * @param {Array<object|string>} entries fs.Dirent[] 或 {name, isDirectory}[]
 * @param {{exts?: string|string[]|Set<string>}} [options]
 * @returns {{files: string[], skipped: Array<{name: string, reason: string}>}}
 */
function pickAudioFiles(entries, options) {
  const opts = options || {}
  const exts = normalizeExts(opts.exts)
  const files = []
  const skipped = []
  for (const raw of Array.isArray(entries) ? entries : []) {
    const c = classifyEntry(raw, { exts })
    if (c.kind === 'audio') files.push(c.name)
    else if (c.kind === 'directory') skipped.push({ name: c.name, reason: SKIP_DIRECTORY })
    else if (c.kind === 'invalid') skipped.push({ name: c.name, reason: SKIP_INVALID_ENTRY })
    else skipped.push({ name: c.name, reason: SKIP_EXT_NOT_ALLOWED })
  }
  return { files, skipped }
}

/**
 * 上限截断：只保留前 max 条，同时报告「真实总数是否超限」。
 * @param {Array} list 已收集的条目（超出 max 的部分不会被保留，但会计入 total）
 * @param {{max?: number, total?: number, gen?: () => Iterable}} [options]
 *   max   —— 上限，缺省 5000；非法/负数视为不限
 *   total —— 已知真实总数（惰性收集时由调用方统计，如 main.js 的 walk 计数）；缺省取 list.length
 *   gen   —— 可选的惰性源工厂，提供时优先于 list（`gen()` 返回任意可迭代对象）
 * @returns {{tracks: Array, truncated: boolean, total: number}}
 */
function applyTruncation(list, options) {
  const opts = options || {}
  const max = Number.isFinite(opts.max) && opts.max >= 0 ? Math.floor(opts.max) : Infinity
  const source = typeof opts.gen === 'function' ? opts.gen() : list
  const items = Array.isArray(source) ? source : Array.from(source || [])
  const total = Number.isInteger(opts.total) && opts.total >= 0 ? opts.total : items.length
  return {
    tracks: max === Infinity ? items.slice() : items.slice(0, max),
    truncated: total > max,
    total,
  }
}

/**
 * 扫描代际失效判定：newGen 是否仍是「当前代际」。
 * main.js 每次扫描都会 `++scanGen` 拿到 myGen；扫描收尾时用它判断自己有没有被
 * 更新的扫描取代——被取代就绝不能写缓存、不能回写 root、进度也不再被采纳。
 * @param {number} prevGen 当前全局代际号
 * @param {number} newGen 本次扫描的代际号
 * @returns {boolean} true = newGen 仍是最新代际（结果有效）；false = 已过期，必须丢弃
 */
function mergeScanGen(prevGen, newGen) {
  const prev = Number.isFinite(prevGen) ? prevGen : -1
  const next = Number.isFinite(newGen) ? newGen : -1
  // 代际号从 1 开始（0 表示「从未扫描」）；小于当前代际即为过期
  return next >= 1 && next >= prev
}

/**
 * 取消请求是否应作用于当前扫描：传了 gen 就只取消该代际，不传视为取消最新一次。
 * @param {number|string|null|undefined} gen 渲染层传来的代际号
 * @param {number} currentGen 当前全局代际号
 * @returns {boolean}
 */
function acceptScanCancel(gen, currentGen) {
  if (gen == null) return true
  const n = +gen
  if (!Number.isFinite(n)) return false
  return n === currentGen
}

/**
 * 按标题排序（就地）：与原实现 `tracks.sort((a,b)=>a.title.localeCompare(b.title,'zh'))` 等价。
 * @param {Array<{title: string}>} tracks
 * @returns {Array} 同一个数组
 */
function sortTracksByTitle(tracks) {
  if (!Array.isArray(tracks)) return tracks
  tracks.sort((a, b) => String(a && a.title).localeCompare(String(b && b.title), 'zh'))
  return tracks
}

/**
 * 目录遍历收集音频文件（fs 交互全部由调用方注入，因此可单测）。
 * 判定顺序与旧 walk() 逐条一致：先按 readdir 返回顺序，遇目录立即深递归，
 * 遇音频文件计数并（在上限内）收进 paths，因此截断时保留的仍是「先序前 N 个」。
 * readdir 抛错（无权限 / 目录不存在）按空目录处理，不中断整次扫描。
 * @param {string} root 起始目录
 * @param {object} options
 * @param {string|string[]|Set<string>} [options.exts] 音频扩展名
 * @param {number} [options.max] 收集上限（超过仍计入 total）
 * @param {number} [options.maxDepth] 递归深度上限，缺省 8
 * @param {(dir: string, opts: object) => Promise<Array>} options.readdir 注入的 fs.readdir
 * @param {(dir: string, name: string) => string} [options.join] 注入的路径拼接（如 path.join）
 * @returns {Promise<{paths: string[], total: number}>}
 */
async function collectAudioFiles(root, options) {
  const opts = options || {}
  if (typeof opts.readdir !== 'function') throw new TypeError('collectAudioFiles 需要注入 readdir')
  const exts = normalizeExts(opts.exts)
  const max = Number.isFinite(opts.max) && opts.max >= 0 ? Math.floor(opts.max) : Infinity
  const maxDepth = Number.isInteger(opts.maxDepth) && opts.maxDepth >= 0 ? opts.maxDepth : MAX_SCAN_DEPTH
  const readdir = opts.readdir
  const join = typeof opts.join === 'function'
    ? opts.join
    : (dir, name) => String(dir).replace(/[\\/]+$/, '') + '/' + name
  const paths = []
  let total = 0
  const visit = async (dir, depth) => {
    if (depth > maxDepth) return
    let ents
    try { ents = await readdir(dir, { withFileTypes: true }) } catch { return }
    if (!Array.isArray(ents)) return
    for (const raw of ents) {
      const e = toEntry(raw)
      if (e.isDirectory) {
        await visit(join(dir, e.name), depth + 1)
      } else if (e.name && exts.has(extOf(e.name))) {
        total++
        if (paths.length < max) paths.push(join(dir, e.name))
      }
    }
  }
  await visit(root, 0)
  return { paths, total }
}

module.exports = {
  DEFAULT_AUDIO_EXTS,
  MAX_SCAN_DEPTH,
  DEFAULT_SCAN_MAX_TRACKS,
  SKIP_DIRECTORY,
  SKIP_EXT_NOT_ALLOWED,
  SKIP_INVALID_ENTRY,
  normalizeExts,
  classifyEntry,
  pickAudioFiles,
  applyTruncation,
  mergeScanGen,
  acceptScanCancel,
  sortTracksByTitle,
  collectAudioFiles,
}
