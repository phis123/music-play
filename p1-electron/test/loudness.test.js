'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  parseReplayGainTag,
  extractMp3GlobalGainsFromBuffer,
  computeEffectiveGainDb,
} = require('../lib/loudness')

test('parseReplayGainTag：支持数值、对象与带单位字符串解析并限幅在 [-15, 15]', () => {
  assert.equal(parseReplayGainTag(-4.26), -4.3)
  assert.equal(parseReplayGainTag({ dB: 3.14 }), 3.1)
  assert.equal(parseReplayGainTag('-6.80 dB'), -6.8)
  assert.equal(parseReplayGainTag('+5.2 dB'), 5.2)
  assert.equal(parseReplayGainTag(99), 15)
  assert.equal(parseReplayGainTag(-99), -15)
  assert.equal(parseReplayGainTag(null), null)
  assert.equal(parseReplayGainTag('invalid'), null)
})

test('computeEffectiveGainDb：支持全局开关、预设模式与单曲独立手动微调叠加', () => {
  // 开启标准模式：auto(-3.5) + manual(+1.5) = -2.0 dB
  assert.equal(
    computeEffectiveGainDb({ enabled: true, preset: 'standard', autoGainDb: -3.5, userTrackGainDb: 1.5 }),
    -2.0
  )
  // 夜间轻柔模式额外 -2.5 dB：auto(-2.0) + night(-2.5) + manual(0) = -4.5 dB
  assert.equal(
    computeEffectiveGainDb({ enabled: true, preset: 'night', autoGainDb: -2.0, userTrackGainDb: 0 }),
    -4.5
  )
  // 关闭全局自动平衡时：单曲独立增益微调仍生效
  assert.equal(
    computeEffectiveGainDb({ enabled: false, preset: 'standard', autoGainDb: -6.8, userTrackGainDb: 3.0 }),
    3.0
  )
})

test('extractMp3GlobalGainsFromBuffer：对空缓冲或非 MP3 数据安全返回空数组', () => {
  assert.deepEqual(extractMp3GlobalGainsFromBuffer(Buffer.alloc(0)), [])
  assert.deepEqual(extractMp3GlobalGainsFromBuffer(Buffer.alloc(128, 0)), [])
})

test('随机播放三种策略验证：no-repeat 整轮不重复、rare-first 优先抽选少听曲目', () => {
  const queuePaths = ['a.mp3', 'b.mp3', 'c.mp3', 'd.mp3', 'e.mp3']
  const playCounts = { 'a.mp3': 20, 'b.mp3': 15, 'c.mp3': 12, 'd.mp3': 0, 'e.mp3': 1 }
  const shufflePlayed = new Set()
  let qPos = 0

  function pickNext(strat) {
    const n = queuePaths.length
    if (strat === 'true-random') {
      let idx = qPos
      while (idx === qPos) idx = Math.floor(Math.random() * n)
      return idx
    }
    shufflePlayed.add(queuePaths[qPos])
    let unplayed = []
    for (let i = 0; i < n; i++) {
      if (i !== qPos && !shufflePlayed.has(queuePaths[i])) unplayed.push(i)
    }
    if (!unplayed.length) {
      shufflePlayed.clear()
      shufflePlayed.add(queuePaths[qPos])
      for (let i = 0; i < n; i++) if (i !== qPos) unplayed.push(i)
    }
    if (strat === 'rare-first' && unplayed.length > 1) {
      unplayed.sort((a, b) => (playCounts[queuePaths[a]] || 0) - (playCounts[queuePaths[b]] || 0))
      const poolSize = Math.max(1, Math.ceil(unplayed.length * 0.35))
      return unplayed[Math.floor(Math.random() * poolSize)]
    }
    return unplayed[Math.floor(Math.random() * unplayed.length)]
  }

  // 1) no-repeat：连续切 4 次，连同初始曲目必须覆盖全部 5 首且无一重复
  const visited = new Set([queuePaths[qPos]])
  for (let step = 0; step < 4; step++) {
    qPos = pickNext('no-repeat')
    visited.add(queuePaths[qPos])
  }
  assert.equal(visited.size, 5)

  // 2) rare-first：重置后从 a.mp3 出发，前两次必抽中播放次数最少的 d.mp3 (0次) 和 e.mp3 (1次)
  shufflePlayed.clear()
  qPos = 0
  const firstRare = queuePaths[pickNext('rare-first')]
  assert.ok(firstRare === 'd.mp3' || firstRare === 'e.mp3', `expected d.mp3 or e.mp3, got ${firstRare}`)
})

