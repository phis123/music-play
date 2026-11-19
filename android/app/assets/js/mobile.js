/* music-play 安卓端 · 拆分中（剩余未迁移代码） */
'use strict';
window.MP = window.MP || {};

/* ---------------- 启动 ---------------- */
/** 同步宽屏标记；返回断点是否变了（变了才需要重绘） */
function syncWide() {
  let info = {};
  try { info = JSON.parse((A && A.deviceInfo && A.deviceInfo()) || '{}'); } catch (e) { }
  const w = info.dpWidth || window.innerWidth || 0;
  const wideNow = w >= 900, mainNow = w >= 600;
  const changed = wideNow !== S.wide || mainNow !== $('#main').classList.contains('wide');
  S.wide = wideNow;
  document.body.classList.toggle('wide', wideNow);
  $('#main').classList.toggle('wide', mainNow);
  return changed;
}

function boot() {
  hookDiag();
  diagLog('app', 'boot start, build=' + (function () { try { return (A && A.buildTag) ? A.buildTag() : 'web-preview'; } catch (e) { return '?'; } })());
  applyTheme();
  applyLyricsStyle();
  pushOverlayStyle();
  try {
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (mq && mq.addEventListener) {
      mq.addEventListener('change', () => { if (S.theme === 'auto') applyTheme(); });
    }
  } catch (e) { }
  syncWide();
  // 平板旋转 / 分屏 / 折叠展开：断点变了就重绘一次
  let rzTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(function () { if (syncWide()) render(); }, 180);
  });

  loadFavs();
  loadPlaylists();
  restoreImpState();
  grabBridge();
  // 首屏可能是空的（权限弹窗还没点、媒体库还没索引），多试几轮
  refreshLibrary([0, 900, 2200, 4000, 7000, 11000]);
}

function bindMini() {
  const mini = document.getElementById('mini');
  const npEl = document.getElementById('np');
  if (!mini || !npEl) return;
  const open = (ev) => {
    if (ev.target.closest('#miniPlay') || ev.target.closest('#miniNext') || ev.target.closest('#miniQueue')) return;
    openNpSheet();
  };
  mini.addEventListener('click', open);
}

document.addEventListener('DOMContentLoaded', () => { bindMini(); bindLyricsScrollGuard(); boot(); });

/* ---------------- <dialog> 弹层绑定 ---------------- */
(function bindSheetDialog() {
  const dlg = document.getElementById('sheetDlg');
  if (!dlg) return;
  // 点遮罩关闭（代替 Chrome 134 才有的 closedby="any"）
  dlg.addEventListener('click', function (e) {
    if (e.target === dlg) {
      if (S.sheet && S.sheet.kind === 'source' && S.srcSwitch.prevId) restoreSourceOriginal();
      closeSheet();
    }
  });
  // Esc：接管 cancel，统一走 closeSheet，保证 S.sheet 与 DOM 一致
  dlg.addEventListener('cancel', function (e) {
    e.preventDefault();
    if (S.sheet && S.sheet.kind === 'source' && S.srcSwitch.prevId) restoreSourceOriginal();
    closeSheet();
  });
  dlg.addEventListener('close', function () { dlg.classList.remove('open'); });
})();
