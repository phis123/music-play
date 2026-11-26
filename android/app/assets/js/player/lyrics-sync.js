/*
 * player/lyrics-sync.js — LRC 解析、歌词渲染/同步、悬浮词推送与手动滚动保护。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

function applyLyricsStyle() {
  document.documentElement.style.setProperty('--lrc-size', (S.lrcSize || 18) + 'px');
  document.documentElement.style.setProperty('--lrc-accent', S.lrcColor || '#ec4141');
  try {
    localStorage.setItem('mob:lrcSize', String(S.lrcSize || 18));
    localStorage.setItem('mob:lrcColor', S.lrcColor || '#ec4141');
  } catch (e) { }
}

let _overlayStyleTimer = null;

function pushOverlayStyle(immediate) {
  const applyNow = () => {
    try {
      localStorage.setItem('mob:floatColor', S.floatColor);
      localStorage.setItem('mob:floatSizeSp', String(S.floatSizeSp));
      localStorage.setItem('mob:floatBgOpacity', String(S.floatBgOpacity));
      if (A && typeof A.overlaySetStyle === 'function') {
        const sz = Math.max(12, Math.min(30, Math.round(+S.floatSizeSp || 18)));
        const alpha = Math.max(0, Math.min(220, Math.round(((+S.floatBgOpacity || 0) / 100) * 255)));
        A.overlaySetStyle(String(S.floatColor || '#ffffff'), sz, alpha);
      } else if (A && typeof A.overlayColor === 'function') {
        A.overlayColor(String(S.floatColor || '#ffffff'));
      }
    } catch (e) { }
  };
  if (immediate !== false) {
    clearTimeout(_overlayStyleTimer);
    applyNow();
  } else {
    clearTimeout(_overlayStyleTimer);
    _overlayStyleTimer = setTimeout(applyNow, 45);
  }
}

/* ---------------- 歌词 ---------------- */
function setOffset(ms) {
  const p = S.queuePaths[S.cur];
  if (!p) return;
  S.offset = Math.max(-5000, Math.min(5000, Math.round(ms)));
  localStorage.setItem('off:' + p, String(S.offset));
  const el = document.getElementById('npOffset');
  if (el) el.textContent = (S.offset > 0 ? '+' : '') + (S.offset / 1000).toFixed(1) + 's';
  S.lyricIdx = -2;
  syncLyric(S.pos || 0);
}

function loadLyrics(t) {
  S.lyrics = [];
  S.lyricIdx = -1;
  S.lastUserScrollAt = 0;
  document.getElementById('npResume')?.classList.add('hidden');
  S.offset = +(localStorage.getItem('off:' + t.path) || 0);
  const offEl = $('#npOffset');
  if (offEl) offEl.textContent = (S.offset > 0 ? '+' : '') + (S.offset / 1000).toFixed(1) + 's';
  if (!A || !t.hasLrc) { renderLyrics(); return; }
  const lrcPath = t.path.replace(/\.[^.]+$/, '') + '.lrc';
  let txt = A.readText(lrcPath);
  if (!txt && A.loadLyric) txt = A.loadLyric(t.path);
  if (!txt && A.loadLyricByBase) txt = A.loadLyricByBase(t.path);
  if (!txt) { renderLyrics(); return; }
  S.lyrics = parseLrc(txt);
  renderLyrics();
}

function parseLrc(txt) {
  const shared = window.MusicPlayLrc && window.MusicPlayLrc.parseLrc;
  if (typeof shared !== 'function') return [];
  return shared(txt).map((r) => ({
    t: r.t / 1000,
    text: r.pair ? r.pair[0] : r.text,
    tr: r.pair ? r.pair.slice(1).join(' / ') : '',
  }));
}

function renderLyrics() {
  const box = $('#npLyrics');
  const pm = document.getElementById('npPeekMain');
  const ps = document.getElementById('npPeekSub');
  if (!S.lyrics.length) {
    box.innerHTML = '<div class="np-empty">暂无歌词 · 可点下方「换声源」或等待自动补全</div>';
    if (pm) pm.textContent = '暂无歌词';
    if (ps) ps.textContent = '轻点唱片切换歌词视图';
    return;
  }
  if (pm) pm.textContent = S.lyrics[0].text || '轻点唱片查看双语歌词';
  if (ps) ps.textContent = S.lyrics[0].tr || (S.lyrics[1] ? S.lyrics[1].text : '');
  box.innerHTML = S.lyrics.map((l, i) =>
    `<div class="np-line" data-line="${i}">${esc(l.text)}</div>` +
    (l.tr ? `<div class="np-line tr" data-line="${i}">${esc(l.tr)}</div>` : '')
  ).join('');
  box.querySelectorAll('[data-line]').forEach((el) => {
    el.addEventListener('click', () => {
      const l = S.lyrics[+el.dataset.line];
      if (l && A) {
        S.lastUserScrollAt = 0;
        document.getElementById('npResume')?.classList.add('hidden');
        A.seek(Math.round(l.t * 1000));
      }
    });
  });
}

function pushOverlay() {
  if (!A || !A.overlayText || !A.overlayShown || !A.overlayShown()) return;
  const i = S.lyricIdx;
  if (i == null || i < 0 || !S.lyrics[i]) { A.overlayText('', ''); return; }
  A.overlayText(S.lyrics[i].text || '', S.lyrics[i].tr || '');
}

function scrollToCurrentLyric() {
  const first = document.querySelector(`[data-line="${S.lyricIdx}"]`);
  if (!first) return;
  const box = $('#npLyrics');
  if (!box) return;
  const top = first.offsetTop - box.clientHeight / 2 + first.clientHeight / 2;
  box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function syncLyric(sec) {
  if (!S.lyrics.length) return;
  const t = sec - S.offset / 1000;
  let idx = -1;
  for (let i = 0; i < S.lyrics.length; i++) if (S.lyrics[i].t <= t + 0.05) idx = i;
  const userScrolling = (Date.now() - (S.lastUserScrollAt || 0)) < 3800;
  document.getElementById('npResume')?.classList.toggle('hidden', !userScrolling);
  if (idx === S.lyricIdx) return;
  S.lyricIdx = idx;
  document.querySelectorAll('#npLyrics .np-line').forEach((e) => {
    const li = +e.dataset.line;
    const dist = Math.abs(li - idx);
    e.classList.toggle('cur', li === idx);
    e.classList.toggle('near', dist === 1);
    e.classList.toggle('far', dist >= 3);
  });
  if (idx < 0) return;
  const curL = S.lyrics[idx];
  const pm = document.getElementById('npPeekMain');
  const ps = document.getElementById('npPeekSub');
  if (pm && curL) pm.textContent = curL.text || '';
  if (ps && curL) ps.textContent = curL.tr || (S.lyrics[idx + 1] ? S.lyrics[idx + 1].text : '');
  pushOverlay();
  if (!userScrolling) scrollToCurrentLyric();
}

/* ---------------- 歌词手动滚动防抢夺 ---------------- */
function bindLyricsScrollGuard() {
  const box = document.getElementById('npLyrics');
  if (!box) return;
  const markManual = () => {
    if (!S.lyrics.length) return;
    S.lastUserScrollAt = Date.now();
    document.getElementById('npResume')?.classList.remove('hidden');
  };
  box.addEventListener('touchmove', markManual, { passive: true });
  box.addEventListener('wheel', markManual, { passive: true });
}
