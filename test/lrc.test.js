'use strict'
// parseLrc（实现在 lib/lrc.js，原 main.js:104-126 的内联函数逐行移出）。
// 只验证基线已有行为，不改配对逻辑。以下实测结论来自基线 b628e7a：
// - [offset:] 行会被整行忽略，不产生任何时间偏移；
// - 同一行里的第二个 [mm:ss.xx] 标签不会被展开，会原样留在文本里；
// - 秒后小数只精确到百分秒：.5 → 500ms，.123 → 120ms（截断，非四舍五入）。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseLrc } = require('../lib/lrc')

test('基本行：解析时间戳并按时间排序', () => {
  const out = parseLrc('[00:03.00]C\n[00:01.00]A\n[00:02.00]B')
  assert.deepEqual(out, [
    { t: 1000, text: 'A', pair: null },
    { t: 2000, text: 'B', pair: null },
    { t: 3000, text: 'C', pair: null },
  ])
})

test('CRLF、空文本、无时间戳行', () => {
  assert.deepEqual(parseLrc('[00:01.00]A\r\n[00:02.00]B\r\n'), [
    { t: 1000, text: 'A', pair: null },
    { t: 2000, text: 'B', pair: null },
  ])
  assert.deepEqual(parseLrc(''), [])
  assert.deepEqual(parseLrc('just text\nno timestamps here'), [])
})

test('[ti:]/[ar:] 等元数据行被忽略', () => {
  assert.deepEqual(parseLrc('[ti:Title]\n[ar:Artist]\n[al:Album]\n[00:01.00]A'), [
    { t: 1000, text: 'A', pair: null },
  ])
})

test('[offset:] 行被忽略，不产生时间偏移（基线行为）', () => {
  // 若将来要支持 offset，应先改 lib/lrc.js 再改本测试；目前基线直接跳过该行。
  assert.deepEqual(parseLrc('[offset:500]\n[00:01.00]Hello'), [
    { t: 1000, text: 'Hello', pair: null },
  ])
  assert.deepEqual(parseLrc('[offset:-500]\n[00:01.00]Hello'), [
    { t: 1000, text: 'Hello', pair: null },
  ])
})

test('三行同戳配对为一组 pair（含原文 + 两行译文）', () => {
  assert.deepEqual(parseLrc('[00:01.00]A\n[00:01.00]B\n[00:01.00]C'), [
    { t: 1000, text: 'A', pair: ['A', 'B', 'C'] },
  ])
})

test('配对边界：相差 30ms 配对，40ms 不配对', () => {
  assert.deepEqual(parseLrc('[00:01.00]A\n[00:01.03]B'), [
    { t: 1000, text: 'A', pair: ['A', 'B'] },
  ])
  assert.deepEqual(parseLrc('[00:01.00]A\n[00:01.04]B'), [
    { t: 1000, text: 'A', pair: null },
    { t: 1040, text: 'B', pair: null },
  ])
})

test('秒后小数：.5 → 500ms，.123/.12 → 120ms，无小数 → 0ms', () => {
  assert.equal(parseLrc('[00:01.5]A')[0].t, 1500)
  assert.equal(parseLrc('[00:01.12]A')[0].t, 1120)
  assert.equal(parseLrc('[00:01.123]A')[0].t, 1123)
  assert.equal(parseLrc('[00:01]A')[0].t, 1000)
  assert.equal(parseLrc('[01:02.50]A')[0].t, 62500)
})

test('一行多时间戳展开成多行（每个时间点各一条）', () => {
  assert.deepEqual(parseLrc('[00:01.00][00:05.00]Hello\n[00:02.00]World'), [
    { t: 1000, text: 'Hello', pair: null },
    { t: 2000, text: 'World', pair: null },
    { t: 5000, text: 'Hello', pair: null },
  ])
})

test('空正文行被跳过，首尾空白被 trim', () => {
  assert.deepEqual(parseLrc('[00:01.00]\n[00:02.00]   B   '), [
    { t: 2000, text: 'B', pair: null },
  ])
})

test('冒号/点号分隔的时间戳都接受', () => {
  assert.equal(parseLrc('[00:01.00]A')[0].t, 1000)
  assert.equal(parseLrc('[00:01:00]A')[0].t, 1000)
})
