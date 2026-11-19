/*
 * player/playback.js — 播放控制（播放/暂停/恢复）与播放状态持久化。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

/* ---------------- 播放状态持久化与恢复 ---------------- */
let _posSaveTimer = 0;

function savePlayerSession(posOnly) {
  try {
    if (!posOnly && S.queuePaths.length && S.cur >= 0) {
      localStorage.setItem('player:session', JSON.stringify({
        q: S.queuePaths.slice(0, 500),
        cur: S.cur,
        path: S.queuePaths[S.cur] || '',
      }));
    }
    if (S.queuePaths[S.cur]) {
      localStorage.setItem('player:pos', JSON.stringify({
        path: S.queuePaths[S.cur],
        pos: Math.floor(S.pos || 0),
      }));
    }
  } catch (e) { }
}

function restorePlayerSession() {
  if (S._sessionRestored || !S.tracks.length || S.queuePaths.length) return;
  S._sessionRestored = true;
  try {
    const raw = JSON.parse(localStorage.getItem('player:session') || 'null');
    if (!raw || !Array.isArray(raw.q) || !raw.q.length) return;
    const valid = raw.q.filter((p) => !!trackByPath(p));
    if (!valid.length) return;
    let idx = valid.indexOf(raw.path);
    if (idx < 0) idx = Math.min(Math.max(0, raw.cur || 0), valid.length - 1);
    const t = trackByPath(valid[idx]);
    if (!t) return;
    S.queuePaths = valid;
    S.cur = idx;
    const posObj = JSON.parse(localStorage.getItem('player:pos') || 'null');
    const savedSec = (posObj && posObj.path === t.path && posObj.pos > 0) ? posObj.pos : 0;
    S.pos = savedSec;
    S.dur = t.duration || 0;
    S._restoredNeedsPlay = !(A && A.isPlaying && A.isPlaying());
    showMini(t);
    loadLyrics(t);
    const pct = S.dur ? Math.min(100, (savedSec / S.dur) * 100) : 0;
    $('#miniBar').style.width = pct + '%';
    $('#npCur').textContent = fmt(savedSec);
    const r = $('#npRange');
    if (r) {
      r.value = Math.round(pct * 10);
      r.style.setProperty('--seek-pct', pct.toFixed(1) + '%');
    }
    if (savedSec > 0) syncLyric(savedSec);
    paintPlayIcon();
    paintShuffle();
  } catch (e) { }
}

/* ---------------- 播放（O(1) 局部高亮更新，不重建大列表 DOM） ---------------- */
function updatePlayingRowInPlace() {
  const curPath = S.queuePaths[S.cur] || '';
  document.querySelectorAll('.row.playing').forEach((row) => {
    if (row.dataset.path !== curPath) {
      row.classList.remove('playing');
      const slot = row.querySelector('.row-eq-slot');
      if (slot) slot.innerHTML = '';
      else row.querySelector('.eq-bars')?.remove();
    }
  });
  if (!curPath) return;
  const curTrack = trackByPath(curPath);
  if (!curTrack || curTrack._idx == null) return;
  document.querySelectorAll(`.row[data-song="${curTrack._idx}"]`).forEach((row) => {
    row.classList.add('playing');
    const eqHtml = `<span class="eq-bars${S.playing ? '' : ' paused'}"><i></i><i></i><i></i></span>`;
    const slot = row.querySelector('.row-eq-slot');
    if (slot) slot.innerHTML = eqHtml;
  });
}

// 三策略算法已下沉到 assets/js/random.js（与桌面端 lib/random.js 逐字节同步的
// 普通 script 副本，Android WebView 不能 require）；这里只做状态适配。

function paintNpFav() {
  if (S.previewPath) {
    const b0 = document.getElementById('npFav');
    const i0 = document.getElementById('npFavIcon');
    if (b0) b0.classList.remove('on');
    if (i0) i0.setAttribute('fill', 'none');
    return;
  }
  const curPath = S.queuePaths[S.cur] || '';
  const on = !!(curPath && S.favs.has(curPath));
  const btn = document.getElementById('npFav');
  const ic = document.getElementById('npFavIcon');
  if (btn) btn.classList.toggle('on', on);
  if (ic) ic.setAttribute('fill', on ? 'currentColor' : 'none');
}

function showMini(t) {
  // 非试听占用时自动退出试听展示模式
  if (S.previewPath && t && t.path !== S.previewPath) S.previewPath = null;
  const m = $('#mini');
  m.classList.remove('hidden');
  $('#miniTitle').textContent = t.title || '未知标题';
  $('#miniArtist').textContent = t.artist || '未知艺人';
  coverFor(t, $('#miniCover'));
  coverFor(t, $('#npCover'));
  const url = S.covers.get(t.path) || '';
  const bg = $('#npBg');
  if (bg) {
    bg.style.backgroundImage = url ? `url("${url}")` : '';
  }
  extractAmbientColor(url);
  $('#npTitle').textContent = t.title || '未知标题';
  $('#npArtist').textContent = t.artist || '未知艺人';
  S.dur = t.duration || 0;
  $('#npDur').textContent = fmt(S.dur);
  paintNpFav();
  paintShuffle();
  applyCurrentTrackGain();
}

/** 关键事件落盘：logcat 被刷掉也能事后取证（路径见 Bridge.diag） */

/** 试听不建队列，但 mini 条与播放页必须跟着试听走：
 *  以前只更新播放图标，标题/封面/歌手仍是上一首，看起来像「放的是上首歌」。 */
function enterPreviewMode(title, artist, coverUrl, durSec) {
  const path = 'preview:' + Date.now();
  S.previewPath = path;
  // 关键：试听也属于「已经播过东西」，必须清掉恢复会话标志，
  // 否则之后点「恢复」会被 _restoredNeedsPlay 分支劫走，去重播队列里的本地歌。
  S._restoredNeedsPlay = false;
  S.covers.set(path, coverUrl || '');
  showMini({
    path,
    title: title || '试听',
    artist: artist || '在线试听',
    cover: coverUrl || '',
    duration: durSec || 0,
  });
  S.playing = true;
  paintPlayIcon();
  const box = document.getElementById('npLyrics') || document.getElementById('lyricsBox');
  if (box) box.innerHTML = '<div class="lyric-line">试听片段，暂无歌词</div>';
}

function exitPreviewMode() { S.previewPath = null; }

function paintPlayIcon() {
  // discSpinToggle: 唱盘旋转跟随播放状态
  document.querySelector('.np-stage')?.classList.toggle('playing', S.playing);
  const play = '<path d="M8 5.6v12.8a.9.9 0 0 0 1.38.77l10-6.4a.9.9 0 0 0 0-1.54l-10-6.4A.9.9 0 0 0 8 5.6z"/>';
  const pause = '<rect x="7.2" y="5" width="3.4" height="14" rx="1.4"/><rect x="13.4" y="5" width="3.4" height="14" rx="1.4"/>';
  $('#miniIcon').innerHTML = S.playing ? pause : play;
  $('#npIcon').innerHTML = S.playing ? pause : play;
  document.querySelectorAll('.eq-bars').forEach((el) => el.classList.toggle('paused', !S.playing));
}

function togglePlayPause() {
  // 试听不建立播放队列，所以「队列为空」不能等价于「不能播放」
  if (S._restoredNeedsPlay && !S.playing && !S.previewPath && S.queuePaths.length) {
    const t = trackByPath(S.queuePaths[S.cur]);
    if (t && A) {
      const savedSec = S.pos || 0;
      S._restoredNeedsPlay = false;
      S.playing = true;
      A.playEx(t.path, t.title || '', t.artist || '', t.cover || '');
      if (savedSec > 1) {
        setTimeout(() => { try { A.seek(Math.round(savedSec * 1000)); } catch (e) { } }, 220);
      }
      paintPlayIcon();
      return;
    }
  }
  if (!A) return;
  if (S.playing) {
    A.pause();
    diag('pause 发出');
    let stillPlaying = false;
    try { stillPlaying = !!(A.isPlaying && A.isPlaying()); } catch (e) { }
    S.playing = stillPlaying;
    paintPlayIcon();
    if (stillPlaying) toast('暂停失败，请重试');
    return;
  }
  S._restoredNeedsPlay = false;
  A.resume();
  S.playing = true;
  paintPlayIcon();
  diag('resume 发出');
  checkAfterResume(0);
}

/** 恢复后按原生状态复核；第一次失败就让原生重开数据源，第二次仍失败才认输 */

/** 恢复后按原生状态复核；第一次失败就让原生重开数据源，第二次仍失败才认输 */
function checkAfterResume(attempt) {
  setTimeout(() => {
    let ok = true;
    try { ok = !!(A && A.isPlaying && A.isPlaying()); } catch (e) { }
    diag('resume 复核#' + attempt + ' ok=' + ok + ' playing(JS)=' + S.playing);
    if (ok) return;
    if (attempt === 0 && A && typeof A.recover === 'function') {
      diag('resume 复核失败 → 请求原生重开');
      try { A.recover(); } catch (e) { }
      checkAfterResume(1);
      return;
    }
    if (S.playing) {
      S.playing = false;
      paintPlayIcon();
      toast('恢复播放失败，请重新点「试听」');
      diag('resume 最终失败，界面回滚为暂停');
    }
  }, 1800);
}
