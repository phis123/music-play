/*
 * player/queue.js — 播放队列、下一首插入、随机/循环策略。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

function shuffled(list) {
  const a = (list || []).slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const x = a[i]; a[i] = a[j]; a[j] = x;
  }
  return a;
}

const MODE_ICONS = {
  loop: '<path d="M17 2l4 4-4 4V7H7a3 3 0 0 0-3 3v2H2v-2a5 5 0 0 1 5-5h10V2zM7 22l-4-4 4-4v3h10a3 3 0 0 0 3-3v-2h2v2a5 5 0 0 1-5 5H7v3z"/>',
  shuffle: '<path d="M17 3.6l3.4 3.4-3.4 3.4V8.3h-1.7c-1.2 0-2 .5-2.8 1.6l-.9 1.2-1.2-1.6.7-1C12.3 6.7 13.6 6 15.3 6H17V3.6zM3 6h2.3c1.7 0 3 .7 4.2 2.2l5.1 6.9c.8 1.1 1.6 1.6 2.8 1.6H20v-2.1l3.4 3.4L20 21.4v-2.7h-2.6c-1.7 0-3-.7-4.2-2.2L8.1 9.6C7.3 8.5 6.5 8 5.3 8H3V6zm0 10h2.3c.5 0 .9-.1 1.3-.3l1.3 1.7c-.8.4-1.7.6-2.6.6H3v-2z"/>',
  one: '<path d="M17 2l4 4-4 4V7H7a3 3 0 0 0-3 3v2H2v-2a5 5 0 0 1 5-5h10V2zM7 22l-4-4 4-4v3h10a3 3 0 0 0 3-3v-2h2v2a5 5 0 0 1-5 5H7v3zm4.2-13h1.8v6h-1.6v-4.3l-1.2.8-.7-1.1 1.7-1.4z"/>',
};

function paintShuffle() {
  const b = document.getElementById('npShuffle');
  if (b) {
    b.classList.toggle('on', S.mode !== 'loop');
    const ic = document.getElementById('npModeIcon') || b.querySelector('svg');
    if (ic) ic.innerHTML = MODE_ICONS[S.mode] || MODE_ICONS.loop;
  }
  const sub = document.getElementById('npHeadSub');
  if (sub) {
    const mName = S.mode === 'shuffle' ? '随机播放' : S.mode === 'one' ? '单曲循环' : '顺序循环';
    sub.textContent = S.queuePaths.length ? `${mName} · ${S.cur + 1} / ${S.queuePaths.length}` : '本地曲库';
  }
  const qc = document.getElementById('npQueueCount');
  if (qc) qc.textContent = S.queuePaths.length ? String(S.queuePaths.length) : '';
}

function setPlayMode(mode) {
  S.mode = mode;
  S.shuffle = (mode === 'shuffle');
  S.hist = [];
  try {
    localStorage.setItem('playMode', mode);
    localStorage.setItem('shuffle', S.shuffle ? '1' : '0');
  } catch (e) { }
  paintShuffle();
  savePlayerSession();
}

function ensureShuffle() {
  if (S.mode === 'shuffle') return;
  setPlayMode('shuffle');
}

function toggleShuffle() {
  const next = S.mode === 'loop' ? 'shuffle' : S.mode === 'shuffle' ? 'one' : 'loop';
  setPlayMode(next);
  toast(next === 'shuffle' ? '随机播放' : next === 'one' ? '单曲循环' : '顺序循环');
  if (S.sheet && S.sheet.kind === 'queue') refreshOpenSheet();
}

function playShuffleAll() {
  if (!S.tracks.length) return;
  ensureShuffle();
  const list = shuffled(S.tracks);
  playAt(list, 0);
  toast('随机播放 ' + list.length + ' 首');
}

function refreshOpenSheet() {
  const dlg = sheetDlg();
  if (dlg && dlg.open && S.sheet && S.sheet.kind) {
    dlg.innerHTML = sheetHtml();
  }
}

/* ---------------- 播放队列操作 & 下一首播放 ---------------- */
function openQueueSheet() {
  openSheet('queue');
  setTimeout(() => {
    const curEl = document.querySelector('#qListBox .q-item.cur');
    if (curEl && curEl.scrollIntoView) {
      try { curEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { }
    }
  }, 60);
}

function playNextInsert(t) {
  if (!t) return;
  if (!S.queuePaths.length || S.cur < 0) {
    playAt([t], 0);
    toast('开始播放：' + (t.title || ''));
    return;
  }
  if (S.queuePaths[S.cur] === t.path) {
    toast('当前正在播放这首歌');
    return;
  }
  const curPath = S.queuePaths[S.cur];
  const existIdx = S.queuePaths.indexOf(t.path);
  if (existIdx >= 0) {
    S.queuePaths.splice(existIdx, 1);
    S.cur = S.queuePaths.indexOf(curPath);
  }
  S.queuePaths.splice(S.cur + 1, 0, t.path);
  paintShuffle();
  savePlayerSession();
  toast('已设为下一首播放：' + (t.title || ''));
}

// 三策略算法已下沉到 assets/js/random.js（与桌面端 lib/random.js 逐字节同步的
// 普通 script 副本，Android WebView 不能 require）；这里只做状态适配。
function pickNextShuffleIndexMobile() {
  // 兜底：assets/js/random.js 缺失时退化为真随机
  if (typeof MusicPlayRandom === 'undefined' || !MusicPlayRandom.pickNextShuffleIndex) {
    return Math.floor(Math.random() * Math.max(1, S.queuePaths.length))
  }
  return MusicPlayRandom.pickNextShuffleIndex({
    queuePaths: S.queuePaths,
    qPos: S.cur,
    strategy: S.randomStrategy || 'no-repeat',
    playedSet: S.shufflePlayed,
    playCountOf: getPlayCount,
  });
}

function playAt(list, i) {
  const t = list[i];
  if (!t) return;
  pushRecent(t.path);
  incPlayCount(t.path);
  S.queuePaths = list.map((x) => x.path);
  S.cur = i;
  S.playing = true;
  S._restoredNeedsPlay = false;
  if (A) A.playEx(t.path, t.title || '', t.artist || '', t.cover || '');
  applyCurrentTrackGain();
  showMini(t);
  loadLyrics(t);
  paintPlayIcon();
  paintShuffle();
  savePlayerSession();
  updatePlayingRowInPlace();
}

function queueNext(delta, autoEnded) {
  if (!S.queuePaths.length) return;
  let i;
  if (autoEnded && S.mode === 'one' && S.cur >= 0) {
    i = S.cur;
  } else if (S.mode === 'shuffle' && delta > 0) {
    i = pickNextShuffleIndexMobile();
    S.hist.push(S.cur);
    if (S.hist.length > 300) S.hist.shift();
  } else if (S.mode === 'shuffle' && delta < 0 && S.hist.length) {
    i = S.hist.pop();
  } else {
    i = S.cur + delta;
    if (i < 0) i = S.queuePaths.length - 1;
    if (i >= S.queuePaths.length) i = 0;
  }
  const t = trackByPath(S.queuePaths[i]);
  if (!t) return;
  pushRecent(t.path);
  incPlayCount(t.path);
  S.cur = i;
  S.playing = true;
  S._restoredNeedsPlay = false;
  if (A) A.playEx(t.path, t.title || '', t.artist || '', t.cover || '');
  applyCurrentTrackGain();
  showMini(t);
  loadLyrics(t);
  paintPlayIcon();
  paintShuffle();
  savePlayerSession();
  if (S.sheet && (S.sheet.kind === 'queue' || S.sheet.kind === 'npset')) refreshOpenSheet();
  updatePlayingRowInPlace();
}
