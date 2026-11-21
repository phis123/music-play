'use strict'
// ensureServer（基线 netapi.js:36-70）与 bootPromise 失败重置（第 6 项）。
// 通过的测试只覆盖不启动服务就能验证的部分；失败重置的测试目前 skip，见下。
//
// 【CI 加固】本文件原先依赖「没有安装 @neteasecloudmusicapienhanced/api，
// 于是 require(server.js) 必然失败」来制造确定性启动失败。CI 加了
// `npm install` 之后依赖会装上，启动可能真的成功（且会尝试联网），
// 断言 `assert.rejects` 就会偶发/必然变红 —— 这是典型的「靠环境凑绿」。
// 现改为：在 require('../netapi') 之前把 node:net 的 createServer 打桩，
// 让 findFreePort 在端口探测阶段确定性失败（不触碰真实端口，不与网络交互）。
// 这样无论依赖装没装，启动都必然失败，测试断言不放松。
const net = require('node:net')
const { EventEmitter } = require('node:events')

// 只在「监听」时立刻报错（模拟端口永远不可用），其余方法保持空实现。
net.createServer = function fakeCreateServer() {
  const srv = new EventEmitter()
  srv.listen = function () {
    process.nextTick(() => {
      const err = new Error('test 桩：模拟端口不可用（EADDRINUSE）')
      err.code = 'EADDRINUSE'
      srv.emit('error', err)
    })
  }
  srv.close = function (cb) { if (typeof cb === 'function') cb() }
  srv.address = function () { return { port: 0 } }
  return srv
}

const { test } = require('node:test')
const assert = require('node:assert/strict')
const netapi = require('../netapi')

test('启动前 getPort() 为 0（服务惰性启动，未被调用）', () => {
  assert.equal(netapi.getPort(), 0)
})

// 对应第 6 项“网易云 API 启动失败重试”，该项已合并、断言已启用（不再是 skip）：
// 基线 ensureServer 在 catch 里只记日志、重抛，不把 bootPromise 置回 null
// （基线 netapi.js:64-67），此后每次调用都在基线 netapi.js:38 直接返回同一个已
// rejected 的 Promise，全部网易云功能永久失败直到重启（核实报告 §6）；第 6 项
// 修好后，本用例作为「重启而非复用旧 Promise」的回归守门。
// 判定方法：不要用 `ensureServer() !== ensureServer()` 比 Promise 身份——
// ensureServer 本身是 async 函数，每次调用都会包一层新的 Promise，
// 即使内部复用同一个 bootPromise，身份也不同（已实测：该写法在基线上误通过）。
// 改为数诊断日志里的 BOOT FAILED：重新启动会再走一遍 catch、再记一条；
// 复用旧 Promise 则日志条数不变。日志位置是 app.getPath('userData') 下的
// netease.log，plain node 下回退到 os.tmpdir()（见 netapi.js 顶部的桩）。
// 注意：本测试依赖一次确定性的启动失败，已通过文件顶部的 net.createServer 桩
// 强制制造（findFreePort 必然失败），与「有没有 npm install」解耦；不再依赖
// require('@neteasecloudmusicapienhanced/api/server.js') 一定失败。
// 另注意：调用 ensureServer 会把 process.env.TEMP/TMP 指到 ncm-tmp 目录，
// 本文件单独跑在一个进程里（node:test 每个文件一个进程），不影响其他文件。
test('启动失败后 bootPromise 被重置：下一次调用重新启动而非复用旧 rejected Promise（第 6 项已启用）', async () => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const baseTmp = os.tmpdir()
  const countBootFailed = () => {
    let n = 0
    const walk = (dir) => {
      let ents
      try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of ents) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.isFile() && e.name === 'netease.log') {
          n += (fs.readFileSync(p, 'utf8').match(/BOOT FAILED/g) || []).length
        }
      }
    }
    walk(path.join(baseTmp, 'ncm-tmp'))
    return n
  }
  await assert.rejects(netapi.ensureServer())
  const afterFirstFailure = countBootFailed()
  assert.ok(afterFirstFailure >= 1, '第一次启动失败应记 BOOT FAILED')
  await assert.rejects(netapi.ensureServer())
  assert.ok(
    countBootFailed() > afterFirstFailure,
    '第二次调用应重新启动（再记新的 BOOT FAILED），而不是复用旧的 rejected Promise',
  )
})
