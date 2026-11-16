'use strict'
// 路径校验函数 assertInsideLibrary（第 2 项新增）的测试占位文件。
//
// 现状（基线 b628e7a）：main.js / netapi.js / preload.js 里没有任何
// assertInsideLibrary，也没有任何 path.resolve / realpath / startsWith(root)
// 边界校验（核实报告 §2）；且 main.js 顶层 require('electron') 并立即执行
// app.commandLine / ipcMain.handle，plain node 无法 require 它。
// 因此这里不要凭空测试一个不存在的函数、不要伪造通过结果。
//
// 启用条件（第 2 项 patch 合并后）：
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  assertInsideLibrary,
  authorizeDir,
  resetAuthorizedDirs,
  isInsideLibrary,
  assertSafeWriteTarget,
  validateDownloadPayload,
  validateReplaceSourcePayload,
} = require('../lib/path-guard')
const { downloadVoice } = require('../netapi')

test('拒绝 ../ 穿越到曲库根之外（library:scan / lyrics:get / cover:get）', () => {
  const root = '/music'
  assert.throws(() => assertInsideLibrary('/music/../secret.txt', root), /outside|越界|不允许|不在曲库/i)
  assert.throws(() => assertInsideLibrary('/music/sub/../../secret.txt', root), /outside|越界|不允许|不在曲库/i)
  assert.throws(() => assertInsideLibrary('/etc/passwd', root), /outside|越界|不允许|不在曲库/i)
})

test('曲库根内的正常路径放行，根本身放行', () => {
  const root = '/music'
  assertInsideLibrary('/music/song.mp3', root)
  assertInsideLibrary('/music/sub/song.mp3', root)
  assertInsideLibrary('/music', root)
})

test('前缀同名目录不算库内（如 /music2 不在 /music 内）', () => {
  assert.throws(() => assertInsideLibrary('/music2/song.mp3', '/music'), /outside|越界|不允许|不在曲库/i)
})

test('指向库外的符号链接被拒绝（realpath 解析后判定）', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'music-play-pathguard-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const libDir = path.join(base, 'music')
  const outsideDir = path.join(base, 'outside')
  fs.mkdirSync(libDir, { recursive: true })
  fs.mkdirSync(outsideDir, { recursive: true })
  const secretFile = path.join(outsideDir, 'secret.mp3')
  fs.writeFileSync(secretFile, 'x')
  const linkPath = path.join(libDir, 'link.mp3')
  try {
    fs.symlinkSync(secretFile, linkPath)
    assert.throws(() => assertInsideLibrary(linkPath, libDir), /outside|越界|不允许|不在曲库/i)
  } catch (e) {
    // Windows 未开启开发者模式无 symlink 权限时，退化验证目录软链或越界路径
    if (e && (e.code === 'EPERM' || e.code === 'ENOSYS')) {
      assert.throws(() => assertInsideLibrary(secretFile, libDir), /outside|越界|不允许|不在曲库/i)
    } else {
      throw e
    }
  }
})

test('删除/写盘通道：lib:delete 与 lyrics:auto / lib:coverFix 的目标也在库内（含 authorizedDirs 集合校验）', () => {
  resetAuthorizedDirs()
  authorizeDir('/music')
  assert.equal(isInsideLibrary('/music/sub/ok.lrc'), true)
  assert.equal(isInsideLibrary('/tmp/evil.lrc'), false)
  assert.throws(() => assertInsideLibrary('/tmp/evil.lrc'), /outside|越界|不允许|不在曲库/i)
})

test('Windows 大小写/盘符变体也被拒绝', () => {
  if (process.platform === 'win32') {
    assert.throws(() => assertInsideLibrary('C:\\Music\\..\\secret.txt', 'C:\\Music'), /outside|越界|不允许|不在曲库/i)
    assertInsideLibrary('c:\\music\\sub\\song.mp3', 'C:\\Music')
  } else {
    assert.throws(() => assertInsideLibrary('/Music/../secret.txt', '/Music'), /outside|越界|不允许|不在曲库/i)
  }
})

test('P0-1 回归：net:download (validateDownloadPayload) 严禁透传 overwritePath / targetPath 绕过校验', () => {
  resetAuthorizedDirs()
  authorizeDir('/music')
  // 正常普通下载：只保留 voice / song / dir，剔除任何额外未知属性
  const clean = validateDownloadPayload({
    voice: { mainTrackId: 1, title: 'v' },
    song: { name: 's' },
    extraUntrustedField: 'dropped',
  }, '/music')
  assert.equal('overwritePath' in clean, false)
  assert.equal('targetPath' in clean, false)
  assert.equal('extraUntrustedField' in clean, false)

  // 试图通过 overwritePath 绕过 targetPath 检查（无论是库外还是库内路径，普通下载一律拒绝覆盖）
  assert.throws(
    () => validateDownloadPayload({ voice: { mainTrackId: 1 }, overwritePath: '/etc/passwd' }, '/music'),
    /PATH_OUTSIDE_LIBRARY|禁止指定覆盖路径/
  )
  assert.throws(
    () => validateDownloadPayload({ voice: { mainTrackId: 1 }, targetPath: '/etc/passwd' }, '/music'),
    /PATH_OUTSIDE_LIBRARY|禁止指定覆盖路径/
  )
  assert.throws(
    () => validateDownloadPayload({ voice: { mainTrackId: 1 }, overwritePath: '/music/song.mp3' }, '/music'),
    /PATH_OUTSIDE_LIBRARY|禁止指定覆盖路径/
  )
})

test('P0-1 回归：net:replaceSource (validateReplaceSourcePayload) 必须验证目标路径在授权曲库内', () => {
  resetAuthorizedDirs()
  authorizeDir('/music')
  // 库内合法替换放行，并统一输出为 targetPath
  const ok1 = validateReplaceSourcePayload({
    voice: { mainTrackId: 1 },
    song: { name: 's' },
    targetPath: '/music/sub/song.mp3',
  }, '/music')
  assert.ok(ok1.targetPath.endsWith('song.mp3'))

  // 兼容旧字段 overwritePath，但也必须经过校验且归一化为 targetPath
  const ok2 = validateReplaceSourcePayload({
    voice: { mainTrackId: 1 },
    song: { name: 's' },
    overwritePath: '/music/sub/song2.mp3',
  }, '/music')
  assert.ok(ok2.targetPath.endsWith('song2.mp3'))

  // 缺少目标路径、库外路径、或 targetPath 与 overwritePath 不一致时明确拒绝
  assert.throws(
    () => validateReplaceSourcePayload({ voice: { mainTrackId: 1 } }, '/music'),
    /PATH_OUTSIDE_LIBRARY/
  )
  assert.throws(
    () => validateReplaceSourcePayload({ voice: { mainTrackId: 1 }, targetPath: '/music/../evil.mp3' }, '/music'),
    /PATH_OUTSIDE_LIBRARY/
  )
  assert.throws(
    () => validateReplaceSourcePayload({ voice: { mainTrackId: 1 }, overwritePath: '/outside/evil.mp3' }, '/music'),
    /PATH_OUTSIDE_LIBRARY/
  )
  assert.throws(
    () => validateReplaceSourcePayload({
      voice: { mainTrackId: 1 },
      targetPath: '/music/good.mp3',
      overwritePath: '/outside/evil.mp3',
    }, '/music'),
    /PATH_OUTSIDE_LIBRARY|不一致/
  )
})

test('P0-1 纵深防御：netapi.downloadVoice 内部也拒绝越界 overwritePath / targetPath', async () => {
  resetAuthorizedDirs()
  authorizeDir('/music')
  await assert.rejects(
    downloadVoice({
      voice: { mainTrackId: 1, title: 'v' },
      song: { name: 's' },
      dir: '/music',
      overwritePath: '/outside/evil.mp3',
    }),
    /PATH_OUTSIDE_LIBRARY/
  )
  await assert.rejects(
    downloadVoice({
      voice: { mainTrackId: 1, title: 'v' },
      song: { name: 's' },
      dir: '/music',
      targetPath: '/music/../evil.mp3',
    }),
    /PATH_OUTSIDE_LIBRARY/
  )
})

test('派生文件写入防护：assertSafeWriteTarget 拒绝已存在的符号链接目标（含断链 symlink）', (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'music-play-safewrite-'))
  t.after(() => fs.rmSync(base, { recursive: true, force: true }))
  const libDir = path.join(base, 'music')
  const outsideDir = path.join(base, 'outside')
  fs.mkdirSync(libDir, { recursive: true })
  fs.mkdirSync(outsideDir, { recursive: true })

  // 正常尚未存在的库内派生 .lrc 路径放行
  const normalLrc = path.join(libDir, 'song.lrc')
  assert.ok(assertSafeWriteTarget(normalLrc, libDir).endsWith('song.lrc'))

  // 若库内存在指向库外的 symlink（包括指向尚不存在文件的断链 symlink），拒绝写入
  const danglingTarget = path.join(outsideDir, 'nonexistent.lrc')
  const symlinkLrc = path.join(libDir, 'evil.lrc')
  try {
    fs.symlinkSync(danglingTarget, symlinkLrc)
    assert.throws(() => assertSafeWriteTarget(symlinkLrc, libDir), /PATH_OUTSIDE_LIBRARY|符号链接/)
  } catch (e) {
    if (e && (e.code === 'EPERM' || e.code === 'ENOSYS')) {
      assert.throws(() => assertSafeWriteTarget(danglingTarget, libDir), /PATH_OUTSIDE_LIBRARY/)
    } else {
      throw e
    }
  }
})
