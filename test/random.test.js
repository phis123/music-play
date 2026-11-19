'use strict'
// 随机播放三策略：直接测 lib/random.js 的纯函数实现（不再在测试里重抄一份实现）。
// 所有用例都注入确定性 random，断言的是「策略语义」，不是某次随机结果。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const {
  pickNextShuffleIndex,
  SHUFFLE_STRATEGIES,
  RARE_POOL_RATIO,
} = require('../lib/random')

const ROOT = path.join(__dirname, '..')

/** 确定性伪随机（线性同余）：用于需要一串「合法随机数」但结果可复现的用例 */
function seeded(seed) {
  let s = seed >>> 0
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const paths = (n) => Array.from({ length: n }, (_, i) => `E:/music/${i}.mp3`)

test('导出接口：三策略常量与函数可用（渲染层/Android 共用同一份实现）', () => {
  assert.equal(typeof pickNextShuffleIndex, 'function')
  assert.deepEqual(SHUFFLE_STRATEGIES, ['no-repeat', 'rare-first', 'true-random'])
  assert.equal(RARE_POOL_RATIO, 0.35)
})

test('边界：空队列、单曲队列、缺失参数都返回 0 且不抛异常', () => {
  assert.equal(pickNextShuffleIndex({ queuePaths: [], qPos: -1 }), 0)
  assert.equal(pickNextShuffleIndex({ queuePaths: ['a.mp3'], qPos: 0 }), 0)
  assert.equal(pickNextShuffleIndex(), 0)
  assert.equal(pickNextShuffleIndex({}), 0)
  // qPos 为 -1（还没有当前曲目）时也要能挑出一首
  const idx = pickNextShuffleIndex({ queuePaths: paths(4), qPos: -1, random: () => 0.4 })
  assert.ok(Number.isInteger(idx) && idx >= 0 && idx < 4)
})

test('不重复策略：连续取 7 次恰好覆盖其余 7 首，且一轮内不重复', () => {
  const q = paths(8)
  const playedSet = new Set()
  let qPos = 0
  const picked = []
  const random = seeded(20261119)
  for (let i = 0; i < 7; i++) {
    const idx = pickNextShuffleIndex({
      queuePaths: q, qPos, strategy: 'no-repeat', playedSet, random,
    })
    assert.notEqual(idx, qPos, '下一首不能是当前曲目')
    assert.ok(!picked.includes(idx), `一轮内重复选中了第 ${idx} 首`)
    picked.push(idx)
    qPos = idx
  }
  assert.deepEqual([...picked].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7])
  // 本轮已播集合 = 起点曲目 + 前 6 次选中的曲目（最后一次选中尚未成为「当前」）
  assert.equal(playedSet.size, 7)
  for (const i of [0, ...picked.slice(0, 6)]) assert.ok(playedSet.has(q[i]))
})

test('不重复策略：本轮全部播完后重置池子，只把当前曲目保留为已播', () => {
  const q = paths(4)
  const playedSet = new Set(q) // 已全部播过
  const random = seeded(7)
  const idx = pickNextShuffleIndex({
    queuePaths: q, qPos: 2, strategy: 'no-repeat', playedSet, random,
  })
  assert.notEqual(idx, 2)
  // 重置后集合里只有当前曲目，其余 3 首重新成为候选
  assert.deepEqual([...playedSet], [q[2]])
})

test('不常听优先：池子 = 播放次数最少的前 35%（len=10 时池大小为 4）', () => {
  const q = paths(11)
  const counts = new Map()
  q.forEach((p, i) => counts.set(p, i === 0 ? 999 : 11 - i)) // 第 1..10 首播放次数 10..1
  const playCountOf = (p) => counts.get(p) || 0
  const call = (r) => pickNextShuffleIndex({
    queuePaths: q,
    qPos: 0,
    strategy: 'rare-first',
    playedSet: new Set(),
    playCountOf,
    random: () => r,
  })
  // 升序后最不常听的 4 首是下标 10,9,8,7（次数 1,2,3,4）
  assert.equal(call(0), 10)
  assert.equal(call(0.25), 9)
  assert.equal(call(0.50), 8)
  assert.equal(call(0.99), 7)
})

test('不常听优先：候选只剩 2 首时池大小 1，稳定选中播放次数更少的那首', () => {
  const q = paths(3)
  const counts = { [q[1]]: 5, [q[2]]: 1 }
  const idx = pickNextShuffleIndex({
    queuePaths: q,
    qPos: 0,
    strategy: 'rare-first',
    playedSet: new Set([q[1]]), // 只剩第 2 首候选
    playCountOf: (p) => counts[p] || 0,
    random: () => 0.9, // 池大小 1，随机数不影响结果
  })
  assert.equal(idx, 2)
})

test('真随机：只排除当前曲目，且不修改 playedSet', () => {
  const q = paths(5)
  const playedSet = new Set([q[1], q[3]])
  const snapshot = [...playedSet]
  const idx = pickNextShuffleIndex({
    queuePaths: q, qPos: 2, strategy: 'true-random', playedSet, random: () => 0.6,
  })
  assert.equal(idx, 3) // floor(0.6*5)=3，且不等于当前 2
  assert.deepEqual([...playedSet], snapshot, '真随机不该动本轮已播集合')
  // 命中的下标只要不是当前曲目都合法（真随机允许重复）
  const idx2 = pickNextShuffleIndex({
    queuePaths: q, qPos: 2, strategy: 'true-random', random: () => 0.1,
  })
  assert.equal(idx2, 0)
})

test('真随机：random 退化（恒定命中当前下标）时不死循环，顺延到下一首', () => {
  const q = paths(5)
  const idx = pickNextShuffleIndex({
    queuePaths: q, qPos: 2, strategy: 'true-random', random: () => 0.5, // floor(0.5*5)=2 == qPos
  })
  assert.equal(idx, 3)
  // 非法 random（NaN）也不产生越界/NaN 下标
  const idx2 = pickNextShuffleIndex({
    queuePaths: q, qPos: 4, strategy: 'no-repeat', playedSet: new Set(q.slice(0, 4)),
    random: () => NaN,
  })
  assert.ok(Number.isInteger(idx2) && idx2 >= 0 && idx2 < q.length)
})

test('注入 random 决定结果：默认 Math.random 也始终返回合法下标', () => {
  const q = paths(6)
  const mk = (r) => pickNextShuffleIndex({
    queuePaths: q, qPos: 1, strategy: 'no-repeat', playedSet: new Set(), random: () => r,
  })
  assert.equal(mk(0), 0)   // 候选 [0,2,3,4,5]，取第 0 个
  assert.equal(mk(0.99), 5) // 取最后一个候选
  for (let i = 0; i < 50; i++) {
    const idx = pickNextShuffleIndex({ queuePaths: q, qPos: 1, strategy: 'no-repeat' })
    assert.ok(Number.isInteger(idx) && idx >= 0 && idx < q.length && idx !== 1)
  }
})

test('不常听优先：播放次数一律为 0 时退化为不重复随机（一轮全覆盖）', () => {
  const q = paths(6)
  const playedSet = new Set()
  let qPos = 0
  const seen = []
  const random = seeded(99)
  for (let i = 0; i < 5; i++) {
    const idx = pickNextShuffleIndex({
      queuePaths: q, qPos, strategy: 'rare-first', playedSet, playCountOf: () => 0, random,
    })
    assert.ok(!seen.includes(idx))
    seen.push(idx)
    qPos = idx
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [1, 2, 3, 4, 5])
})

test('Android 同步副本 assets/js/random.js 与 lib/random.js 内容一致（防两边漂移）', () => {
  const lib = fs.readFileSync(path.join(ROOT, 'lib', 'random.js'), 'utf8')
  const android = fs.readFileSync(path.join(ROOT, 'android', 'app', 'assets', 'js', 'random.js'), 'utf8')
  assert.equal(android, lib, 'android/app/assets/js/random.js 必须与 lib/random.js 逐字节一致')
})

test('接线守门：桌面/Android 渲染层都调用 lib/random 的实现，而不是各自内联一份', () => {
  const appJs = fs.readFileSync(path.join(ROOT, 'renderer', 'js', 'app.js'), 'utf8')
  const desktopIndex = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8')
  const mobileJs = fs.readFileSync(path.join(ROOT, 'android', 'app', 'assets', 'js', 'mobile.js'), 'utf8')
  const androidIndex = fs.readFileSync(path.join(ROOT, 'android', 'app', 'assets', 'index.html'), 'utf8')

  assert.match(appJs, /MusicPlayRandom\.pickNextShuffleIndex/)
  assert.match(desktopIndex, /<script\s+src="\.\.\/lib\/random\.js"/)
  assert.match(mobileJs, /MusicPlayRandom\.pickNextShuffleIndex/)
  assert.match(androidIndex, /<script\s+src="js\/random\.js"/)
  // 反向守门：内联实现的关键特征（unplayed.sort / while 重抽）不应再出现在渲染层
  assert.doesNotMatch(appJs, /unplayed\.sort\(/)
  assert.doesNotMatch(mobileJs, /unplayed\.sort\(/)
})
