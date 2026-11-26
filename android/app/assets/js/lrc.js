/**
 * LRC 解析（纯函数，UMD）—— 桌面主进程 / Android WebView / Node 单测共用同一份实现。
 *
 * 规则：
 * - 单行支持多时间戳展开：`[00:01.00][00:05.00]Hello` → 两条独立歌词
 * - 毫秒位按位数换算：1 位 ×100、2 位 ×10、3 位直取
 * - 全部行按时间戳升序排列
 * - 相邻行时间差 ≤30ms 合并为一组 `pair`（原文 + 译文，支持三行同戳）
 * - `[offset:]`、`[ti:]` 等元数据行忽略
 *
 * 加载方式：Node 下 `require('../lib/lrc')`；浏览器用 `<script>` 引入得到 `window.MusicPlayLrc`。
 */
;(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.MusicPlayLrc = factory()
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'

  function parseLrc(text) {
    const rows = []
    const TS_RE = /^\s*\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/
    for (const raw of String(text || '').split(/\r?\n/)) {
      let rest = raw
      const times = []
      let m
      while ((m = rest.match(TS_RE))) {
        const frac = m[3]
        let ms = 0
        if (frac) {
          if (frac.length === 1) ms = +frac * 100
          else if (frac.length === 2) ms = +frac * 10
          else ms = +frac.slice(0, 3)
        }
        times.push((+m[1]) * 60000 + (+m[2]) * 1000 + ms)
        rest = rest.slice(m[0].length)
      }
      if (!times.length) continue
      const body = rest.trim()
      if (!body) continue
      for (const t of times) rows.push({ t, text: body })
    }
    rows.sort((a, b) => a.t - b.t)
    const out = []
    for (const r of rows) {
      const prev = out[out.length - 1]
      if (prev && Math.abs(prev.t - r.t) <= 30) {
        prev.pair = prev.pair || [prev.text]
        prev.pair.push(r.text)
      } else {
        out.push({ t: r.t, text: r.text, pair: null })
      }
    }
    return out
  }

  return { parseLrc }
}))
