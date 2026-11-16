'use strict'
// netapi.js 纯工具函数：sanitize / parseTime / hiResCover / findFreePort，
// 以及本 patch 新增的 module.exports 导出形状。
// 这些函数不依赖 Electron、不碰网络（findFreePort 只在本地 bind 探测），
// 可在 plain node 里直接测试。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const netapi = require('../netapi')
const { sanitize, parseTime, hiResCover, findFreePort } = netapi

test('本 patch 新增的导出存在且为函数', () => {
  for (const name of ['downloadTo', 'mergeLrc', 'parseTime', 'sanitize', 'findFreePort']) {
    assert.equal(typeof netapi[name], 'function', `netapi.${name} 应被导出`)
  }
})

test('sanitize：去掉文件名非法字符、压缩空白、截断到 80 字符', () => {
  assert.equal(sanitize('a/b:c*d?e"f<g>h|i'), 'a_b_c_d_e_f_g_h_i')
  assert.equal(sanitize('  a   b  '), 'a b')
  assert.equal(sanitize('x'.repeat(100)).length, 80)
  assert.equal(sanitize(''), '')
})

test('parseTime：时间戳转毫秒；无标签返回 null', () => {
  assert.equal(parseTime('[00:01.00]Hello'), 1000)
  assert.equal(parseTime('[01:02.50]Hello'), 62500)
  assert.equal(parseTime('[00:01]Hello'), 1000)
  assert.equal(parseTime('[00:01.123]Hello'), 1120)
  assert.equal(parseTime('no tag'), null)
  assert.equal(parseTime('[ti:Title]'), null)
})

test('hiResCover：空串返回空串；去掉原 query 并拼尺寸参数', () => {
  assert.equal(hiResCover(''), '')
  assert.equal(hiResCover(null), '')
  assert.equal(
    hiResCover('http://example.com/cover.jpg?param=100y100'),
    'http://example.com/cover.jpg?param=600y600',
  )
  assert.equal(
    hiResCover('http://example.com/cover.jpg', 300),
    'http://example.com/cover.jpg?param=300y300',
  )
})

test('findFreePort：返回 >= start 的可用端口，且确实能 bind', async () => {
  const port = await findFreePort(3300)
  assert.ok(Number.isInteger(port) && port >= 3300, `端口应 >= 3300，实际 ${port}`)
  await new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.once('listening', () => srv.close(() => resolve()))
    srv.listen(port, '127.0.0.1')
  })
})
