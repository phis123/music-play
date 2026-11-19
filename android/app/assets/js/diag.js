/*
 * diag.js — 诊断日志与导出（runDiagExport 等），供原生广播调用。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

/* ---------------- 诊断日志（偶发问题/机型适配定位） ---------------- */
/** 写一条诊断日志：落盘到 Android/data/<pkg>/files/diag/session.log，并打 logcat */
function diagLog(tag, msg) {
  try { if (A && typeof A.diagLog === 'function') A.diagLog(String(tag || 'js'), String(msg == null ? '' : msg)); } catch (e) { }
}

/** 收集前端关键状态，写进导出包的 state.json（不含任何音频内容） */

/** 收集前端关键状态，写进导出包的 state.json（不含任何音频内容） */
function diagCollectState() {
  const ls = {};
  try {
    const keep = ['mob:normEnabled', 'mob:normPreset', 'mob:randomStrategy', 'mob:lrcSize', 'mob:lrcColor',
      'mob:floatColor', 'mob:floatSizeSp', 'mob:floatBgOpacity', 'theme', 'playMode', 'player:pos'];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (keep.indexOf(k) >= 0 || k.indexOf('player:') === 0 || k.indexOf('off:') === 0)) {
        const v = localStorage.getItem(k);
        ls[k] = (v && v.length > 300) ? (v.slice(0, 300) + '…(' + v.length + ')') : v;
      }
    }
    let keys = 0, bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      keys++;
      bytes += k.length + (localStorage.getItem(k) || '').length;
    }
    ls.__meta = { keyCount: keys, approxBytes: bytes, metaKeys: Object.keys(localStorage).filter(x => x.indexOf('meta:') === 0).length };
  } catch (e) { }
  let errs = [];
  try { errs = (S.task && S.task.errors || []).slice(-10).map(x => (x.name || '') + ' → ' + (x.reason || '')); } catch (e) { }
  return JSON.stringify({
    build: (function () { try { return A && A.buildTag ? A.buildTag() : 'web-preview'; } catch (e) { return '?'; } })(),
    theme: S.theme, normEnabled: S.normEnabled, normPreset: S.normPreset,
    randomStrategy: S.randomStrategy, lrcSize: S.lrcSize, lrcColor: S.lrcColor,
    curPath: S.queuePaths[S.cur] || '', queueLen: S.queuePaths.length, cur: S.cur,
    playing: S.playing, previewing: !!S.previewPath, pos: Math.round(S.pos || 0), dur: Math.round(S.dur || 0),
    tracks: S.tracks.length, coversCached: S.covers ? S.covers.size : -1,
    deviceInfo: (function () { try { return JSON.parse((A && A.deviceInfo && A.deviceInfo()) || '{}'); } catch (e) { return {}; } })(),
    localStorage: ls, taskErrors: errs,
  }, null, 2);
}

/**
 * 导出诊断包（UI 按钮与原生广播共用）：
 * 先让原生写入前端状态 state.json，再触发原生打包，最后把路径回显到设置页。
 */

/**
 * 导出诊断包（UI 按钮与原生广播共用）：
 * 先让原生写入前端状态 state.json，再触发原生打包，最后把路径回显到设置页。
 */
function runDiagExport(from) {
  try {
    diagLog('diag', (from || 'ui') + ' 触发导出诊断包');
    if (A && typeof A.diagState === 'function') A.diagState(diagCollectState());
    const p = (A && typeof A.diagExport === 'function') ? A.diagExport() : '';
    if (p) {
      S.diagLastPath = p;
      try { render(); } catch (e) { }
      toast('诊断包已生成：' + p);
      diagLog('diag', '导出完成 ' + p);
    } else {
      toast('导出失败，请确认存储可用');
      diagLog('diag', '导出失败（原生返回空路径）');
    }
    return p;
  } catch (err) {
    toast('导出异常：' + (err.message || err));
    diagLog('diag', '导出异常 ' + (err && err.stack ? err.stack : err));
    return '';
  }
}
/** 供原生广播调用：窗口未解锁/用户不在场时也能跑完整前端导出路径 */
window.__diagFromNative = function () { return runDiagExport('native-broadcast'); };

let _diagHooked = false;

function hookDiag() {
  if (_diagHooked) return;
  _diagHooked = true;
  window.addEventListener('error', (ev) => {
    try {
      const t = ev && ev.target;
      const where = t && t !== window ? (t.src || t.tagName || '') : (ev.filename || '');
      diagLog('js-error', (ev.message || '') + ' @ ' + where + ':' + (ev.lineno || 0) + ':' + (ev.colno || 0)
        + (ev.error && ev.error.stack ? '\n' + String(ev.error.stack).slice(0, 1500) : ''));
    } catch (e) { }
  }, true);
  window.addEventListener('unhandledrejection', (ev) => {
    try {
      const r = ev && ev.reason;
      diagLog('js-reject', (r && (r.stack || r.message) ? String(r.stack || r.message) : String(r)).slice(0, 1500));
    } catch (e) { }
  });
  ['onPlayerError', 'onEnded', 'onAppResume'].forEach((fn) => {
    const orig = window[fn];
    if (typeof orig !== 'function') return;
    window[fn] = function () {
      try { diagLog('native-cb', fn + ' args=' + Array.prototype.slice.call(arguments).join(',')); } catch (e) { }
      try { return orig.apply(this, arguments); } catch (e) { diagLog('native-cb-err', fn + ' → ' + e); throw e; }
    };
  });
  diagLog('app', 'hookDiag 已安装');
}

/** 关键事件落盘：logcat 被刷掉也能事后取证（路径见 Bridge.diag） */
function diag(msg) {
  try { if (A && typeof A.diag === 'function') A.diag(String(msg)); } catch (e) { }
}

/** 试听不建队列，但 mini 条与播放页必须跟着试听走：
 *  以前只更新播放图标，标题/封面/歌手仍是上一首，看起来像「放的是上首歌」。 */
