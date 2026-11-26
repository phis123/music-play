/*
 * events/settings.js — 主题、主设置页、播放页小设置抽屉、搜索过滤与键盘/滑块输入。
 * 依赖：window.MP（按 index.html 顺序在 events.js 之前加载）。
 */
'use strict';
window.MP = window.MP || {};

function handleSettingsClick(e) {
  if (e.target.closest('#railThemeBtn')) {
    e.stopPropagation();
    cycleTheme();
    return true;
  }
  const themeBtn = e.target.closest('[data-theme-set]');
  if (themeBtn) {
    e.stopPropagation();
    applyTheme(themeBtn.dataset.themeSet);
    render();
    return true;
  }
  const normBtn = e.target.closest('[data-set-norm]');
  if (normBtn) {
    e.stopPropagation();
    S.normEnabled = normBtn.dataset.setNorm === '1';
    try { localStorage.setItem('mob:normEnabled', S.normEnabled ? '1' : '0'); } catch (err) { }
    applyCurrentTrackGain();
    render();
    toast(S.normEnabled ? '已开启全局音量平衡' : '已关闭全局音量平衡');
    return true;
  }
  const presetBtn = e.target.closest('[data-set-preset]');
  if (presetBtn) {
    e.stopPropagation();
    S.normPreset = presetBtn.dataset.setPreset || 'standard';
    try { localStorage.setItem('mob:normPreset', S.normPreset); } catch (err) { }
    applyCurrentTrackGain();
    render();
    return true;
  }
  const randBtn = e.target.closest('[data-set-rand]');
  if (randBtn) {
    e.stopPropagation();
    S.randomStrategy = randBtn.dataset.setRand || 'no-repeat';
    S.shufflePlayed.clear();
    try { localStorage.setItem('mob:randomStrategy', S.randomStrategy); } catch (err) { }
    render();
    const rNames = { 'no-repeat': '不重复随机', 'rare-first': '不常听优先随机', 'true-random': '真随机' };
    toast('随机策略：' + (rNames[S.randomStrategy] || '不重复随机'));
    return true;
  }
  const lrcSzBtn = e.target.closest('[data-set-lrcsz]');
  if (lrcSzBtn) {
    e.stopPropagation();
    S.lrcSize = +lrcSzBtn.dataset.setLrcsz || 18;
    applyLyricsStyle();
    render();
    return true;
  }
  const lrcColBtn = e.target.closest('[data-set-lrccolor]');
  if (lrcColBtn) {
    e.stopPropagation();
    S.lrcColor = lrcColBtn.dataset.setLrccolor || '#ec4141';
    applyLyricsStyle();
    render();
    return true;
  }
  if (e.target.closest('[data-set-dir]')) {
    e.stopPropagation();
    openSheet('setdir', null);
    return true;
  }
  const dirPre = e.target.closest('[data-dir-preset]');
  if (dirPre) {
    e.stopPropagation();
    const inp = document.getElementById('sheetInput');
    if (inp) inp.value = dirPre.dataset.dirPreset || 'music-play';
    return true;
  }
  if (e.target.closest('[data-set-cleargains]')) {
    e.stopPropagation();
    clearAllUserTrackGains();
    applyCurrentTrackGain();
    render();
    toast('已清空全部单曲音量微调记录');
    return true;
  }
  const diagBtn = e.target.closest('[data-diag]');
  if (diagBtn) {
    e.stopPropagation();
    const kind = diagBtn.dataset.diag;
    if (kind === 'export') { runDiagExport('ui'); return true; }
    if (kind === 'snapshot') {
      let txt = '';
      try { txt = (A && typeof A.diagSnapshot === 'function') ? A.diagSnapshot() : ''; } catch (err) { txt = '读取失败：' + err; }
      diagLog('ui', '查看快照 len=' + (txt ? txt.length : 0) + ' head=' + String(txt || '').slice(0, 60).replace(/\s+/g, ' '));
      S.diagSnapshotText = txt || '（快照为空：原生未返回内容）';
      openSheet('diagsnap', null);
      return true;
    }
    if (kind === 'clear') {
      try { if (A && typeof A.diagClear === 'function') A.diagClear(); } catch (err) { }
      S.diagLastPath = '';
      render();
      toast('已清空本地诊断日志（已导出的 zip 保留）');
      return true;
    }
  }
  if (e.target.closest('[data-set-clearstats]')) {
    e.stopPropagation();
    clearSearchHist();
    try { localStorage.removeItem('mob:playCounts'); } catch (err) { }
    render();
    toast('已清空搜索与播放统计缓存');
    return true;
  }
  const npGainBtn = e.target.closest('[data-npset-gain]');
  if (npGainBtn) {
    e.stopPropagation();
    const curPath = S.queuePaths[S.cur] || '';
    if (curPath) {
      const raw = npGainBtn.dataset.npsetGain;
      const curM = getUserTrackGain(curPath);
      const nextM = raw === 'reset' ? 0 : Math.max(-12, Math.min(12, curM + (+raw || 0)));
      setUserTrackGain(curPath, nextM);
      applyCurrentTrackGain();
      refreshOpenSheet();
    }
    return true;
  }
  if (e.target.closest('[data-npset-normtoggle]')) {
    e.stopPropagation();
    S.normEnabled = !S.normEnabled;
    try { localStorage.setItem('mob:normEnabled', S.normEnabled ? '1' : '0'); } catch (err) { }
    applyCurrentTrackGain();
    refreshOpenSheet();
    if (S.page.name === 'settings') render();
    return true;
  }
  const npOffBtn = e.target.closest('[data-npset-off]');
  if (npOffBtn) {
    e.stopPropagation();
    const raw = npOffBtn.dataset.npsetOff;
    if (raw === 'reset') setOffset(0);
    else setOffset((S.offset || 0) + (+raw || 0));
    refreshOpenSheet();
    return true;
  }
  const npFloatBtn = e.target.closest('[data-npset-float]');
  if (npFloatBtn) {
    e.stopPropagation();
    const act = npFloatBtn.dataset.npsetFloat;
    if (act === 'toggle') {
      if (!A || !A.overlayAllowed || !A.overlayAllowed()) {
        toast('请先允许「显示在其他应用上层」');
        if (A && A.overlaySettings) A.overlaySettings();
        return true;
      }
      if (A.overlayShown && A.overlayShown()) {
        A.hideOverlay();
        toast('悬浮歌词已关闭');
      } else {
        A.showOverlay();
        pushOverlayStyle();
        pushOverlay();
        toast('悬浮歌词已开启');
      }
      refreshOpenSheet();
    } else if (act === 'lock') {
      if (!A || !A.overlayShown || !A.overlayShown()) { toast('请先开启悬浮歌词'); return true; }
      const now = !(A.overlayLocked && A.overlayLocked());
      if (A.overlayLock) A.overlayLock(now);
      refreshOpenSheet();
      toast(now ? '已锁定触摸穿透' : '已解锁');
    }
    return true;
  }
  const npFloatCol = e.target.closest('[data-npset-floatcol]');
  if (npFloatCol) {
    e.stopPropagation();
    S.floatColor = npFloatCol.dataset.npsetFloatcol || '#ffffff';
    pushOverlayStyle();
    refreshOpenSheet();
    return true;
  }
  return false;
}

function handleSearchAndNavClick(e) {
  if (e.target.closest('#qClear')) {
    e.stopPropagation();
    S.q = '';
    S.online = { q: '', loading: false, songs: [], err: '' };
    const inp = document.getElementById('q');
    if (inp) { inp.value = ''; inp.focus(); }
    updateHomeBody();
    return true;
  }
  if (e.target.closest('#qGo')) {
    e.stopPropagation();
    doOnlineSearch();
    return true;
  }
  const qHistBtn = e.target.closest('[data-qhist]');
  if (qHistBtn) {
    e.stopPropagation();
    S.q = qHistBtn.dataset.qhist || '';
    const inp = document.getElementById('q');
    if (inp) inp.value = S.q;
    doOnlineSearch();
    return true;
  }
  if (e.target.closest('[data-qhist-clear]')) {
    e.stopPropagation();
    clearSearchHist();
    updateHomeBody();
    return true;
  }
  const sortBtn = e.target.closest('[data-sort]');
  if (sortBtn) {
    e.stopPropagation();
    S.listSort = sortBtn.dataset.sort || 'default';
    updateListBody();
    return true;
  }
  if (e.target.closest('[data-list-playall]')) {
    e.stopPropagation();
    const list = filterAndSortTracks(currentListBaseTracks());
    if (list.length) playAt(list, 0); else toast('列表为空');
    return true;
  }
  if (e.target.closest('[data-list-shuffle]')) {
    e.stopPropagation();
    const list = shuffled(filterAndSortTracks(currentListBaseTracks()));
    if (!list.length) { toast('列表为空'); return true; }
    ensureShuffle();
    playAt(list, 0);
    toast('随机播放 ' + list.length + ' 首');
    return true;
  }
  if (e.target.closest('[data-playall]')) {
    if (S.tracks.length) playAt(S.tracks, 0);
    return true;
  }

  const goBtn = e.target.closest('[data-go]');
  if (goBtn) {
    markNavTransition();
    S.listFilter = '';
    S.page = { name: goBtn.dataset.go, arg: null };
    render();
    return true;
  }

  const plRow = e.target.closest('[data-pl]');
  if (plRow) {
    markNavTransition();
    S.listFilter = '';
    S.page = { name: 'playlist', arg: plRow.dataset.pl };
    render();
    return true;
  }

  if (e.target.closest('#goBack')) { goBack(); return true; }
  if (e.target.closest('#newPl')) { openSheet('newpl', null); return true; }
  return false;
}

function bindInputAndKeyEvents() {
  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'q' && e.key === 'Enter') {
      e.preventDefault();
      doOnlineSearch();
    } else if (e.target.id === 'srcKwInput' && e.key === 'Enter') {
      e.preventDefault();
      searchSourceCands(e.target.value);
    } else if (e.target.dataset && e.target.dataset.impKwin != null && e.key === 'Enter') {
      e.preventDefault();
      mobileInlineImpSearch(+e.target.dataset.impKwin, e.target.value, false);
    }
  });

  let qInputTimer = null;
  let listFilterTimer = null;

  document.addEventListener('input', (e) => {
    if (e.target.id === 'q') {
      S.q = e.target.value;
      const qc = document.getElementById('qClear');
      if (qc) qc.style.display = S.q ? 'inline-flex' : 'none';
      clearTimeout(qInputTimer);
      qInputTimer = setTimeout(() => { updateHomeBody(); }, 90);
    } else if (e.target.id === 'listFilterInput') {
      S.listFilter = e.target.value;
      clearTimeout(listFilterTimer);
      listFilterTimer = setTimeout(() => { updateListBody(); }, 80);
    } else if (e.target.id === 'mobLrcSizeRange') {
      S.lrcSize = +e.target.value || 18;
      applyLyricsStyle();
      const pEn = document.getElementById('mobLrcPrevEn');
      const pZh = document.getElementById('mobLrcPrevZh');
      if (pEn) pEn.style.fontSize = (S.lrcSize + 2) + 'px';
      if (pZh) pZh.style.fontSize = (S.lrcSize - 1) + 'px';
    } else if (e.target.id === 'mobMiniGainRange') {
      const curPath = S.queuePaths[S.cur] || '';
      if (curPath) {
        setUserTrackGain(curPath, +e.target.value || 0);
        const { autoDb, manualDb, totalDb } = applyCurrentTrackGain();
        const vEl = document.getElementById('mobMiniGainVal');
        if (vEl) vEl.textContent = (manualDb > 0 ? '+' : '') + manualDb.toFixed(1) + 'dB';
        const iEl = document.getElementById('mobMiniGainInfo');
        if (iEl) iEl.textContent = `自动 ${autoDb >= 0 ? '+' : ''}${autoDb.toFixed(1)}dB · 合成 ${totalDb >= 0 ? '+' : ''}${totalDb.toFixed(1)}dB`;
      }
    } else if (e.target.id === 'mobMiniOffRange') {
      setOffset(+e.target.value || 0);
      const vEl = document.getElementById('mobMiniOffVal');
      if (vEl) vEl.textContent = `当前偏移 ${S.offset > 0 ? '+' : ''}${(S.offset / 1000).toFixed(1)}s`;
    } else if (e.target.id === 'mobMiniFloatSz') {
      S.floatSizeSp = +e.target.value || 18;
      const vEl = document.getElementById('mobMiniFloatSzVal');
      if (vEl) vEl.textContent = S.floatSizeSp + 'sp';
      pushOverlayStyle(false);
    } else if (e.target.id === 'mobMiniFloatBg') {
      S.floatBgOpacity = +e.target.value || 0;
      const vEl = document.getElementById('mobMiniFloatBgVal');
      if (vEl) vEl.textContent = S.floatBgOpacity + '%';
      pushOverlayStyle(false);
    }
  });
}
