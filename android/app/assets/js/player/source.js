/*
 * player/source.js — 播放页「更换声源」。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

/* ---------------- 播放页直接「更换声源」 ---------------- */
async function openSourceSwitcher() {
  const curPath = S.queuePaths[S.cur];
  const t = curPath ? trackByPath(curPath) : null;
  if (!t) { toast('请先播放一首本地歌曲'); return; }
  const kw = (String(t.title || '') + ' ' + String(t.artist || '')).trim();
  S.srcSwitch = {
    track: t,
    kw: kw,
    loading: true,
    cands: [],
    err: '',
    prevId: '',
    busyId: '',
    savedPos: S.pos || 0,
  };
  openSheet('source');
  await searchSourceCands(kw);
}

async function searchSourceCands(kw) {
  const sw = S.srcSwitch;
  const t = sw.track;
  if (!t) return;
  kw = String(kw || '').trim();
  sw.kw = kw;
  sw.loading = true;
  sw.err = '';
  refreshOpenSheet();
  try {
    if (!window.neta) throw new Error('离线模式不可用');
    let raw = await voiceSearchCached(kw || t.title, 14);
    const seen = new Set((raw || []).map((v) => String(v.mainTrackId)));
    const targetDur = +(t.duration || 0);
    const songObj = { name: t.title || kw, duration: targetDur };
    const goodCount = (raw || []).filter((v) => !scoreVoice(songObj, v).bad).length;
    if (goodCount < 3 && t.title && kw !== t.title) {
      try {
        const more = await voiceSearchCached(t.title, 12);
        (more || []).forEach((v) => {
          if (!seen.has(String(v.mainTrackId))) { raw.push(v); seen.add(String(v.mainTrackId)); }
        });
      } catch (e) { }
    }
    const scored = (raw || []).map((v) => {
      const s = scoreVoice(songObj, v);
      return { v: v, score: s.score, gap: s.gap, bad: s.bad, badKind: s.badKind, why: s.why };
    }).sort((a, b) => b.score - a.score);
    sw.cands = scored;
    sw.loading = false;
  } catch (e) {
    sw.loading = false;
    sw.err = '搜索声源失败：' + (e.message || e);
  }
  refreshOpenSheet();
}

async function previewSourceCand(idx) {
  const sw = S.srcSwitch;
  const item = sw.cands[idx];
  if (!item || !item.v) return;
  const v = item.v;
  const id = String(v.mainTrackId);
  if (sw.prevId === id && S.playing) {
    restoreSourceOriginal();
    return;
  }
  try {
    sw.prevId = id;
    refreshOpenSheet();
    toast('正在获取试听：' + (v.title || ''));
    let u = await window.neta.songUrl(v.mainTrackId);
    if ((!u || !u.url) && window.neta.songUrlV1) {
      u = await window.neta.songUrlV1(v.mainTrackId, 'exhigh');
    }
    if (!u || !u.url) {
      sw.prevId = '';
      refreshOpenSheet();
      toast('该声源暂不可试听');
      return;
    }
    if (A && typeof A.previewEx === 'function') A.previewEx(u.url, v.title || '声源试听', voiceArtist(v), v.cover || '');
    else if (A) A.preview(u.url, v.title || '声源试听', v.cover || '');
    let started2 = true;
    try { if (A && typeof A.isPlaying === 'function') started2 = !!A.isPlaying(); } catch (e2) { }
    if (started2) enterPreviewMode(v.title || '声源试听', voiceArtist(v), v.cover, v.duration);
    else { S.playing = false; paintPlayIcon(); }
    refreshOpenSheet();
  } catch (e) {
    sw.prevId = '';
    refreshOpenSheet();
    toast('试听失败：' + (e.message || e));
  }
}

function restoreSourceOriginal() {
  const sw = S.srcSwitch;
  sw.prevId = '';
  const t = sw.track;
  if (t && A) {
    A.playEx(t.path, t.title || '', t.artist || '', t.cover || '');
    if (sw.savedPos > 2) {
      setTimeout(() => { try { A.seek(Math.round(sw.savedPos * 1000)); } catch (e) { } }, 220);
    }
    S.playing = true;
    paintPlayIcon();
  }
  refreshOpenSheet();
}

async function applySourceCand(idx) {
  const sw = S.srcSwitch;
  const item = sw.cands[idx];
  const t = sw.track;
  if (!item || !item.v || !t) return;
  if (!storageOK()) { closeSheet(); askStorage(); return; }
  const v = item.v;
  sw.busyId = String(v.mainTrackId);
  sw.dlPct = 5;
  sw.dlText = '正在获取高音质下载地址…';
  sw.dlErr = '';
  refreshOpenSheet();
  try {
    let u = await window.neta.songUrl(v.mainTrackId);
    if ((!u || !u.url) && window.neta.songUrlV1) {
      u = await window.neta.songUrlV1(v.mainTrackId, 'exhigh');
    }
    if (!u || !u.url) throw new Error('拿不到该声源的音频地址（可能受版权或网络限制）');
    sw.dlPct = 12;
    sw.dlText = '正在下载替换音频文件…';
    refreshOpenSheet();
    const oldPath = t.path;
    const fileName = String(oldPath).split('/').pop() || (String(t.title || '未知歌曲').replace(/[\\/:*?"<>|]/g, '_') + '.mp3');
    let oldMeta = {};
    try { oldMeta = JSON.parse(localStorage.getItem('meta:' + oldPath) || '{}') || {}; } catch (e) { oldMeta = {}; }
    window.__dlCtx = {
      song: {
        name: t.title || oldMeta.title || '',
        artist: t.artist || oldMeta.artist || '',
        album: t.album || oldMeta.album || '',
        cover: t.cover || oldMeta.cover || v.cover || '',
        alias: t.alias || (oldMeta.alias ? String(oldMeta.alias).split('|') : []),
      },
      voice: v,
      lrc: '',
    };
    const res = await downloadOnce(u.url, fileName, '');
    if (!res || !res.ok) throw new Error((res && res.p) || '下载替换失败');
    const newPath = (res.p && res.p.indexOf('/') >= 0) ? res.p : oldPath;
    const updatedMeta = {
      artist: t.artist || oldMeta.artist || '',
      album: t.album || oldMeta.album || '',
      cover: t.cover || oldMeta.cover || v.cover || '',
      hasLrc: !!(t.hasLrc || oldMeta.hasLrc),
      title: t.title || oldMeta.title || '',
      alias: Array.isArray(t.alias) ? t.alias.join('|') : (oldMeta.alias || ''),
      voiceId: v.voiceId || v.mainTrackId,
      mainTrackId: v.mainTrackId,
      voiceTitle: v.title || '',
      v: 2,
    };
    try {
      localStorage.setItem('meta:' + newPath, JSON.stringify(updatedMeta));
      if (newPath !== oldPath) localStorage.setItem('meta:' + oldPath, JSON.stringify(updatedMeta));
    } catch (e) { }
    t.duration = v.duration || t.duration;
    if (newPath !== oldPath) {
      S.queuePaths = S.queuePaths.map((p) => p === oldPath ? newPath : p);
      if (S.favs.has(oldPath)) { S.favs.delete(oldPath); S.favs.add(newPath); saveFavs(); }
      S.playlists.forEach((pl) => { pl.tracks = pl.tracks.map((p) => p === oldPath ? newPath : p); });
      savePlaylists();
      t.path = newPath;
    }
    loadLibrary();
    const fresh = trackByPath(newPath) || t;
    fresh.duration = v.duration || fresh.duration;
    sw.busyId = '';
    sw.prevId = '';
    sw.dlPct = 100;
    sw.dlErr = '';
    closeSheet();
    if (A) A.playEx(fresh.path, fresh.title || '', fresh.artist || '', fresh.cover || '');
    S.playing = true;
    showMini(fresh);
    loadLyrics(fresh);
    paintPlayIcon();
    render();
    toast('已更换声源：' + (v.title || ''));
  } catch (e) {
    sw.busyId = '';
    sw.dlErr = '更换声源失败：' + (e.message || e);
    refreshOpenSheet();
    toast(sw.dlErr);
  }
}
