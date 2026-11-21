/**
 * core/theme.js — 主题解析与应用、封面取色氛围背景
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { $ } from './dom.js'
import { state } from './state.js'
import { toast } from './ui.js'


/* ---------------- 主题与封面氛围色引擎 (Phase 2) ---------------- */
export function resolveTheme(mode) {
  if (mode === 'dark' || mode === 'light') return mode
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch { return 'light' }
}

export function applyTheme(mode) {
  if (mode) state.theme = mode
  try { localStorage.setItem('desk:theme', state.theme) } catch { }
  const eff = resolveTheme(state.theme)
  document.documentElement.dataset.theme = eff
  const lbl = $('#themeLabel')
  if (lbl) {
    lbl.textContent = '外观：' + (state.theme === 'dark' ? '深色' : state.theme === 'light' ? '浅色' : '跟随系统')
  }
}

export function cycleTheme() {
  const next = state.theme === 'auto' ? 'dark' : state.theme === 'dark' ? 'light' : 'auto'
  applyTheme(next)
  toast('已切换外观：' + (next === 'dark' ? '深色模式' : next === 'light' ? '浅色模式' : '跟随系统'))
}


export const _ambientCache = new Map()

export function extractAmbientColor(url) {
  if (!url) {
    document.documentElement.style.setProperty('--ambient-rgb', '236, 65, 65')
    return
  }
  if (_ambientCache.has(url)) {
    document.documentElement.style.setProperty('--ambient-rgb', _ambientCache.get(url))
    return
  }
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = function () {
      try {
        const c = document.createElement('canvas')
        c.width = 16; c.height = 16
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0, 16, 16)
        const data = ctx.getImageData(0, 0, 16, 16).data
        let rSum = 0, gSum = 0, bSum = 0, wSum = 0
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
          if (a < 128) continue
          const max = Math.max(r, g, b), min = Math.min(r, g, b)
          const lum = (max + min) / 2
          if (lum < 20 || lum > 238) continue
          const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255))
          const w = 1 + sat * 3
          rSum += r * w; gSum += g * w; bSum += b * w; wSum += w
        }
        let rgb = '236, 65, 65'
        if (wSum > 0) {
          rgb = `${Math.round(rSum / wSum)}, ${Math.round(gSum / wSum)}, ${Math.round(bSum / wSum)}`
        }
        _ambientCache.set(url, rgb)
        document.documentElement.style.setProperty('--ambient-rgb', rgb)
      } catch { }
    }
    img.src = url
  } catch { }
}
