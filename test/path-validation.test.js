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
// 1. 第 2 项按核实报告 §2 方案新增 assertInsideLibrary(filePath, { allowUserData })
//    （path.resolve + fs.realpathSync 解析符号链接 + startsWith(root + path.sep)，
//    Windows 下统一大小写比较），并把它导出到 plain node 可 require 的位置
//    （如 main.js 增加 module.exports，或抽到 lib/ 纯函数模块，参考本 patch
//    把 parseLrc 抽到 lib/lrc.js 的做法）；
// 2. 把下面每个 test.skip 改成 test，并把 require 指向第 2 项实际的导出位置；
// 3. 在 Linux CI 上跑通后，再在 Windows 上补大小写/盘符用例（见最后一项）。
//
// 每个 skip 的用例都是第 2 项必须覆盖的边界（来自核实报告 §2 的 IPC 通道表）。
test.skip('拒绝 ../ 穿越到曲库根之外（library:scan / lyrics:get / cover:get）', () => {
  const { assertInsideLibrary } = require('../main.js') // TODO: 改为第 2 项实际导出位置
  const root = '/music'
  assert.throws(() => assertInsideLibrary('/music/../secret.txt', root), /outside|越界|不允许/i)
  assert.throws(() => assertInsideLibrary('/music/sub/../../secret.txt', root), /outside|越界|不允许/i)
  assert.throws(() => assertInsideLibrary('/etc/passwd', root), /outside|越界|不允许/i)
})

test.skip('曲库根内的正常路径放行，根本身放行', () => {
  const { assertInsideLibrary } = require('../main.js') // TODO: 改为第 2 项实际导出位置
  const root = '/music'
  assertInsideLibrary('/music/song.mp3', root)
  assertInsideLibrary('/music/sub/song.mp3', root)
  assertInsideLibrary('/music', root)
})

test.skip('前缀同名目录不算库内（如 /music2 不在 /music 内）', () => {
  const { assertInsideLibrary } = require('../main.js') // TODO: 改为第 2 项实际导出位置
  assert.throws(() => assertInsideLibrary('/music2/song.mp3', '/music'), /outside|越界|不允许/i)
})

test.skip('指向库外的符号链接被拒绝（realpath 解析后判定）', () => {
  const { assertInsideLibrary } = require('../main.js') // TODO: 改为第 2 项实际导出位置
  // 前置：测试里先在临时目录建一个指向库外的符号链接音频文件，
  // 再断言 assertInsideLibrary(链接路径, root) 抛错。
  assert.throws(() => assertInsideLibrary('/music/link.mp3', '/music'), /outside|越界|不允许/i)
})

test.skip('删除/写盘通道：lib:delete 与 lyrics:auto / lib:coverFix 的目标也在库内', () => {
  const { assertInsideLibrary } = require('../main.js') // TODO: 改为第 2 项实际导出位置
  // 前置：第 2 项把校验套用到 lib:delete、lyrics:auto、lib:coverFix 后，
  // 这里断言这些 handler 对库外目标拒绝，而不是只测函数本身。
  assert.throws(() => assertInsideLibrary('/tmp/evil.lrc', '/music'), /outside|越界|不允许/i)
})

test.skip('Windows 大小写/盘符变体也被拒绝（仅 Windows 上跑）', () => {
  const { assertInsideLibrary } = require('../main.js') // TODO: 改为第 2 项实际导出位置
  // 前置：仅在 win32 上启用；断言 C:\\Music\\..\\secret.txt、c:\\music 换盘符等变体都被拒。
  assert.throws(() => assertInsideLibrary('C:\\Music\\..\\secret.txt', 'C:\\Music'), /outside|越界|不允许/i)
})
