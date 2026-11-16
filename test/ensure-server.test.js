'use strict'
// ensureServer（基线 netapi.js:36-70）与 bootPromise 失败重置（第 6 项）。
// 通过的测试只覆盖不启动服务就能验证的部分；失败重置的测试目前 skip，见下。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const netapi = require('../netapi')

test('启动前 getPort() 为 0（服务惰性启动，未被调用）', () => {
  assert.equal(netapi.getPort(), 0)
})

// TODO(第 6 项“网易云 API 启动失败重试”合并后启用)：基线 ensureServer 在
// catch 里只记日志、重抛，不把 bootPromise 置回 null（基线 netapi.js:64-67），
// 此后每次调用都在基线 netapi.js:38 直接返回同一个已 rejected 的 Promise，
// 全部网易云功能永久失败直到重启（核实报告 §6）。
// 判定方法：不要用 `ensureServer() !== ensureServer()` 比 Promise 身份——
// ensureServer 本身是 async 函数，每次调用都会包一层新的 Promise，
// 即使内部复用同一个 bootPromise，身份也不同（已实测：该写法在基线上误通过）。
// 改为数诊断日志里的 BOOT FAILED：重新启动会再走一遍 catch、再记一条；
// 复用旧 Promise 则日志条数不变。日志位置是 app.getPath('userData') 下的
// netease.log，plain node 下回退到 os.tmpdir()（见 netapi.js 顶部的桩）。
// 注意：本测试依赖一次确定性的启动失败。在 plain node、无依赖安装的环境下，
// 启动会在 require('@neteasecloudmusicapienhanced/api/server.js') 处失败，
// 满足条件；若将来 CI 先 npm install，启动可能成功，启用时需改为注入失败
// （例如让 findFreePort/serveNcmApi 失败）再断言重置行为。
// 另注意：调用 ensureServer 会把 process.env.TEMP/TMP 指到 ncm-tmp 目录，
// 本文件单独跑在一个进程里（node:test 每个文件一个进程），不影响其他文件。
test.skip('启动失败后 bootPromise 被重置：下一次调用重新启动而非复用旧 rejected Promise（待第 6 项）', async () => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  // 判定方法：数诊断日志里的 BOOT FAILED。重新启动会再走一遍 catch、再记一条；
  // 复用旧 Promise 则日志条数不变。
  // 日志位置：netapi.js 的 log() 写到 app.getPath('userData')/netease.log。
  // plain node 下桩的 getPath 返回 os.tmpdir()，而 ensureServer 启动时会把
  // process.env.TEMP 指到 <tmpdir>/ncm-tmp，os.tmpdir() 会跟随该变量变化——
  // 于是第 1 次失败的日志在 <tmpdir>/ncm-tmp/netease.log，第 2 次重启动的
  // 日志会嵌套到 <tmpdir>/ncm-tmp/ncm-tmp/netease.log（plain node 桩的产物，
  // 真实 Electron 里 getPath('userData') 稳定，不会嵌套）。所以递归汇总
  // <tmpdir>/ncm-tmp 树下所有 netease.log 的 BOOT FAILED 条数，并用
  // “第一次失败后的条数”作基数取增量，避免被历史残留干扰。
  const baseTmp = os.tmpdir() // 第一次启动前：尚未被改写
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
  assert.equal(
    countBootFailed(), afterFirstFailure + 1,
    '第二次调用应重新启动（再记一条 BOOT FAILED），而不是复用旧的 rejected Promise',
  )
})
