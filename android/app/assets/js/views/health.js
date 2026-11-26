/*
 * views/health.js — 曲库体检。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

/* ---------------- 曲库体检视图 (Phase 3) ---------------- */
function analyzeLibraryHealth() {
  const byKey = new Map();
  const dupSet = new Set();
  const noLrc = [];
  const noMeta = [];
  const shortClips = [];

  for (const t of S.tracks) {
    const k = normName(t.title || '');
    if (k) {
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(t);
    }
    if (!t.hasLrc) noLrc.push(t);
    if (!t.artist || (!t.cover && !S.covers.get(t.path))) noMeta.push(t);
    const d = +(t.duration || 0);
    if (d > 0 && d < 25) shortClips.push(t);
  }
  const dups = [];
  for (const [, group] of byKey) {
    if (group.length > 1) {
      group.forEach((x) => { if (!dupSet.has(x.path)) { dupSet.add(x.path); dups.push(x); } });
    }
  }
  return { dups, noLrc, noMeta, shortClips };
}

function viewHealth() {
  const h = analyzeLibraryHealth();
  const tab = S.healthTab || 'dup';
  const cards = [
    ['dup', '疑似重复', h.dups.length],
    ['lrc', '缺少歌词', h.noLrc.length],
    ['meta', '缺歌手/封面', h.noMeta.length],
    ['short', '异常短音频(<25s)', h.shortClips.length],
  ];
  const curList = tab === 'dup' ? h.dups : tab === 'lrc' ? h.noLrc : tab === 'meta' ? h.noMeta : h.shortClips;
  _currentShownTracks = curList;
  _pendingSongList = curList;
  _pendingSongPlId = undefined;
  const firstSlice = curList.slice(0, SONG_FIRST_CHUNK);
  const descMap = {
    dup: '同名或高度相似的本地音频文件，可对比时长/码率后清理多余副本',
    lrc: '尚未匹配到本地 .lrc 歌词的曲目，可点右上角「一键补齐歌词与封面」',
    meta: '缺少歌手名或专辑封面的曲目，可一键联网自动补齐',
    short: '时长不足 25 秒的音频（可能是试听片段或损坏文件），可点播放后「换声源」重下',
  };
  return `<div class="page-shell">${backBar('曲库体检')}
    <div class="health-head">
      <span class="sub">共扫描 ${S.tracks.length} 首本地音频</span>
      <div class="health-head-acts">
        <button class="hero-btn" id="healthRebuildTags">${ico('refresh', 'ico-xs')}<span>重建歌手/封面</span></button>
        <button class="hero-btn pri" id="healthFillMeta">${ico('sparkle', 'ico-xs')}<span>一键补齐缺失</span></button>
      </div>
    </div>
    <div class="health-grid">
      ${cards.map(([k, lbl, cnt]) => `
        <div class="health-stat${tab === k ? ' on' : ''}" data-health-tab="${k}">
          <div class="health-stat-num">${cnt}</div>
          <div class="health-stat-label">${lbl}</div>
        </div>`).join('')}
    </div>
    <div class="sub health-desc">${descMap[tab] || ''}</div>
    ${curList.length
      ? `<div class="list-2col" id="songGridBox">${firstSlice.map((t, k) => songRow(t, t._idx, undefined, k)).join('')}</div>`
      : `<div class="empty"><div class="big">这一项没有发现问题</div><div>曲库状态非常健康</div></div>`}
  </div>`;
}
