/*
 * core/state.js — 全局共享状态 S（即 MP.state），仅在启动时创建一次。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

const S = {
  tracks: [],
  favs: new Set(),
  playlists: [],
  tab: 'home',
  page: { name: 'home', arg: null },   // home | me | local | liked | playlists | playlist
  q: '',
  cur: -1,
  queue: [],                            // 当前播放序列（数组 index 指向 tracks 或 fav/pl 列表）
  queuePaths: [],
  playing: false,
  pos: 0,
  dur: 0,
  lyrics: [],
  lyricIdx: -1,
  offset: 0,
  covers: new Map(),
  wide: false,
  online: { q: '', loading: false, songs: [], err: '' },
  mode: (function () {
    try {
      const m = localStorage.getItem('playMode');
      if (m === 'loop' || m === 'shuffle' || m === 'one') return m;
      return localStorage.getItem('shuffle') === '1' ? 'shuffle' : 'loop';
    } catch (e) { return 'loop'; }
  })(),
  shuffle: (function () {
    try {
      const m = localStorage.getItem('playMode');
      if (m) return m === 'shuffle';
      return localStorage.getItem('shuffle') === '1';
    } catch (e) { return false; }
  })(),
  hist: [],
  sheet: { kind: '', arg: null },
  voices: { song: null, list: [], loading: false, err: '', busy: {} },
  lastUserScrollAt: 0,
  _restoredNeedsPlay: false,
  _sessionRestored: false,
  srcSwitch: { track: null, kw: '', loading: false, cands: [], err: '', prevId: '', busyId: '', savedPos: 0 },
  theme: (function () { try { return localStorage.getItem('theme') || 'auto'; } catch (e) { return 'auto'; } })(),
  listFilter: '',
  listSort: 'default',
  healthTab: 'dup',
  task: { active: false, kind: '', title: '', sub: '', done: 0, total: 0, ok: 0, fail: 0, errors: [], indet: false, stopLabel: '' },
  normEnabled: (function () { try { const v = localStorage.getItem('mob:normEnabled'); return v == null ? true : v === '1'; } catch (e) { return true; } })(),
  normPreset: (function () { try { return localStorage.getItem('mob:normPreset') || 'standard'; } catch (e) { return 'standard'; } })(),
  randomStrategy: (function () { try { return localStorage.getItem('mob:randomStrategy') || 'no-repeat'; } catch (e) { return 'no-repeat'; } })(),
  shufflePlayed: new Set(),
  lrcSize: (function () { try { return Math.min(28, Math.max(14, +(localStorage.getItem('mob:lrcSize') || 18))); } catch (e) { return 18; } })(),
  lrcColor: (function () { try { return localStorage.getItem('mob:lrcColor') || '#ec4141'; } catch (e) { return '#ec4141'; } })(),
  floatColor: (function () { try { return localStorage.getItem('mob:floatColor') || '#ffffff'; } catch (e) { return '#ffffff'; } })(),
  floatSizeSp: (function () { try { return Math.min(28, Math.max(12, +(localStorage.getItem('mob:floatSizeSp') || 18))); } catch (e) { return 18; } })(),
  floatBgOpacity: (function () { try { return Math.min(80, Math.max(0, +(localStorage.getItem('mob:floatBgOpacity') || 0))); } catch (e) { return 0; } })(),
  diagLastPath: '',
  diagSnapshotText: '',
};

window.MP.state = S;
