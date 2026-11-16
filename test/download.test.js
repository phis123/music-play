'use strict'
// downloadTo（基线 netapi.js:264-283）：用本地 HTTP 服务器模拟，不碰外网。
// 基线已有的行为（本文件通过的测试）：正常 200、HTTP 500/404 拒绝、无
// Content-Length 仍可下载、空 body。基线缺失的行为见下面两个 test.skip，
// 不要把它们改成“期望基线行为”的断言来伪造通过。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { downloadTo } = require('../netapi')

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-play-download-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function serve(t, handler) {
  const server = http.createServer(handler)
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`)
    })
  })
}

test('正常 200：落盘内容一致，返回 bytes，进度回调走到 1', async (t) => {
  const dir = tmpDir(t)
  const body = Buffer.from('0123456789')
  const base = await serve(t, (_req, res) => {
    res.writeHead(200, { 'content-length': body.length })
    res.end(body)
  })
  const file = path.join(dir, 'ok.mp3')
  const progress = []
  const ret = await downloadTo(`${base}/ok`, file, (p) => progress.push(p))
  assert.deepEqual(ret, { bytes: 10 })
  assert.equal(fs.readFileSync(file, 'utf8'), '0123456789')
  assert.ok(progress.length > 0 && progress[progress.length - 1] === 1)
  assert.ok(progress.every((p, i) => i === 0 || p >= progress[i - 1]), '进度应单调不减')
})

test('HTTP 500：reject，且不创建文件', async (t) => {
  const dir = tmpDir(t)
  const base = await serve(t, (_req, res) => {
    res.writeHead(500)
    res.end('err')
  })
  const file = path.join(dir, 'e500.mp3')
  await assert.rejects(downloadTo(`${base}/x`, file), /HTTP 500/)
  assert.equal(fs.existsSync(file), false)
})

test('HTTP 404：reject', async (t) => {
  const dir = tmpDir(t)
  const base = await serve(t, (_req, res) => {
    res.writeHead(404)
    res.end('not found')
  })
  await assert.rejects(downloadTo(`${base}/x`, path.join(dir, 'e404.mp3')), /HTTP 404/)
})

test('无 Content-Length：仍可下载完成，进度回调不触发', async (t) => {
  const dir = tmpDir(t)
  const base = await serve(t, (_req, res) => {
    res.writeHead(200)
    res.end('hello')
  })
  const file = path.join(dir, 'nocl.mp3')
  let calls = 0
  const ret = await downloadTo(`${base}/x`, file, () => { calls += 1 })
  assert.deepEqual(ret, { bytes: 5 })
  assert.equal(fs.readFileSync(file, 'utf8'), 'hello')
  assert.equal(calls, 0)
})

test('空 body 的 200：resolve { bytes: 0 }，落盘空文件', async (t) => {
  const dir = tmpDir(t)
  const base = await serve(t, (_req, res) => {
    res.writeHead(200, { 'content-length': 0 })
    res.end()
  })
  const file = path.join(dir, 'empty.mp3')
  assert.deepEqual(await downloadTo(`${base}/x`, file), { bytes: 0 })
  assert.equal(fs.statSync(file).size, 0)
})

// TODO(第 5 项“下载逻辑可靠性”合并后启用)：以下两个测试断言的是第 5 项
// 应有的行为，不是基线行为。已在基线 b628e7a 上实测确认它们目前不通过：
// 截断响应（Content-Length: 10，只发 5 字节后断开）时，基线 downloadTo 的
// Promise 永久不 settle（5 秒无返回、无 reject），且磁盘残留 5 字节半截文件
// ——因为缺少 res.on('error') 且 finish 时从不比较 got/total（核实报告 §5）。
// 直接取消 skip 会让测试套件挂起，所以先用 test.skip 占位；第 5 项 patch
// （失败清理 + got/total 校验 + res.on('error')）合并后再取消 skip。
test.skip('截断响应：reject，且不残留半截文件（待第 5 项）', async (t) => {
  const dir = tmpDir(t)
  const base = await serve(t, (_req, res) => {
    res.writeHead(200, { 'content-length': 10 })
    res.write('01234')
    setTimeout(() => res.socket.destroy(), 50)
  })
  const file = path.join(dir, 'trunc.mp3')
  await assert.rejects(downloadTo(`${base}/x`, file), /不完整|incomplete|ECONNRESET|aborted|socket hang up/i)
  assert.equal(fs.existsSync(file), false, '失败后不应残留半截文件')
})

test.skip('中途断开：reject，且不残留半截文件（待第 5 项）', async (t) => {
  const dir = tmpDir(t)
  const base = await serve(t, (_req, res) => {
    res.writeHead(200, { 'content-length': 100 })
    res.write('01234')
    setTimeout(() => res.socket.destroy(), 50)
  })
  const file = path.join(dir, 'abort.mp3')
  await assert.rejects(downloadTo(`${base}/x`, file))
  assert.equal(fs.existsSync(file), false, '失败后不应残留半截文件')
})
