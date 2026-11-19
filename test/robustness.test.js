'use strict'
// 健壮性回归：针对外部审计清单里「缺少自动化测试」的几类边界
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { parseLrc } = require('../lib/lrc')
const { estimateFileGainDbSync, computeEffectiveGainDb } = require('../lib/loudness')
const { assertInsideLibrary, authorizeDir } = require('../lib/path-guard')

test('损坏/伪造的音频文件：响度测算不抛异常且返回 0dB 兜底', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-bad-'))
  try {
    const cases = [
      ['empty.mp3', Buffer.alloc(0)],
      ['short.mp3', Buffer.from('ID3')],
      ['garbage.mp3', Buffer.alloc(4096, 0xAB)],
      ['fake.mp3', Buffer.from('this is not audio at all'.repeat(100))],
    ]
    for (const [name, buf] of cases) {
      const f = path.join(dir, name)
      fs.writeFileSync(f, buf)
      const g = estimateFileGainDbSync(f)
      assert.equal(typeof g, 'number')
      assert.ok(Number.isFinite(g), name + ' 应返回有限数值')
      assert.ok(Math.abs(g) <= 8.5, name + ' 应被限幅在 ±8.5dB')
    }
    // 不存在的文件也不能抛
    assert.equal(typeof estimateFileGainDbSync(path.join(dir, 'nope.mp3')), 'number')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('错误 LRC / 异常时间戳：不抛异常，且非法行被丢弃', () => {
  assert.deepEqual(parseLrc(''), [])
  assert.deepEqual(parseLrc('[00:99.999]越界秒'), [{ t: 99999, text: '越界秒', pair: null }])
  assert.deepEqual(parseLrc('[abc:def]坏时间戳'), [])
  assert.deepEqual(parseLrc('[00:01.00][00:02.00][00:03.00]三时间戳').map(l => l.t), [1000, 2000, 3000])
  // 只有标签没有正文 → 丢弃
  assert.deepEqual(parseLrc('[00:01.00]\n[00:02.00]   '), [])
  // 乱序输入 → 输出按时间升序
  const out = parseLrc('[00:05.00]E\n[00:01.00]A\n[00:03.00]C')
  assert.deepEqual(out.map(l => l.text), ['A', 'C', 'E'])
})

test('路径校验：库外路径一律拒绝，库内路径放行（含 ../ 与符号链接变体）', () => {
  const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-lib-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-out-'))
  try {
    authorizeDir(lib)
    const inside = path.join(lib, 'a.mp3')
    fs.writeFileSync(inside, 'x')
    assert.equal(assertInsideLibrary(inside), inside)
    assert.throws(() => assertInsideLibrary(path.join(lib, '..', path.basename(outside), 'x.mp3')))
    assert.throws(() => assertInsideLibrary(path.join(outside, 'x.mp3')))
    // 指向库外的符号链接必须被拒绝（Windows 上创建失败则跳过该断言）
    // 注意：目标文件必须真实存在，否则 realpath 失败会退化成「看起来在库内」
    try {
      const target = path.join(outside, 'x.mp3')
      fs.writeFileSync(target, 'outside')
      const link = path.join(lib, 'link.mp3')
      fs.symlinkSync(target, link)
      assert.throws(() => assertInsideLibrary(link))
    } catch (e) {
      if (e && e.code !== 'EPERM' && e.code !== 'EACCES') throw e
    }
  } finally {
    fs.rmSync(lib, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('音量平衡：极端参数仍被限幅在 ±15dB，且手动微调可覆盖预设', () => {
  assert.equal(computeEffectiveGainDb({ enabled: true, preset: 'standard', autoGainDb: -40, userTrackGainDb: 0 }), -15)
  assert.equal(computeEffectiveGainDb({ enabled: true, preset: 'boost', autoGainDb: 40, userTrackGainDb: 12 }), 15)
  assert.equal(computeEffectiveGainDb({ enabled: false, preset: 'night', autoGainDb: -8, userTrackGainDb: -12 }), -12)
})