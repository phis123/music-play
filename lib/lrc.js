// LRC 解析（纯函数，无 Electron / IO 依赖，可在 plain node 里直接测试）。
// 原为 main.js:104-126 的内联函数，2026-11-16 为第 8 项“自动化测试”逐行移出，
// 行为未改：main.js 直接 require 本模块。配对规则仍是同时间戳（±30ms）
// 相邻两行 → 原文/译文配对；[offset:]、[ti:] 等元数据行仍按原行为忽略。
function parseLrc(text) {
  const rows = []
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*(.*)$/)
    if (!m) continue
    const ms = (+m[1]) * 60000 + (+m[2]) * 1000 + (m[3] ? +m[3].padEnd(2, '0').slice(0, 2) * 10 : 0)
    const body = m[4].trim()
    if (body) rows.push({ t: ms, text: body })
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
