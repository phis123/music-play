/**
 * core/dom.js — 基础 DOM 与格式化工具（$, audio 元素、转义、时间与 URL 格式化）
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */

export const $ = (s) => document.querySelector(s)

export const $$ = (s) => Array.from(document.querySelectorAll(s))

export const audio = $('#audio')


export const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a.9.9 0 0 0 1.38.77l10-6.4a.9.9 0 0 0 0-1.54l-10-6.4A.9.9 0 0 0 8 5.6z"/></svg>'

export const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.2" y="5" width="3.4" height="14" rx="1.4"/><rect x="13.4" y="5" width="3.4" height="14" rx="1.4"/></svg>'


export const MODE_ICONS = {
  loop: '<path d="M17 2l4 4-4 4V7H7a3 3 0 0 0-3 3v2H2v-2a5 5 0 0 1 5-5h10V2zM7 22l-4-4 4-4v3h10a3 3 0 0 0 3-3v-2h2v2a5 5 0 0 1-5 5H7v3z"/>',
  shuffle: '<path d="M17 3.6l3.4 3.4-3.4 3.4V8.3h-1.7c-1.2 0-2 .5-2.8 1.6l-.9 1.2-1.2-1.6.7-1C12.3 6.7 13.6 6 15.3 6H17V3.6zM3 6h2.3c1.7 0 3 .7 4.2 2.2l5.1 6.9c.8 1.1 1.6 1.6 2.8 1.6H20v-2.1l3.4 3.4L20 21.4v-2.7h-2.6c-1.7 0-3-.7-4.2-2.2L8.1 9.6C7.3 8.5 6.5 8 5.3 8H3V6zm0 10h2.3c.5 0 .9-.1 1.3-.3l1.3 1.7c-.8.4-1.7.6-2.6.6H3v-2z"/>',
  one: '<path d="M17 2l4 4-4 4V7H7a3 3 0 0 0-3 3v2H2v-2a5 5 0 0 1 5-5h10V2zM7 22l-4-4 4-4v3h10a3 3 0 0 0 3-3v-2h2v2a5 5 0 0 1-5 5H7v3zm4.2-13h1.8v6h-1.6v-4.3l-1.2.8-.7-1.1 1.7-1.4z"/>',
}


/* ---------------- 工具 ---------------- */
export const fmt = (s) => {
  if (!isFinite(s) || s < 0) s = 0
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export const cleanTitle = (t) => String(t || '').replace(/^\d{1,3}\s*[-_.、)\]]\s*/, '').trim() || String(t || '')

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const toFileUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/').split('/')
  .map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join('/')


export const fmtDur = (sec) => {
  sec = Math.round(sec || 0)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export const fmtPlays = (n) => (n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n || 0))
