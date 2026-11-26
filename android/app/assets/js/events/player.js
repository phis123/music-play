/*
 * events/player.js — 底部弹层、播放队列、更换声源、mini 播放条与全屏播放页交互。
 * 依赖：window.MP（按 index.html 顺序在 events.js 之前加载）。
 */
'use strict';
window.MP = window.MP || {};

function handleSheetQueueSourceClick(e) {
  /* ---- 底部弹层 ---- */
  const sOk = e.target.closest('[data-sheet-ok]');
  if (sOk) { e.stopPropagation(); sheetOk(); return true; }
  const sPl = e.target.closest('[data-sheet-pl]');
  if (sPl) { e.stopPropagation(); sheetPickPlaylist(sPl.dataset.sheetPl); return true; }
  if (e.target.closest('[data-sheet-close]')) {
    e.stopPropagation();
    if (S.sheet && S.sheet.kind === 'source' && S.srcSwitch.prevId) restoreSourceOriginal();
    closeSheet();
    return true;
  }
  if (e.target.classList && e.target.classList.contains('sheet-mask')) { closeSheet(); return true; }

  /* ---- 播放队列弹层动作 ---- */
  const qRm = e.target.closest('[data-q-rm]');
  if (qRm) {
    e.stopPropagation();
    const rmIdx = +qRm.dataset.qRm;
    if (rmIdx >= 0 && rmIdx < S.queuePaths.length) {
      const wasCur = rmIdx === S.cur;
      S.queuePaths.splice(rmIdx, 1);
      if (!S.queuePaths.length) {
        S.cur = -1;
        S.playing = false;
        if (A && A.pause) A.pause();
        paintPlayIcon();
      } else if (wasCur) {
        S.cur = Math.min(rmIdx, S.queuePaths.length - 1);
        const nt = trackByPath(S.queuePaths[S.cur]);
        if (nt) {
          if (A) A.playEx(nt.path, nt.title || '', nt.artist || '', nt.cover || '');
          showMini(nt);
          loadLyrics(nt);
        }
      } else if (rmIdx < S.cur) {
        S.cur--;
      }
      paintShuffle();
      savePlayerSession();
      refreshOpenSheet();
      updatePlayingRowInPlace();
    }
    return true;
  }
  const qJump = e.target.closest('[data-q-jump]');
  if (qJump) {
    e.stopPropagation();
    const jIdx = +qJump.dataset.qJump;
    const jt = trackByPath(S.queuePaths[jIdx]);
    if (jt) {
      S.cur = jIdx;
      S.playing = true;
      S._restoredNeedsPlay = false;
      pushRecent(jt.path);
      if (A) A.playEx(jt.path, jt.title || '', jt.artist || '', jt.cover || '');
      showMini(jt);
      loadLyrics(jt);
      paintPlayIcon();
      savePlayerSession();
      refreshOpenSheet();
      updatePlayingRowInPlace();
    }
    return true;
  }
  if (e.target.closest('[data-q-mode]')) {
    e.stopPropagation();
    toggleShuffle();
    return true;
  }
  if (e.target.closest('[data-q-clear]')) {
    e.stopPropagation();
    S.queuePaths = [];
    S.cur = -1;
    S.playing = false;
    if (A && A.pause) A.pause();
    paintPlayIcon();
    paintShuffle();
    savePlayerSession();
    closeSheet();
    render();
    toast('已清空播放队列');
    return true;
  }

  /* ---- 更换声源弹层动作 ---- */
  const srcPv = e.target.closest('[data-src-pv]');
  if (srcPv) {
    e.stopPropagation();
    previewSourceCand(+srcPv.dataset.srcPv);
    return true;
  }
  const srcUse = e.target.closest('[data-src-use]');
  if (srcUse) {
    e.stopPropagation();
    applySourceCand(+srcUse.dataset.srcUse);
    return true;
  }
  if (e.target.closest('[data-src-restore]')) {
    e.stopPropagation();
    restoreSourceOriginal();
    toast('已恢复原曲播放');
    return true;
  }
  if (e.target.closest('#srcKwGo')) {
    e.stopPropagation();
    const inp = document.getElementById('srcKwInput');
    searchSourceCands(inp ? inp.value : S.srcSwitch.kw);
    return true;
  }
  return false;
}

function bindPlayerControls() {
  // mini 播放条 & 播放页控制
  document.addEventListener('click', (e) => {
    if (e.target.closest('#miniPlay')) { e.stopPropagation(); togglePlayPause(); return; }
    if (e.target.closest('#miniNext')) { e.stopPropagation(); queueNext(1); return; }
    if (e.target.closest('#miniQueue')) { e.stopPropagation(); openQueueSheet(); return; }
    if (e.target.closest('#mini')) { openNpSheet(); return; }
    if (e.target.closest('.np-stage') || e.target.closest('#npPeek')) {
      $('#np').classList.add('mode-lyrics');
      scrollToCurrentLyric();
      return;
    }
    if (e.target.closest('#npResume')) {
      S.lastUserScrollAt = 0;
      document.getElementById('npResume')?.classList.add('hidden');
      scrollToCurrentLyric();
      return;
    }
    if (e.target.closest('#npFav')) {
      const curPath = S.queuePaths[S.cur];
      if (!curPath) return;
      const nowFav = !S.favs.has(curPath);
      if (nowFav) S.favs.add(curPath); else S.favs.delete(curPath);
      saveFavs();
      paintNpFav();
      const curT = trackByPath(curPath);
      if (curT && curT._idx != null) {
        document.querySelectorAll(`[data-fav="${curT._idx}"]`).forEach((btn) => {
          btn.classList.toggle('on', nowFav);
          const svg = btn.querySelector('svg');
          if (svg) svg.setAttribute('fill', nowFav ? 'currentColor' : 'none');
        });
      }
      toast(nowFav ? '已加入我喜欢的音乐' : '已取消喜欢');
      return;
    }
    if (e.target.closest('#npAddPl')) {
      const curPath = S.queuePaths[S.cur];
      const t = curPath ? trackByPath(curPath) : null;
      if (t) addToPlaylist(t);
      return;
    }
    if (e.target.closest('#npSource')) { openSourceSwitcher(); return; }
    if (e.target.closest('#npQueue')) { openQueueSheet(); return; }
    if (e.target.closest('#npBack')) {
      const npEl = $('#np');
      if (npEl.classList.contains('mode-lyrics')) { npEl.classList.remove('mode-lyrics'); return; }
      npEl.classList.add('hidden');
      return;
    }
    if (e.target.closest('#npPlay')) { togglePlayPause(); return; }
    if (e.target.closest('#npNext')) { queueNext(1); return; }
    if (e.target.closest('#npPrev')) { queueNext(-1); return; }
    if (e.target.closest('#npGearBtn') || e.target.closest('#npMiniSetBtn') || e.target.closest('#npGainChip')) {
      openSheet('npset', null);
      return;
    }
    if (e.target.closest('#npFloat')) {
      if (!A.overlayAllowed || !A.overlayAllowed()) {
        toast('请先允许「显示在其他应用上层」');
        if (A.overlaySettings) A.overlaySettings();
        return;
      }
      if (A.overlayShown && A.overlayShown()) {
        A.hideOverlay();
        toast('悬浮歌词已关闭');
      } else {
        A.showOverlay();
        toast('已开启：拖动移动，长按锁定，锁定后可在通知栏解锁');
        pushOverlay();
      }
      return;
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id !== 'npRange') return;
    e.target.dataset.drag = '1';
    const pct = +e.target.value / 10;
    e.target.style.setProperty('--seek-pct', pct.toFixed(1) + '%');
    if (S.dur) $('#npCur').textContent = fmt((+e.target.value / 1000) * S.dur);
  });

  document.addEventListener('change', (e) => {
    if (e.target.id !== 'npRange') return;
    delete e.target.dataset.drag;
    const pct = +e.target.value / 1000;
    e.target.style.setProperty('--seek-pct', (pct * 100).toFixed(1) + '%');
    if (A && S.dur) A.seek(Math.round(pct * S.dur * 1000));
  });
}
