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
const { assertInsideLibrary, authorizeDir, resetAuthorizedDirs, isInsideLibrary } = require('../lib/path-guard')

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
