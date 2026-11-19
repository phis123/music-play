/**
 * 随机播放策略（纯函数）——桌面渲染层 / Android assets / Node 单测共用同一份实现
 *
 * 背景：v1.0.8 之前「随机播放三策略」分别内联在 renderer/js/app.js 与
 * android/app/assets/js/mobile.js 的两份 pickNextShuffleIndex 里，既无法单测，
 * 又容易改一边忘一边。这里把算法抽成一个无 DOM、无状态依赖的纯函数：
 *
 *   pickNextShuffleIndex({ queuePaths, qPos, strategy, playedSet, playCountOf, random })
 *
 * 返回下一个队列下标。三个策略：
 *   - 'no-repeat'  ：本轮未播池里随机，全部播完才重置（保证一轮内不重复）
 *   - 'rare-first' ：在「播完池」基础上，按播放次数升序取最不常听的前 35% 随机
 *   - 'true-random'：全队列真随机，只排除当前曲目
 *
 * 可测试性：`random` 可注入（默认 Math.random），因此单测可以完全确定性。
 * 副作用：为保持与旧实现行为一致，除 'true-random' 外会就地修改调用方传入的
 * playedSet（加入当前曲目；本轮播完时清空并重新以当前曲目为种子）。
 *
 * 加载方式：UMD。Node 下 `require('../lib/random')`；浏览器里用普通 <script>
 * 引入后得到 `window.MusicPlayRandom`（Android 侧是 assets/js/random.js 的同步副本）。
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.MusicPlayRandom = factory()
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  /** 三种随机策略的合法取值（渲染层下拉框/持久化校验共用） */
  const SHUFFLE_STRATEGIES = ['no-repeat', 'rare-first', 'true-random']

  /** 不常听优先：从「播放次数最少」的前 35% 池中随机 */
  const RARE_POOL_RATIO = 0.35

  /**
   * 从 [0, size) 里取一个下标；对注入的异常 random（NaN / <0 / >=1）做夹取，
   * 避免出现越界下标把渲染层带到 undefined 曲目。
   */
  function pickRandomIndex(size, random) {
    if (size <= 0) return 0
    const v = Math.floor(random() * size)
    if (!Number.isFinite(v) || v < 0) return 0
    return v >= size ? size - 1 : v
  }

  /** 本轮未播池：排除当前下标与已播过的路径 */
  function collectUnplayed(queuePaths, qPos, playedSet) {
    const out = []
    for (let i = 0; i < queuePaths.length; i++) {
      if (i !== qPos && !playedSet.has(queuePaths[i])) out.push(i)
    }
    return out
  }

  /**
   * 真随机：只保证「不与当前曲目相同」。
   * 旧实现是 `while (idx === qPos) idx = ...`，如果 random 被桩住/退化就会死循环；
   * 这里最多试 64 次，仍撞车则顺延到下一首，保证一定终止。
   */
  function pickTrueRandom(n, qPos, random) {
    if (qPos < 0 || qPos >= n) return pickRandomIndex(n, random)
    let idx = qPos
    for (let tries = 0; tries < 64 && idx === qPos; tries++) {
      idx = pickRandomIndex(n, random)
    }
    return idx === qPos ? (qPos + 1) % n : idx
  }

  /**
   * @param {object} options
   * @param {string[]} options.queuePaths 当前播放队列（曲目绝对路径）
   * @param {number} options.qPos 当前曲目在队列中的下标；-1 表示无
   * @param {'no-repeat'|'rare-first'|'true-random'} [options.strategy] 默认 'no-repeat'
   * @param {Set<string>} [options.playedSet] 本轮已播路径集合（会被就地修改）
   * @param {(path:string)=>number} [options.playCountOf] 取某路径累计播放次数
   * @param {()=>number} [options.random] 随机源，默认 Math.random（可注入用于确定性测试）
   * @returns {number} 下一首在 queuePaths 中的下标
   */
  function pickNextShuffleIndex(options) {
    const opts = options || {}
    const queuePaths = Array.isArray(opts.queuePaths) ? opts.queuePaths : []
    const n = queuePaths.length
    if (n <= 1) return 0

    const strategy = opts.strategy || 'no-repeat'
    const random = typeof opts.random === 'function' ? opts.random : Math.random
    const qPos = Number.isInteger(opts.qPos) ? opts.qPos : -1

    if (strategy === 'true-random') {
      return pickTrueRandom(n, qPos, random)
    }

    const playedSet = opts.playedSet instanceof Set ? opts.playedSet : new Set()
    const playCountOf = typeof opts.playCountOf === 'function'
      ? opts.playCountOf
      : function () { return 0 }

    const curPath = (qPos >= 0 && qPos < n) ? queuePaths[qPos] : null
    if (curPath != null) playedSet.add(curPath)

    let unplayed = collectUnplayed(queuePaths, qPos, playedSet)

    // 本轮全部播完：重置池子，并把当前曲目重新作为「已播」种子（与旧行为一致）
    if (!unplayed.length) {
      playedSet.clear()
      if (curPath != null) playedSet.add(curPath)
      unplayed = collectUnplayed(queuePaths, qPos, playedSet)
    }

    if (strategy === 'rare-first' && unplayed.length > 1) {
      unplayed.sort((a, b) => playCountOf(queuePaths[a]) - playCountOf(queuePaths[b]))
      const poolSize = Math.max(1, Math.ceil(unplayed.length * RARE_POOL_RATIO))
      return unplayed[pickRandomIndex(poolSize, random)]
    }
    return unplayed[pickRandomIndex(unplayed.length, random)]
  }

  return { pickNextShuffleIndex, SHUFFLE_STRATEGIES, RARE_POOL_RATIO }
}))
