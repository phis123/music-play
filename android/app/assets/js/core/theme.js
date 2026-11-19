/*
 * core/theme.js — 主题与封面氛围色。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

/* ---------------- 主题与封面氛围色引擎 ---------------- */
function resolveTheme(mode) {
  if (mode === 'dark' || mode === 'light') return mode;
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch (e) { return 'light'; }
}

function applyTheme(mode) {
  if (mode) S.theme = mode;
  try { localStorage.setItem('theme', S.theme); } catch (e) { }
  const eff = resolveTheme(S.theme);
  document.documentElement.dataset.theme = eff;
  const meta = document.getElementById('metaThemeColor');
  if (meta) meta.setAttribute('content', eff === 'dark' ? '#111115' : '#ffffff');
  const lbl = document.getElementById('railThemeLabel');
  if (lbl) {
    lbl.textContent = '外观：' + (S.theme === 'dark' ? '深色' : S.theme === 'light' ? '浅色' : '跟随系统');
  }
}

function cycleTheme() {
  const next = S.theme === 'auto' ? 'dark' : S.theme === 'dark' ? 'light' : 'auto';
  applyTheme(next);
  if (S.page.name === 'me' || S.tab === 'me') render();
  toast('已切换为：' + (next === 'dark' ? '深色模式' : next === 'light' ? '浅色模式' : '跟随系统'));
}

const _ambientCache = new Map();

function extractAmbientColor(url) {
  if (!url) {
    document.documentElement.style.setProperty('--ambient-rgb', '236, 65, 65');
    return;
  }
  if (_ambientCache.has(url)) {
    document.documentElement.style.setProperty('--ambient-rgb', _ambientCache.get(url));
    return;
  }
  try {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        const c = document.createElement('canvas');
        c.width = 16; c.height = 16;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, 16, 16);
        const data = ctx.getImageData(0, 0, 16, 16).data;
        let rSum = 0, gSum = 0, bSum = 0, wSum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue;
          const max = Math.max(r, g, b), min = Math.min(r, g, b);
          const lum = (max + min) / 2;
          if (lum < 22 || lum > 238) continue;
          const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
          const w = 1 + sat * 3;
          rSum += r * w; gSum += g * w; bSum += b * w; wSum += w;
        }
        let rgb = '236, 65, 65';
        if (wSum > 0) {
          const rr = Math.round(rSum / wSum), gg = Math.round(gSum / wSum), bb = Math.round(bSum / wSum);
          rgb = `${rr}, ${gg}, ${bb}`;
        }
        _ambientCache.set(url, rgb);
        document.documentElement.style.setProperty('--ambient-rgb', rgb);
      } catch (e) { }
    };
    img.src = url;
  } catch (e) { }
}
