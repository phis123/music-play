/*
 * events.js — document 级事件总编排（严格保持原委托优先级，具体处理拆至 events/ 子模块）。
 * 依赖：events/player.js、events/library.js、events/settings.js。
 */
'use strict';
window.MP = window.MP || {};

function handleTopLevelClick(e) {
  if (e.target.closest('[data-task-err]')) {
    e.stopPropagation();
    openSheet('taskerr', null);
    return true;
  }
  if (e.target.closest('[data-task-dismiss]')) {
    e.stopPropagation();
    dismissTask();
    return true;
  }
  if (e.target.closest('[data-task-stop]')) {
    e.stopPropagation();
    if (S.task.kind === 'enrich') window.__enrichStop = true;
    else if (S.task.kind === 'impmatch') window.__impMatchStop = true;
    else if (S.task.kind === 'impdl') window.__impStop = true;
    toast('正在停止当前任务…');
    return true;
  }
  if (e.target.closest('[data-enrich-now]')) {
    e.stopPropagation();
    enrichTracks(true);
    return true;
  }
  if (e.target.closest('[data-np]') && !e.target.closest('#miniPlay') && !e.target.closest('#miniNext') && !e.target.closest('#miniQueue')) {
    document.getElementById('np').classList.remove('hidden');
    return true;
  }
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { setTab(tabBtn.dataset.tab); return true; }

  if (e.target.closest('[data-rescan]')) {
    e.stopPropagation();
    manualRescan();
    return true;
  }

  const favBtn = e.target.closest('[data-fav]');
  if (favBtn) {
    e.stopPropagation();
    const favIdx = +favBtn.dataset.fav;
    const t = S.tracks[favIdx];
    if (!t) return true;
    const nowOn = !S.favs.has(t.path);
    if (nowOn) S.favs.add(t.path); else S.favs.delete(t.path);
    saveFavs();
    paintNpFav();
    if (S.page.name === 'liked' && !nowOn) {
      const row = favBtn.closest('.row');
      if (row) row.remove();
      const sub = document.querySelector('.hero-sub');
      if (sub) sub.textContent = `共 ${S.favs.size} 首`;
    } else {
      document.querySelectorAll(`[data-fav="${favIdx}"]`).forEach((btn) => {
        btn.classList.toggle('on', nowOn);
        const svg = btn.querySelector('svg');
        if (svg) svg.setAttribute('fill', nowOn ? 'currentColor' : 'none');
      });
    }
    return true;
  }
  return false;
}

document.addEventListener('click', (e) => {
  if (handleTopLevelClick(e)) return;
  if (handleSheetQueueSourceClick(e)) return;
  if (handleLibraryAndTrackClick(e)) return;
  if (handleImportClick(e)) return;
  if (handleSettingsClick(e)) return;
  handleSearchAndNavClick(e);
});

bindInputAndKeyEvents();
bindPlayerControls();
