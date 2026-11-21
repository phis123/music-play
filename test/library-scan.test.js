'use strict'
// 曲库扫描纯逻辑（lib/library-scan.js）的测试。
//
// 这些用例替代了原来「只能靠 Electron 手工点选目录」的验证方式：扩展名过滤、
// 大小写、上限截断、代际失效、取消/中断、空目录、嵌套目录全部在 plain node 里跑。
// 目录遍历的 fs 交互由被测函数注入（真实临时目录 + 虚拟 readdir 两种），
// 因此既能验证真实递归顺序，也能造出难复现的深度/异常分支。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  DEFAULT_AUDIO_EXTS,
  MAX_SCAN_DEPTH,
  DEFAULT_SCAN_MAX_TRACKS,
  normalizeExts,
  classifyEntry,
  pickAudioFiles,
  applyTruncation,
  mergeScanGen,
  acceptScanCancel,
  sortTracksByTitle,
  collectAudioFiles,
} = require('../lib/library-scan')

/** 建一棵真实临时目录树：{ 'a.mp3': null, 'sub/b.flac': null } → 绝对路径 */
function makeTree(spec) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-scan-test-'))
  for (const [rel, content] of Object.entries(spec)) {
    const abs = path.join(root, ...rel.split('/'))
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    if (content === null) fs.writeFileSync(abs, '')
    else fs.writeFileSync(abs, content)
  }
  return root
}

/** 真实 fs 的 readdir（与 main.js 注入的形态一致：带 withFileTypes） */
const realReaddir = (dir, opts) => fs.promises.readdir(dir, opts)

// ---------- pickAudioFiles / classifyEntry：扩展名过滤 ----------

test('pickAudioFiles：只收音频扩展名，非音频进 skipped 且原因正确', () => {
  const entries = [
    { name: 'a.mp3', isDirectory: false },
    { name: 'notes.txt', isDirectory: false },
    { name: 'cover.jpg', isDirectory: false },
    { name: 'Disc1', isDirectory: true },
    { name: 'b.flac', isDirectory: false },
  ]
  const { files, skipped } = pickAudioFiles(entries, { exts: DEFAULT_AUDIO_EXTS })
  assert.deepEqual(files, ['a.mp3', 'b.flac'])
  assert.deepEqual(skipped, [
    { name: 'notes.txt', reason: 'ext-not-allowed' },
    { name: 'cover.jpg', reason: 'ext-not-allowed' },
    { name: 'Disc1', reason: 'directory' },
  ])
})

test('pickAudioFiles：扩展名大小写不敏感（.MP3 / .Flac / .WAV 都收）', () => {
  const entries = ['A.MP3', 'b.Flac', 'c.WaV', 'd.Mp3.bak']
  const { files, skipped } = pickAudioFiles(entries, { exts: DEFAULT_AUDIO_EXTS })
  assert.deepEqual(files, ['A.MP3', 'b.Flac', 'c.WaV'])
  // 没有 0. 前面的点也算扩展名：d.Mp3.bak 的扩展名是 .bak
  assert.deepEqual(skipped, [{ name: 'd.Mp3.bak', reason: 'ext-not-allowed' }])
})

test('pickAudioFiles：自定义扩展名（自动补前导点、统一小写）', () => {
  const { files } = pickAudioFiles(['x.AIFF', 'y.mp3'], { exts: ['aiff', '.Mp3'] })
  assert.deepEqual(files, ['x.AIFF', 'y.mp3'])
})

test('pickAudioFiles：空输入返回空结果，非法条目归为 invalid-entry', () => {
  assert.deepEqual(pickAudioFiles([], { exts: DEFAULT_AUDIO_EXTS }), { files: [], skipped: [] })
  const { files, skipped } = pickAudioFiles([null, { noName: 1 }, 'ok.mp3'], { exts: DEFAULT_AUDIO_EXTS })
  assert.deepEqual(files, ['ok.mp3'])
  assert.deepEqual(skipped, [
    { name: '', reason: 'invalid-entry' },
    { name: '', reason: 'invalid-entry' },
  ])
})

test('classifyEntry：directory / audio / other / invalid 四类互斥', () => {
  const exts = DEFAULT_AUDIO_EXTS
  assert.equal(classifyEntry({ name: 'sub', isDirectory: true }, { exts }).kind, 'directory')
  assert.equal(classifyEntry({ name: 'a.M4A' }, { exts }).kind, 'audio')
  assert.equal(classifyEntry({ name: 'a.lrc' }, { exts }).kind, 'other')
  assert.equal(classifyEntry(null, { exts }).kind, 'invalid')
  // Dirent 形态（isDirectory 是方法）也要认
  const direntLike = { name: 'sub', isDirectory: () => true }
  assert.equal(classifyEntry(direntLike, { exts }).kind, 'directory')
})

test('normalizeExts：接受字符串 / 数组 / Set，输出小写带点集合', () => {
  assert.deepEqual([...normalizeExts('.MP3')], ['.mp3'])
  assert.deepEqual([...normalizeExts(['flac', '.OGG'])], ['.flac', '.ogg'])
  assert.deepEqual([...normalizeExts(new Set(['.wav']))], ['.wav'])
  // 空集合回退默认值，避免「传了空数组就永远扫不到歌」
  assert.deepEqual([...normalizeExts([])], [...DEFAULT_AUDIO_EXTS])
})

// ---------- applyTruncation：上限截断 ----------

test('applyTruncation：未超限时原样返回，truncated=false', () => {
  const list = ['a', 'b', 'c']
  const r = applyTruncation(list, { max: 5000 })
  assert.deepEqual(r.tracks, ['a', 'b', 'c'])
  assert.equal(r.truncated, false)
  assert.equal(r.total, 3)
  // 必须返回副本：调用方对结果排序不应污染入参
  r.tracks.push('d')
  assert.deepEqual(list, ['a', 'b', 'c'])
})

test('applyTruncation：超限时只留前 max 个，truncated=true，total 照真实总数', () => {
  const list = Array.from({ length: 10 }, (_, i) => `t${i}.mp3`)
  const r = applyTruncation(list, { max: 3 })
  assert.deepEqual(r.tracks, ['t0.mp3', 't1.mp3', 't2.mp3'])
  assert.equal(r.truncated, true)
  assert.equal(r.total, 10)
})

test('applyTruncation：惰性收集只留前 max 但 total 用调用方统计的真实值', () => {
  // main.js 的实况：walk 只 push 前 SCAN_MAX_TRACKS 条，total 单独计数
  const keptPaths = ['a.mp3', 'b.mp3']
  const r = applyTruncation(keptPaths, { max: 2, total: 4321 })
  assert.deepEqual(r.tracks, ['a.mp3', 'b.mp3'])
  assert.equal(r.truncated, true, '真实总数 4321 > max 2，必须报截断')
  assert.equal(r.total, 4321)
})

test('applyTruncation：max=0 / 非法 max / 空列表的边界', () => {
  const zero = applyTruncation(['a', 'b'], { max: 0 })
  assert.deepEqual(zero.tracks, [])
  assert.equal(zero.truncated, true)

  // NaN / 负数视为「不限」，不是「全砍掉」
  assert.deepEqual(applyTruncation(['a', 'b'], { max: NaN }).tracks, ['a', 'b'])
  assert.deepEqual(applyTruncation(['a', 'b'], { max: -1 }).tracks, ['a', 'b'])

  const empty = applyTruncation([], { max: 10 })
  assert.deepEqual(empty.tracks, [])
  assert.equal(empty.truncated, false)
  assert.equal(empty.total, 0)
})

test('applyTruncation：gen 惰性源优先于 list，并支持任意可迭代对象', () => {
  const r = applyTruncation(['ignored'], {
    max: 2,
    gen: () => (function* () { yield 'x'; yield 'y'; yield 'z' })(),
  })
  assert.deepEqual(r.tracks, ['x', 'y'])
  assert.equal(r.truncated, true)
  assert.equal(r.total, 3)
})

// ---------- mergeScanGen：代际失效 ----------

test('mergeScanGen：当前代际有效，被更新的扫描取代即失效', () => {
  assert.equal(mergeScanGen(1, 1), true, '本次扫描仍是当前代际')
  assert.equal(mergeScanGen(2, 1), false, '已有更新的扫描（2）→ 1 过期')
  assert.equal(mergeScanGen(1, 2), true, '新扫描（2）比全局更新 → 有效')
  assert.equal(mergeScanGen(0, 0), false, '0 表示从未扫描，不能算有效代际')
  assert.equal(mergeScanGen(1, NaN), false, '非法代际号一律失效')
})

test('mergeScanGen：连续扫描只保留最后一次有效（旧结果不能写缓存）', () => {
  // 模拟 main.js：scanGen 全局自增，两次扫描重叠
  let scanGen = 0
  const first = ++scanGen
  const second = ++scanGen
  assert.equal(mergeScanGen(scanGen, first), false, '先发起的扫描收尾时已过期')
  assert.equal(mergeScanGen(scanGen, second), true, '后发起的扫描仍有效')
})

// ---------- acceptScanCancel：取消 / 中断 ----------

test('acceptScanCancel：不传代际取消最新一次，传了只取消该代际', () => {
  assert.equal(acceptScanCancel(undefined, 3), true)
  assert.equal(acceptScanCancel(null, 3), true)
  assert.equal(acceptScanCancel(3, 3), true)
  assert.equal(acceptScanCancel('3', 3), true, '渲染层可能传字符串')
  assert.equal(acceptScanCancel(2, 3), false, '旧代际的取消请求不能杀掉新扫描')
  assert.equal(acceptScanCancel('abc', 3), false)
})

// ---------- collectAudioFiles：嵌套目录 / 空目录 / 深度 / 上限 ----------

test('collectAudioFiles：嵌套目录递归收集，先序保序（与旧 walk 一致）', async (t) => {
  const root = makeTree({
    'b.mp3': null,
    'a.txt': null,
    'sub/c.flac': null,
    'sub/deep/d.ogg': null,
    'sub2/e.MP3': null,
  })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const { paths, total } = await collectAudioFiles(root, {
    exts: DEFAULT_AUDIO_EXTS,
    readdir: realReaddir,
    join: path.join,
  })
  // 目录里文件按 readdir 名字序（Windows/Linux 不一致），这里只断言「集合 + 深度/
  // 顺序性质」：子目录 d/e 在 c 之后、都在根目录 b 之后不是必须的，因此按集合比。
  const rel = paths.map((p) => path.relative(root, p).split(path.sep).join('/')).sort()
  assert.deepEqual(rel, ['b.mp3', 'sub/c.flac', 'sub/deep/d.ogg', 'sub2/e.MP3'])
  assert.equal(total, 4, '大小写扩展名都要计入')
  assert.equal(paths.length, total)
  // 顺序性质：同一个目录内保持 readdir 返回顺序（b.mp3 先于 sub 递归结果出现的
  // 具体情况取决于名字序，这里只验证「不重不漏 + 路径可回读」）
  for (const p of paths) assert.ok(fs.statSync(p).isFile())
})

test('collectAudioFiles：展开顺序与旧 walk 完全相同（按名字序深度优先）', async (t) => {
  const root = makeTree({
    '1.mp3': null,
    '2-dir/1.mp3': null,
    '2-dir/2.mp3': null,
    '3.mp3': null,
  })
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const { paths } = await collectAudioFiles(root, { exts: DEFAULT_AUDIO_EXTS, readdir: realReaddir, join: path.join })
  const rel = paths.map((p) => path.relative(root, p).split(path.sep).join('/'))
  // 名字序：1.mp3 < 2-dir < 3.mp3；进入 2-dir 时先出 1.mp3、2.mp3
  assert.deepEqual(rel, ['1.mp3', '2-dir/1.mp3', '2-dir/2.mp3', '3.mp3'])
})

test('collectAudioFiles：空目录返回空结果且不抛', async (t) => {
  const root = makeTree({})
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const r = await collectAudioFiles(root, { exts: DEFAULT_AUDIO_EXTS, readdir: realReaddir, join: path.join })
  assert.deepEqual(r, { paths: [], total: 0 })
})

test('collectAudioFiles：不存在的目录 / readdir 抛错按空目录处理', async () => {
  const missing = await collectAudioFiles(path.join(os.tmpdir(), 'mp-scan-nope-' + Date.now()), {
    exts: DEFAULT_AUDIO_EXTS,
    readdir: realReaddir,
    join: path.join,
  })
  assert.deepEqual(missing, { paths: [], total: 0 })

  const boom = await collectAudioFiles('X:', {
    exts: DEFAULT_AUDIO_EXTS,
    readdir: () => { throw new Error('EACCES') },
  })
  assert.deepEqual(boom, { paths: [], total: 0 })
  // 异步 readdir 的 rejection 同样被吞掉（原 walk 的 try/catch await 语义）
  const rejected = await collectAudioFiles('X:', {
    exts: DEFAULT_AUDIO_EXTS,
    readdir: () => Promise.reject(new Error('EPERM')),
  })
  assert.deepEqual(rejected, { paths: [], total: 0 })
})

test('collectAudioFiles：maxDepth 生效，超过深度上限的目录不再进入', async () => {
  // 虚拟 fs：d0/d1/d2/d3 里各有一个 mp3
  const tree = {
    d0: [{ name: 'a.mp3' }, { name: 'd1', isDirectory: true }],
    'd0/d1': [{ name: 'b.mp3' }, { name: 'd2', isDirectory: true }],
    'd0/d1/d2': [{ name: 'c.mp3' }, { name: 'd3', isDirectory: true }],
    'd0/d1/d2/d3': [{ name: 'd.mp3' }],
  }
  const readdir = async (dir) => {
    if (!(dir in tree)) throw new Error('ENOENT')
    return tree[dir]
  }
  const deep = await collectAudioFiles('d0', { exts: DEFAULT_AUDIO_EXTS, readdir, maxDepth: 10 })
  assert.equal(deep.total, 4, '不限制深度时四层都能扫到')

  const shallow = await collectAudioFiles('d0', { exts: DEFAULT_AUDIO_EXTS, readdir, maxDepth: 1 })
  assert.deepEqual(shallow.paths, ['d0/a.mp3', 'd0/d1/b.mp3'])
  assert.equal(shallow.total, 2, 'maxDepth=1 只到 d0 与 d0/d1')

  // 默认深度上限就是旧 walk 的 8
  assert.equal(MAX_SCAN_DEPTH, 8)
})

test('collectAudioFiles：max 只保留前 N 个，但 total 统计真实总数', async () => {
  const spec = {}
  for (let i = 0; i < 6; i++) spec[`0${i}.mp3`] = null
  const root = makeTree(spec)
  const r = await collectAudioFiles(root, {
    exts: DEFAULT_AUDIO_EXTS,
    max: 2,
    readdir: realReaddir,
    join: path.join,
  })
  // 再走一遍 applyTruncation，模拟 main.js 的完整链路
  const limited = applyTruncation(r.paths, { max: 2, total: r.total })
  assert.equal(limited.tracks.length, 2)
  assert.equal(limited.truncated, true)
  assert.equal(limited.total, 6)
  assert.deepEqual(r.paths.map((p) => path.basename(p)), ['00.mp3', '01.mp3'])
  fs.rmSync(root, { recursive: true, force: true })
})

test('collectAudioFiles：未注入 readdir 时抛 TypeError（防静默扫出空库）', async () => {
  await assert.rejects(() => collectAudioFiles('x', {}), /需要注入 readdir/)
})

// ---------- 组合场景：取消 / 中断 / 代际 ----------

test('组合：扫描途中取消 → 已收部分保留，返回 cancelled 语义', async () => {
  let scanGen = 0
  let cancelRequested = false
  const myGen = ++scanGen
  const root = makeTree({ '1.mp3': null, '2.mp3': null, '3.mp3': null, '4.mp3': null })
  try {
    const scanned = await collectAudioFiles(root, { exts: DEFAULT_AUDIO_EXTS, readdir: realReaddir, join: path.join })
    const limited = applyTruncation(scanned.paths, { max: DEFAULT_SCAN_MAX_TRACKS, total: scanned.total })
    const processed = []
    for (const f of limited.tracks) {
      // 取消只在「取下一个任务前」检查（与 main.js runLimited 的 shouldStop 一致）
      if (cancelRequested) break
      processed.push(f)
      if (processed.length === 2) {
        // 渲染层点「取消」，不传代际 → 取消最新一次
        assert.equal(acceptScanCancel(undefined, scanGen), true)
        cancelRequested = true
      }
    }
    assert.equal(processed.length, 2, '取消后不再处理剩余曲目')
    assert.equal(limited.tracks.length, 4, '取消不影响已遍历到的路径列表')
    assert.equal(cancelRequested, true)
    assert.equal(mergeScanGen(scanGen, myGen), true, '取消不是代际失效，结果仍属当前代际')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('组合：取消旧代际不影响新扫描；新扫描令旧扫描失效', () => {
  let scanGen = 0
  let cancelRequested = false
  const stale = ++scanGen
  // 旧扫描的取消请求（带过期的 gen）落地前，新扫描已经开始
  const current = ++scanGen
  assert.equal(acceptScanCancel(stale, scanGen), false, '旧代际的取消不能杀掉新扫描')
  assert.equal(cancelRequested, false)
  // 不传代际的取消才作用于最新一次
  assert.equal(acceptScanCancel(undefined, scanGen), true)
  // 旧扫描收尾：已过期，不能写缓存
  assert.equal(mergeScanGen(scanGen, stale), false)
  assert.equal(mergeScanGen(scanGen, current), true)
})

// ---------- sortTracksByTitle ----------

test('sortTracksByTitle：按标题本地化排序，返回同一数组', () => {
  const tracks = [{ title: 'b' }, { title: 'a' }, { title: 'c' }]
  const out = sortTracksByTitle(tracks)
  assert.equal(out, tracks)
  assert.deepEqual(tracks.map((t) => t.title), ['a', 'b', 'c'])
  // 缺 title 的脏数据不能抛
  assert.doesNotThrow(() => sortTracksByTitle([{}, { title: 'x' }]))
})
