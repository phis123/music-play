'use strict'
// mergeLrc（基线 netapi.js:192-214）：把翻译按时间戳并进原文，同一时间戳输出
// 「原文行 + 翻译行」。只验证基线已有行为。
// 重要纠正：核实报告第 8 节 / 任务描述里写的“容差匹配”与代码不符——
// mergeLrc 用的是 Map 严格相等（tmap.get(t)），翻译行时间戳差 30ms 也不会合并
// （见下面 '相差 30ms 的翻译行不会合并'）；容差配对只存在于 main.js 的
// parseLrc（±30ms，见 test/lrc.test.js），不要把两者混为一谈。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mergeLrc } = require('../netapi')

test('严格相等的时间戳：原文行后插入翻译行', () => {
  const out = mergeLrc(
    '[00:01.00]Hello\n[00:02.00]World',
    '[00:01.00]你好\n[00:02.00]世界',
  )
  assert.equal(out, '[00:01.00]Hello\n[00:01.00]你好\n[00:02.00]World\n[00:02.00]世界')
})

test('相差 30ms 的翻译行不会合并（严格相等，无容差）', () => {
  assert.equal(mergeLrc('[00:01.00]Hello', '[00:01.03]你好'), '[00:01.00]Hello')
})

test('翻译与原文相同文本时不重复插入', () => {
  assert.equal(mergeLrc('[00:01.00]Hello', '[00:01.00]Hello'), '[00:01.00]Hello')
})

test('无翻译时原样返回原文', () => {
  assert.equal(mergeLrc('[00:01.00]Hello', ''), '[00:01.00]Hello')
  assert.equal(mergeLrc('[00:01.00]Hello', null), '[00:01.00]Hello')
})

test('没有对应原文行的翻译行被丢弃', () => {
  assert.equal(mergeLrc('[00:01.00]Hello', '[00:09.00]你好'), '[00:01.00]Hello')
})

test('原文空行被丢弃，无标签行原样保留', () => {
  assert.equal(
    mergeLrc('[00:01.00]Hello\n\n[00:02.00]World', '[00:01.00]你好'),
    '[00:01.00]Hello\n[00:01.00]你好\n[00:02.00]World',
  )
  assert.equal(
    mergeLrc('no tag\n[00:01.00]Hello', '[00:01.00]你好'),
    'no tag\n[00:01.00]Hello\n[00:01.00]你好',
  )
})

test('原文空正文行原样保留，不插入翻译', () => {
  assert.equal(
    mergeLrc('[00:01.00]\n[00:02.00]World', '[00:02.00]世界'),
    '[00:01.00]\n[00:02.00]World\n[00:02.00]世界',
  )
})

test('同一时间戳出现两次翻译行时，后者覆盖前者', () => {
  assert.equal(
    mergeLrc('[00:01.00]Hello', '[00:01.00]你好\n[00:01.00]你好2'),
    '[00:01.00]Hello\n[00:01.00]你好2',
  )
})
