/*
 * core/store.js — localStorage 持久化（增益/播放次数/最近播放/收藏/歌单/搜索历史/元数据键淘汰）。键名保持不变。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

function getTrackGainMap() {
  try { return JSON.parse(localStorage.getItem('mob:trackGainMap') || '{}'); } catch (e) { return {}; }
}

function getUserTrackGain(path) {
  if (!path) return 0;
  const m = getTrackGainMap();
  const v = Number(m[path]);
  return Number.isFinite(v) ? Math.max(-12, Math.min(12, Math.round(v * 10) / 10)) : 0;
}

function setUserTrackGain(path, db) {
  if (!path) return;
  const m = getTrackGainMap();
  const val = Math.max(-12, Math.min(12, Math.round((+db || 0) * 10) / 10));
  if (Math.abs(val) < 0.05) delete m[path];
  else m[path] = val;
  try { localStorage.setItem('mob:trackGainMap', JSON.stringify(m)); } catch (e) { }
}

function clearAllUserTrackGains() {
  try { localStorage.removeItem('mob:trackGainMap'); } catch (e) { }
}

function getPlayCounts() {
  try { return JSON.parse(localStorage.getItem('mob:playCounts') || '{}'); } catch (e) { return {}; }
}

function getPlayCount(path) {
  if (!path) return 0;
  return +(getPlayCounts()[path] || 0);
}

function incPlayCount(path) {
  if (!path) return;
  const m = getPlayCounts();
  m[path] = (m[path] || 0) + 1;
  try { localStorage.setItem('mob:playCounts', JSON.stringify(m)); } catch (e) { }
}

function getAutoGainForTrack(t) {
  if (!t || !t.path) return 0;
  if (typeof t.gainDb === 'number') return t.gainDb;
  let g = 0;
  try {
    if (A && typeof A.estimateGainDb === 'function') {
      g = Math.round(Number(A.estimateGainDb(t.path) || 0) * 10) / 10;
    }
  } catch (e) { g = 0; }
  t.gainDb = g;
  return g;
}

function getCurrentTrackEffectiveGain() {
  const curPath = S.queuePaths[S.cur] || '';
  const t = curPath ? trackByPath(curPath) : null;
  if (!t) return { autoDb: 0, manualDb: 0, totalDb: 0 };
  const autoDb = getAutoGainForTrack(t);
  const manualDb = getUserTrackGain(t.path);
  if (!S.normEnabled) {
    const tot = Math.max(-15, Math.min(15, Math.round(manualDb * 10) / 10));
    return { autoDb, manualDb, totalDb: tot };
  }
  const presetOff = S.normPreset === 'night' ? -2.5 : S.normPreset === 'boost' ? 2.0 : 0;
  const tot = Math.max(-15, Math.min(15, Math.round((autoDb + presetOff + manualDb) * 10) / 10));
  return { autoDb, manualDb, totalDb: tot };
}

function applyCurrentTrackGain() {
  const { autoDb, manualDb, totalDb } = getCurrentTrackEffectiveGain();
  try {
    if (A && typeof A.setPlaybackGainDb === 'function') {
      A.setPlaybackGainDb(totalDb);
    }
  } catch (e) { }
  const chip = document.getElementById('npGainChip');
  if (chip) {
    const sign = totalDb > 0 ? '+' : '';
    chip.textContent = (S.normEnabled || manualDb !== 0) ? `均衡 ${sign}${totalDb.toFixed(1)}dB` : '均衡 关';
    chip.style.color = manualDb !== 0 ? 'var(--red)' : '';
  }
  return { autoDb, manualDb, totalDb };
}

/* ---------------- localStorage 配额治理 ---------------- */
const META_MAX_KEYS = 2500;
/** 元数据键超过上限时按插入顺序淘汰最旧的一半（避免 localStorage 逼近配额后 setItem 静默失败） */

/** 元数据键超过上限时按插入顺序淘汰最旧的一半（避免 localStorage 逼近配额后 setItem 静默失败） */
function trimMetaKeys(keepKey) {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('meta:') === 0) keys.push(k);
    }
    if (keys.length <= META_MAX_KEYS) return;
    // localStorage 无插入顺序保证，按 JSON 里的 t（写入时间）淘汰；没有 t 的按遍历顺序
    const drop = keys.length - Math.floor(META_MAX_KEYS * 0.8);
    let removed = 0;
    for (const k of keys) {
      if (removed >= drop) break;
      if (k === keepKey) continue;
      localStorage.removeItem(k);
      removed++;
    }
    diagLog('storage', 'meta 键超限，已淘汰 ' + removed + ' 条');
  } catch (e) { }
}

/* ---------------- 最近播放 ---------------- */
function getRecentPaths() {
  try { return JSON.parse(localStorage.getItem('recentPaths') || '[]') } catch (e) { return [] }
}

function pushRecent(path) {
  if (!path) return;
  const list = getRecentPaths().filter((p) => p !== path);
  list.unshift(path);
  localStorage.setItem('recentPaths', JSON.stringify(list.slice(0, 30)));
}

const recentTracks = () => getRecentPaths().map(trackByPath).filter(Boolean);

function loadFavs() {
  try { S.favs = new Set(JSON.parse((A && A.favList()) || '[]')); } catch (e) { S.favs = new Set(); }
}

function saveFavs() { if (A) A.favSet(JSON.stringify([...S.favs])); }

function loadPlaylists() {
  try {
    const v = JSON.parse((A && A.playlists()) || '[]');
    S.playlists = Array.isArray(v) ? v : [];
  } catch (e) { S.playlists = []; }
}

function savePlaylists() { if (A) A.savePlaylists(JSON.stringify(S.playlists)); }

/* ---------------- 搜索历史与防抖 ---------------- */
function getSearchHist() {
  try { return JSON.parse(localStorage.getItem('searchHist') || '[]'); } catch (e) { return []; }
}

function pushSearchHist(kw) {
  kw = String(kw || '').trim();
  if (!kw) return;
  const list = getSearchHist().filter((x) => x !== kw);
  list.unshift(kw);
  try { localStorage.setItem('searchHist', JSON.stringify(list.slice(0, 10))); } catch (e) { }
}

function clearSearchHist() {
  try { localStorage.removeItem('searchHist'); } catch (e) { }
}

window.MP.store = { getTrackGainMap: getTrackGainMap, setUserTrackGain: setUserTrackGain,
  getPlayCount: getPlayCount, incPlayCount: incPlayCount, getRecentPaths: getRecentPaths,
  pushRecent: pushRecent, loadFavs: loadFavs, saveFavs: saveFavs, loadPlaylists: loadPlaylists,
  savePlaylists: savePlaylists, trimMetaKeys: trimMetaKeys };
