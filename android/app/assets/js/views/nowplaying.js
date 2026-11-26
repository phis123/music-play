/*
 * views/nowplaying.js — 播放页视图与声音候选列表。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

/** 声音候选行 */
function voiceRow(v, i) {
  const busy = S.voices.busy[v.mainTrackId];
  return `<div class="row">
    <div class="row-cover" style="background-image:url('${esc(v.cover || '')}')"></div>
    <div class="row-main">
      <div class="row-title">${esc(v.title || '未命名声音')}</div>
      <div class="row-sub">${esc(v.radio || '未知电台')} · ${fmt(v.duration)}</div>
    </div>
    <button class="pv-btn" data-pv="${i}" aria-label="试听">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.6v12.8a.9.9 0 0 0 1.38.77l10-6.4a.9.9 0 0 0 0-1.54l-10-6.4A.9.9 0 0 0 8 5.6z"/></svg>
    </button>
    <button class="dl-btn" data-dl="${i}" ${busy ? 'disabled' : ''}>${busy || '下载'}</button>
  </div>`;
}

/** 声音候选没有 artist 字段：dj / radio 才是可读的来源名 */

/** 声音候选没有 artist 字段：dj / radio 才是可读的来源名 */
function voiceArtist(v) {
  if (!v) return '在线试听';
  return v.dj || v.radio || '在线试听';
}

function viewVoices() {
  const v = S.voices;
  const head = v.song
    ? `<div class="section" style="margin-top:4px">
         <div class="section-title">${esc(v.song.name)}</div>
         <div class="section-more">${esc(v.song.artist || '')}</div>
       </div>`
    : '';
  const body = v.loading
    ? '<div class="search-hint">正在匹配播客声音…</div>'
    : v.err ? `<div class="search-hint err">${esc(v.err)}</div>`
    : v.list.length ? v.list.map(voiceRow).join('')
    : '<div class="empty"><div class="big">没有找到声音</div><div>换个歌试试</div></div>';
  return `<div class="page-shell">${backBar('匹配声音')}${head}${body}
    <div class="search-hint" style="margin-top:14px">共 ${v.list.length} 个可下载声音</div></div>`;
}

function openNpSheet() {
  const npEl = document.getElementById('np');
  if (!npEl) return;
  npEl.classList.remove('hidden');
  const sec = S.pos || 0;
  const pct = S.dur ? Math.min(100, (sec / S.dur) * 100) : 0;
  const curEl = document.getElementById('npCur');
  if (curEl) curEl.textContent = fmt(sec);
  const r = document.getElementById('npRange');
  if (r && !r.dataset.drag) {
    r.value = Math.round(pct * 10);
    r.style.setProperty('--seek-pct', pct.toFixed(1) + '%');
  }
  S.lyricIdx = -2;
  syncLyric(sec);
}

// mini 播放条 & 播放页控制
