// LRC 解析（纯函数，无 Electron / IO 依赖，可在 plain node 里直接测试）。
// 原为 main.js:104-126 的内联函数，2026-11-16 为第 8 项“自动化测试”逐行移出，
// 行为未改：main.js 直接 require 本模块。配对规则仍是同时间戳（±30ms）
// 相邻两行 → 原文/译文配对；[offset:]、[ti:] 等元数据行仍按原行为忽略。
function parseLrc(text) {
  const rows = []
  // 一行可带多个时间戳：`[00:01.00][00:05.00]Hello` → 两个独立的歌词行
  const TS_RE = /^\s*\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/
  for (const raw of text.split(/\r?\n/)) {
    let rest = raw
    const times = []
    let m
    while ((m = rest.match(TS_RE))) {
      const frac = m[3]
      // 毫秒位按位数换算：1 位 ×100、2 位 ×10、3 位直取（原实现把 .456 截成 450ms）
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

module.exports = { parseLrc }
