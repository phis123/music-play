/*
 * library/scan.js — 曲库扫描/刷新与路径索引。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

const _trackByPathMap = new Map();

/* ---------------- 数据 ---------------- */
/** 按文件名兜底找元数据（目录变更后键会变） */
function metaByBase(path) {
  const base = String(path).split('/').pop();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k.indexOf('meta:') !== 0) continue;
      if (k.split('/').pop() === base) {
        const m = JSON.parse(localStorage.getItem(k) || 'null');
        if (m) {
          localStorage.setItem('meta:' + path, JSON.stringify(m));  // 迁移到新键
          return m;
        }
      }
    }
  } catch (e) { }
  return null;
}

function loadLibrary() {
  if (!A) return;
  try {
    const raw = A.listAudio();
    const arr = JSON.parse(raw || '[]');
    S.tracks = arr.filter((t) => t && t.path);
    _trackByPathMap.clear();
    // 立刻套用本地缓存的原歌曲元数据（作者/专辑/封面/歌词）并建立 O(1) 索引
    for (let i = 0; i < S.tracks.length; i++) {
      const t = S.tracks[i];
      t._idx = i;
      _trackByPathMap.set(t.path, t);
      try {
        let m = null;
        const cached = localStorage.getItem('meta:' + t.path);
        if (cached) { try { m = JSON.parse(cached) } catch (e) { } }
        if (!m) m = metaByBase(t.path);
        if (!m) continue;
        if (m.title) t.title = m.title;
        if (m.artist) t.artist = m.artist;
        if (m.album) t.album = m.album;
        if (m.cover) t.cover = m.cover;
        if (m.hasLrc) t.hasLrc = true;
        if (m.alias) t.alias = String(m.alias).split('|');
        // v2 缓存才算补全过；老缓存要留机会让 enrichTracks 补别名
        if (m.v === 2) t._enriched = true;
      } catch (e) { }
    }
  } catch (e) {
    S.tracks = [];
    _trackByPathMap.clear();
    diagLog('library', 'loadLibrary 失败: ' + (e && (e.stack || e.message) || e));
  }
  return S.tracks.length;
}

/** 重新读库并重绘；空了就隔一会儿再试（权限刚批 / 媒体库还没扫完很常见） */

/** 重新读库并重绘；空了就隔一会儿再试（权限刚批 / 媒体库还没扫完很常见） */
let libTimer = null;

function refreshLibrary(delays) {
  const seq = Array.isArray(delays) && delays.length ? delays : [0, 800, 2000, 4000];
  clearTimeout(libTimer);
  let i = 0;
  const step = () => {
    grabBridge();
    loadLibrary();
    restorePlayerSession();
    render();
    checkMediaStoreHint();
    diagLog('library', 'tracks=' + S.tracks.length + ' root=' + (function () { try { return (A && A.rootDir) ? A.rootDir() : ''; } catch (e) { return ''; } })());
    if (S.tracks.length || i >= seq.length - 1) {
      if (!S.tracks.length) { try { if (A && A.rescan) A.rescan(); } catch (e) { } }
      return;
    }
    i++;
    libTimer = setTimeout(step, seq[i] - seq[i - 1]);
  };
  step();
}

/** 系统媒体库不可用（缺「音乐和音频」权限）时提示一次，避免整库显示「未知艺人」 */

/** 系统媒体库不可用（缺「音乐和音频」权限）时提示一次，避免整库显示「未知艺人」 */
let _msHinted = false;

function checkMediaStoreHint() {
  if (_msHinted || !S.tracks.length) return;
  let ok = true;
  try { ok = A && typeof A.mediaStoreOk === 'function' ? !!A.mediaStoreOk() : true; } catch (e) { ok = true; }
  if (ok) return;
  _msHinted = true;
  const noArtist = S.tracks.filter((t) => !t.artist).length;
  if (noArtist === 0) return;
  setTimeout(() => {
    toast(`系统媒体库不可用，已改用文件内嵌标签读取歌手（${noArtist} 首无歌手）`);
  }, 1200);
}

/** 强制重建歌手/专辑标签与封面：清 ID3 缓存 + 清封面内存缓存 + 重新扫描 */

/** 强制重建歌手/专辑标签与封面：清 ID3 缓存 + 清封面内存缓存 + 重新扫描 */
function rebuildTagsAndCovers() {
  try { if (A && A.clearTagCache) A.clearTagCache(); } catch (e) { }
  S.covers.clear();
  _coverMiss.clear();
  try { if (A && A.rescan) A.rescan(); } catch (e) { }
  startTask('enrich', '正在重建歌手与封面', '已清空标签缓存，重新扫描曲库…', 1, false);
  setTimeout(() => {
    refreshLibrary([0, 1200, 2600]);
    setTimeout(() => finishTask('歌手与封面已重建', '已按文件内嵌标签重新读取曲库信息', 4000), 2800);
  }, 400);
}

const trackByPath = (p) => _trackByPathMap.get(p) || S.tracks.find((t) => t.path === p);

const favTracks = () => [...S.favs].map(trackByPath).filter(Boolean);
