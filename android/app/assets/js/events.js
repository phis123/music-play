/*
 * events.js — document 级事件委托（点击/输入/键盘/变更）+ 启动事件挂载。委托顺序保持不变。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

/* ---------------- 事件 ---------------- */
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-task-err]')) {
    e.stopPropagation();
    openSheet('taskerr', null);
    return;
  }
  if (e.target.closest('[data-task-dismiss]')) {
    e.stopPropagation();
    dismissTask();
    return;
  }
  if (e.target.closest('[data-task-stop]')) {
    e.stopPropagation();
    if (S.task.kind === 'enrich') window.__enrichStop = true;
    else if (S.task.kind === 'impmatch') window.__impMatchStop = true;
    else if (S.task.kind === 'impdl') window.__impStop = true;
    toast('正在停止当前任务…');
    return;
  }
  if (e.target.closest('[data-enrich-now]')) {
    e.stopPropagation();
    enrichTracks(true);
    return;
  }

  if (e.target.closest('[data-np]') && !e.target.closest('#miniPlay') && !e.target.closest('#miniNext') && !e.target.closest('#miniQueue')) {
    document.getElementById('np').classList.remove('hidden');
    return;
  }

  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { setTab(tabBtn.dataset.tab); return; }

  if (e.target.closest('[data-rescan]')) {
    e.stopPropagation();
    manualRescan();
    return;
  }

  const favBtn = e.target.closest('[data-fav]');
  if (favBtn) {
    e.stopPropagation();
    const favIdx = +favBtn.dataset.fav;
    const t = S.tracks[favIdx];
    if (!t) return;
    const nowOn = !S.favs.has(t.path);
    if (nowOn) S.favs.add(t.path); else S.favs.delete(t.path);
    saveFavs();
    paintNpFav();
    // O(1) 局部更新心形按钮，避免全表 render 引起低频平板卡顿
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
    return;
  }

  /* ---- 底部弹层 ---- */
  const sOk = e.target.closest('[data-sheet-ok]');
  if (sOk) { e.stopPropagation(); sheetOk(); return; }
  const sPl = e.target.closest('[data-sheet-pl]');
  if (sPl) { e.stopPropagation(); sheetPickPlaylist(sPl.dataset.sheetPl); return; }
  if (e.target.closest('[data-sheet-close]')) {
    e.stopPropagation();
    if (S.sheet && S.sheet.kind === 'source' && S.srcSwitch.prevId) restoreSourceOriginal();
    closeSheet();
    return;
  }
  if (e.target.classList && e.target.classList.contains('sheet-mask')) { closeSheet(); return; }

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
    return;
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
    return;
  }
  if (e.target.closest('[data-q-mode]')) {
    e.stopPropagation();
    toggleShuffle();
    return;
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
    return;
  }

  /* ---- 更换声源弹层动作 ---- */
  const srcPv = e.target.closest('[data-src-pv]');
  if (srcPv) {
    e.stopPropagation();
    previewSourceCand(+srcPv.dataset.srcPv);
    return;
  }
  const srcUse = e.target.closest('[data-src-use]');
  if (srcUse) {
    e.stopPropagation();
    applySourceCand(+srcUse.dataset.srcUse);
    return;
  }
  if (e.target.closest('[data-src-restore]')) {
    e.stopPropagation();
    restoreSourceOriginal();
    toast('已恢复原曲播放');
    return;
  }
  if (e.target.closest('#srcKwGo')) {
    e.stopPropagation();
    const inp = document.getElementById('srcKwInput');
    searchSourceCands(inp ? inp.value : S.srcSwitch.kw);
    return;
  }

  /* ---- 行内动作（必须排在 data-song 之前，否则会被当成播放） ---- */
  const qNextBtn = e.target.closest('[data-qnext]');
  if (qNextBtn) {
    e.stopPropagation();
    playNextInsert(S.tracks[+qNextBtn.dataset.qnext]);
    return;
  }
  const plRm = e.target.closest('[data-plrm]');
  if (plRm) {
    e.stopPropagation();
    removeFromPlaylist(S.playlists.find((x) => x.id === plRm.dataset.plrm), plRm.dataset.path);
    return;
  }
  const plDelBtn = e.target.closest('[data-pldel]');
  if (plDelBtn) {
    e.stopPropagation();
    const p = S.playlists.find((x) => x.id === plDelBtn.dataset.pldel);
    if (p) openSheet('delpl', p);
    return;
  }
  const plRenBtn = e.target.closest('[data-plrename]');
  if (plRenBtn) {
    e.stopPropagation();
    const p = S.playlists.find((x) => x.id === plRenBtn.dataset.plrename);
    if (p) openSheet('renamepl', p);
    return;
  }
  const plPlayBtn = e.target.closest('[data-plplay]');
  if (plPlayBtn) {
    const p = S.playlists.find((x) => x.id === plPlayBtn.dataset.plplay);
    const list = p ? p.tracks.map(trackByPath).filter(Boolean) : [];
    if (list.length) playAt(list, 0); else toast('歌单是空的');
    return;
  }
  const plShufBtn = e.target.closest('[data-plshuffle]');
  if (plShufBtn) {
    const p = S.playlists.find((x) => x.id === plShufBtn.dataset.plshuffle);
    const list = p ? shuffled(p.tracks.map(trackByPath).filter(Boolean)) : [];
    if (!list.length) { toast('歌单是空的'); return; }
    ensureShuffle();
    playAt(list, 0);
    toast('随机播放 ' + list.length + ' 首');
    return;
  }
  const plAddBtn = e.target.closest('[data-pladd]');
  if (plAddBtn) { e.stopPropagation(); addToPlaylist(S.tracks[+plAddBtn.dataset.pladd]); return; }
  const delBtnX = e.target.closest('[data-del]');
  if (delBtnX) { e.stopPropagation(); deleteTrack(S.tracks[+delBtnX.dataset.del]); return; }
  if (e.target.closest('[data-shuffle-all]')) { playShuffleAll(); return; }
  if (e.target.closest('#npShuffle')) { toggleShuffle(); return; }

  if (e.target.closest('[data-storage]')) {
    if (!storageOK()) { askStorage(); return; }
    let txt = '存储权限已开启';
    try {
      const d = JSON.parse(A.storageInfo());
      txt = '公共 ' + (d.publicListable ? d.publicAudio + ' 首' : '读不到') + ' · 私有 ' + d.privateAudio + ' 首' + (d.allFiles ? '' : ' · 无所有文件访问');
    } catch (err) { }
    toast(txt);
    return;
  }

  const song = e.target.closest('[data-song]');
  if (song) {
    const idx = +song.dataset.song;
    const t = S.tracks[idx];
    if (!t) return;
    // 优先使用内存中的当前列表（支持分片懒挂载全队列播放且无需遍历 DOM）
    let visible = (_currentShownTracks && _currentShownTracks.length)
      ? _currentShownTracks
      : [...document.querySelectorAll('[data-song]')].map((el) => S.tracks[+el.dataset.song]).filter(Boolean);
    let pos = visible.findIndex((x) => x && x.path === t.path);
    if (pos < 0) {
      visible = S.tracks;
      pos = idx;
    }
    playAt(visible, pos < 0 ? 0 : pos);
    return;
  }

  const impFilterBtn = e.target.closest('[data-imp-filter]');
  if (impFilterBtn) {
    e.stopPropagation();
    imp.filter = impFilterBtn.dataset.impFilter || 'all';
    render();
    return;
  }
  if (e.target.closest('#impMatchStop')) {
    e.stopPropagation();
    window.__impMatchStop = true;
    toast('正在暂停声源匹配…');
    return;
  }
  if (e.target.closest('#impMatchResume')) {
    e.stopPropagation();
    matchImport(true);
    return;
  }

  const kwGoBtn = e.target.closest('[data-imp-kwgo]');
  if (kwGoBtn) {
    e.stopPropagation();
    const idx = +kwGoBtn.dataset.impKwgo;
    const inEl = document.getElementById('impkw-' + idx);
    mobileInlineImpSearch(idx, inEl ? inEl.value : '', false);
    return;
  }
  const kwPreBtn = e.target.closest('[data-imp-kwpreset]');
  if (kwPreBtn) {
    e.stopPropagation();
    const pair = String(kwPreBtn.dataset.impKwpreset).split(':');
    const idx = +pair[0];
    const kind = pair[1];
    const it = imp.items[idx];
    if (!it) return;
    const fa = firstArtistClean(it.song.artist);
    if (kind === 'smart') {
      it.customKw = [it.song.name, fa].filter(Boolean).join(' ').trim();
      mobileInlineImpSearch(idx, '', true);
    } else {
      const q = kind === 'name'
        ? unwrapSongQuotes(it.song.name)
        : kind === 'artist'
          ? (fa || it.song.artist || '')
          : [unwrapSongQuotes(it.song.name), fa].filter(Boolean).join(' ');
      mobileInlineImpSearch(idx, q, false);
    }
    return;
  }

  if (e.target.closest('#impGo') || e.target.closest('#impAll') || e.target.closest('#impStop') || e.target.closest('#impClear') ||
      e.target.closest('[data-imp-swap]') || e.target.closest('[data-imp-skip]') ||
      e.target.closest('[data-imp-pick]') || e.target.closest('[data-imp-play]')) {
    const pl = e.target.closest('[data-imp-play]');
    if (pl) {
      e.stopPropagation();
      const pair = String(pl.dataset.impPlay).split(':');
      const it0 = imp.items[+pair[0]];
      const v0 = it0 && it0.cands && it0.cands[+pair[1]];
      if (it0 && v0) previewCand(it0, v0);
      return;
    }
    if (e.target.closest('#impGo')) { doImportParse(); return; }
    if (e.target.closest('#impAll')) { importDownloadAll(); return; }
    if (e.target.closest('#impClear')) {
      window.__impMatchStop = true;
      imp.link = ''; imp.name = ''; imp.items = []; imp.err = ''; imp.open = -1; imp.matching = false;
      scheduleSaveImpState(true);
      dismissTask();
      render();
      toast('已清空导入列表');
      return;
    }
    if (e.target.closest('#impStop')) {
      window.__impStop = true;
      if (!window.__impCurrent) { window.__impQueue = []; imp.busy = false; scheduleSaveImpState(true); render(); }
      toast('正在停止…');
      return;
    }
    const pk = e.target.closest('[data-imp-pick]');
    if (pk) {
      const idx = +pk.dataset.impPick;
      const it = imp.items[idx];
      const v = it && it.cands[+pk.dataset.pick];
      if (it && v) {
        it.voice = v;
        it.pick = +pk.dataset.pick;
        it.manual = true;
        it.suspect = null;
        it.skip = false;
        it.err = '';
        it.gap = durGap(it.song.duration, v.duration);
        scheduleSaveImpState(false);
        updateSingleImpRow(idx);
        refreshOpenMobileImpPanel(idx);
        toast('已选用：' + (v.title || '') + (it.gap != null && Math.abs(it.gap) > 5 ? '（与原曲差 ' + fmt(Math.abs(it.gap)) + '）' : ''));
      }
      return;
    }
    const sw = e.target.closest('[data-imp-swap]');
    if (sw) {
      const i = +sw.dataset.impSwap;
      const prevOpen = imp.open;
      imp.open = imp.open === i ? -1 : i;
      if (prevOpen >= 0) {
        const oldP = document.querySelector('[data-panel="' + prevOpen + '"]');
        if (oldP) oldP.remove();
        const oldR = document.getElementById('improw-' + prevOpen);
        if (oldR) oldR.classList.remove('open');
        const oldB = document.getElementById('impswap-' + prevOpen);
        if (oldB) oldB.textContent = '换';
      }
      if (imp.open === i && imp.items[i]) {
        const it = imp.items[i];
        const curR = document.getElementById('improw-' + i);
        const curB = document.getElementById('impswap-' + i);
        if (curB) curB.textContent = '收起';
        if (curR) {
          curR.classList.add('open');
          curR.insertAdjacentHTML('afterend', candPanel(it, i));
          if (!it.cands || !it.cands.length) {
            mobileInlineImpSearch(i, '', true);
          }
          const panel = document.querySelector('[data-panel="' + i + '"]');
          if (panel && panel.scrollIntoView) { try { panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (err) { } }
        } else {
          render();
        }
      }
      return;
    }
    const sk = e.target.closest('[data-imp-skip]');
    if (sk) {
      const idx = +sk.dataset.impSkip;
      const it = imp.items[idx];
      if (it) {
        it.skip = !it.skip;
        scheduleSaveImpState(false);
        updateSingleImpRow(idx);
      }
    }
    return;
  }

  const hTab = e.target.closest('[data-health-tab]');
  if (hTab) {
    e.stopPropagation();
    S.healthTab = hTab.dataset.healthTab || 'dup';
    render();
    return;
  }
  if (e.target.closest('#healthRebuildTags')) {
    e.stopPropagation();
    toast('正在清空标签缓存并重新读取歌手与封面…');
    rebuildTagsAndCovers();
    return;
  }
  if (e.target.closest('#healthFillMeta')) {
    e.stopPropagation();
    S.tracks.forEach((t) => { if (!t.hasLrc || !t.artist || !t.cover) t._enriched = false; });
    const todoCnt = S.tracks.filter((t) => !t.hasLrc || !t.artist || (!t.cover && !S.covers.get(t.path))).length;
    toast(`开始自动补齐 ${todoCnt} 首缺失歌词与封面…`);
    enrichMissing();
    return;
  }

  const pvBtn = e.target.closest('[data-pv]');
  if (pvBtn) { e.stopPropagation(); previewVoice(+pvBtn.dataset.pv); return; }

  const dlBtn = e.target.closest('[data-dl]');
  if (dlBtn) { e.stopPropagation(); downloadVoice(+dlBtn.dataset.dl); return; }

  const oSong = e.target.closest('[data-osong]');
  if (oSong) { openVoices(oSong.dataset.osong); return; }

  if (e.target.closest('#railThemeBtn')) {
    e.stopPropagation();
    cycleTheme();
    return;
  }
  const themeBtn = e.target.closest('[data-theme-set]');
  if (themeBtn) {
    e.stopPropagation();
    applyTheme(themeBtn.dataset.themeSet);
    render();
    return;
  }
  // 主设置页与播放页小设置抽屉事件委托
  const normBtn = e.target.closest('[data-set-norm]');
  if (normBtn) {
    e.stopPropagation();
    S.normEnabled = normBtn.dataset.setNorm === '1';
    try { localStorage.setItem('mob:normEnabled', S.normEnabled ? '1' : '0'); } catch (err) { }
    applyCurrentTrackGain();
    render();
    toast(S.normEnabled ? '已开启全局音量平衡' : '已关闭全局音量平衡');
    return;
  }
  const presetBtn = e.target.closest('[data-set-preset]');
  if (presetBtn) {
    e.stopPropagation();
    S.normPreset = presetBtn.dataset.setPreset || 'standard';
    try { localStorage.setItem('mob:normPreset', S.normPreset); } catch (err) { }
    applyCurrentTrackGain();
    render();
    return;
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
    return;
  }
  const lrcSzBtn = e.target.closest('[data-set-lrcsz]');
  if (lrcSzBtn) {
    e.stopPropagation();
    S.lrcSize = +lrcSzBtn.dataset.setLrcsz || 18;
    applyLyricsStyle();
    render();
    return;
  }
  const lrcColBtn = e.target.closest('[data-set-lrccolor]');
  if (lrcColBtn) {
    e.stopPropagation();
    S.lrcColor = lrcColBtn.dataset.setLrccolor || '#ec4141';
    applyLyricsStyle();
    render();
    return;
  }
  if (e.target.closest('[data-set-dir]')) {
    e.stopPropagation();
    openSheet('setdir', null);
    return;
  }
  const dirPre = e.target.closest('[data-dir-preset]');
  if (dirPre) {
    e.stopPropagation();
    const inp = document.getElementById('sheetInput');
    if (inp) inp.value = dirPre.dataset.dirPreset || 'music-play';
    return;
  }
  if (e.target.closest('[data-set-cleargains]')) {
    e.stopPropagation();
    clearAllUserTrackGains();
    applyCurrentTrackGain();
    render();
    toast('已清空全部单曲音量微调记录');
    return;
  }
  const diagBtn = e.target.closest('[data-diag]');
  if (diagBtn) {
    e.stopPropagation();
    const kind = diagBtn.dataset.diag;
    if (kind === 'export') {
      runDiagExport('ui');
      return;
    }
    if (kind === 'snapshot') {
      let txt = '';
      try { txt = (A && typeof A.diagSnapshot === 'function') ? A.diagSnapshot() : ''; } catch (err) { txt = '读取失败：' + err; }
      diagLog('ui', '查看快照 len=' + (txt ? txt.length : 0) + ' head=' + String(txt || '').slice(0, 60).replace(/\s+/g, ' '));
      S.diagSnapshotText = txt || '（快照为空：原生未返回内容）';
      openSheet('diagsnap', null);
      return;
    }
    if (kind === 'clear') {
      try { if (A && typeof A.diagClear === 'function') A.diagClear(); } catch (err) { }
      S.diagLastPath = '';
      render();
      toast('已清空本地诊断日志（已导出的 zip 保留）');
      return;
    }
  }
  if (e.target.closest('[data-set-clearstats]')) {
    e.stopPropagation();
    clearSearchHist();
    try { localStorage.removeItem('mob:playCounts'); } catch (err) { }
    render();
    toast('已清空搜索与播放统计缓存');
    return;
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
    return;
  }
  if (e.target.closest('[data-npset-normtoggle]')) {
    e.stopPropagation();
    S.normEnabled = !S.normEnabled;
    try { localStorage.setItem('mob:normEnabled', S.normEnabled ? '1' : '0'); } catch (err) { }
    applyCurrentTrackGain();
    refreshOpenSheet();
    if (S.page.name === 'settings') render();
    return;
  }
  const npOffBtn = e.target.closest('[data-npset-off]');
  if (npOffBtn) {
    e.stopPropagation();
    const raw = npOffBtn.dataset.npsetOff;
    if (raw === 'reset') setOffset(0);
    else setOffset((S.offset || 0) + (+raw || 0));
    refreshOpenSheet();
    return;
  }
  const npFloatBtn = e.target.closest('[data-npset-float]');
  if (npFloatBtn) {
    e.stopPropagation();
    const act = npFloatBtn.dataset.npsetFloat;
    if (act === 'toggle') {
      if (!A || !A.overlayAllowed || !A.overlayAllowed()) {
        toast('请先允许「显示在其他应用上层」');
        if (A && A.overlaySettings) A.overlaySettings();
        return;
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
      if (!A || !A.overlayShown || !A.overlayShown()) { toast('请先开启悬浮歌词'); return; }
      const now = !(A.overlayLocked && A.overlayLocked());
      if (A.overlayLock) A.overlayLock(now);
      refreshOpenSheet();
      toast(now ? '已锁定触摸穿透' : '已解锁');
    }
    return;
  }
  const npFloatCol = e.target.closest('[data-npset-floatcol]');
  if (npFloatCol) {
    e.stopPropagation();
    S.floatColor = npFloatCol.dataset.npsetFloatcol || '#ffffff';
    pushOverlayStyle();
    refreshOpenSheet();
    return;
  }
  if (e.target.closest('#qClear')) {
    e.stopPropagation();
    S.q = '';
    S.online = { q: '', loading: false, songs: [], err: '' };
    const inp = document.getElementById('q');
    if (inp) { inp.value = ''; inp.focus(); }
    updateHomeBody();
    return;
  }
  if (e.target.closest('#qGo')) {
    e.stopPropagation();
    doOnlineSearch();
    return;
  }
  const qHistBtn = e.target.closest('[data-qhist]');
  if (qHistBtn) {
    e.stopPropagation();
    S.q = qHistBtn.dataset.qhist || '';
    const inp = document.getElementById('q');
    if (inp) inp.value = S.q;
    doOnlineSearch();
    return;
  }
  if (e.target.closest('[data-qhist-clear]')) {
    e.stopPropagation();
    clearSearchHist();
    updateHomeBody();
    return;
  }
  const sortBtn = e.target.closest('[data-sort]');
  if (sortBtn) {
    e.stopPropagation();
    S.listSort = sortBtn.dataset.sort || 'default';
    updateListBody();
    return;
  }
  if (e.target.closest('[data-list-playall]')) {
    e.stopPropagation();
    const list = filterAndSortTracks(currentListBaseTracks());
    if (list.length) playAt(list, 0); else toast('列表为空');
    return;
  }
  if (e.target.closest('[data-list-shuffle]')) {
    e.stopPropagation();
    const list = shuffled(filterAndSortTracks(currentListBaseTracks()));
    if (!list.length) { toast('列表为空'); return; }
    ensureShuffle();
    playAt(list, 0);
    toast('随机播放 ' + list.length + ' 首');
    return;
  }
  if (e.target.closest('[data-playall]')) {
    if (S.tracks.length) playAt(S.tracks, 0);
    return;
  }

  const goBtn = e.target.closest('[data-go]');
  if (goBtn) {
    markNavTransition();
    S.listFilter = '';
    S.page = { name: goBtn.dataset.go, arg: null };
    render();
    return;
  }

  const plRow = e.target.closest('[data-pl]');
  if (plRow) {
    markNavTransition();
    S.listFilter = '';
    S.page = { name: 'playlist', arg: plRow.dataset.pl };
    render();
    return;
  }

  if (e.target.closest('#goBack')) { goBack(); return; }

  if (e.target.closest('#newPl')) { openSheet('newpl', null); return; }
});

// Enter 才搜在线 / 换声源关键词回车搜索

// Enter 才搜在线 / 换声源关键词回车搜索
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
    qInputTimer = setTimeout(() => {
      updateHomeBody();
    }, 90);
  } else if (e.target.id === 'listFilterInput') {
    S.listFilter = e.target.value;
    clearTimeout(listFilterTimer);
    listFilterTimer = setTimeout(() => {
      updateListBody();
    }, 80);
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

// mini 播放条 & 播放页控制
document.addEventListener('click', (e) => {
  if (e.target.closest('#miniPlay')) {
    e.stopPropagation();
    togglePlayPause();
    return;
  }
  if (e.target.closest('#miniNext')) { e.stopPropagation(); queueNext(1); return; }
  if (e.target.closest('#miniQueue')) { e.stopPropagation(); openQueueSheet(); return; }
  if (e.target.closest('#mini')) { openNpSheet(); return; }
  if (e.target.closest('.np-stage') || e.target.closest('#npPeek')) { $('#np').classList.add('mode-lyrics'); scrollToCurrentLyric(); return; }
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
  if (e.target.closest('#npSource')) {
    openSourceSwitcher();
    return;
  }
  if (e.target.closest('#npQueue')) {
    openQueueSheet();
    return;
  }
  if (e.target.closest('#npBack')) {
    const npEl = $('#np');
    if (npEl.classList.contains('mode-lyrics')) { npEl.classList.remove('mode-lyrics'); return; }
    npEl.classList.add('hidden');
    return;
  }
  if (e.target.closest('#npPlay')) {
    togglePlayPause();
    return;
  }
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
    if (A.overlayShown && A.overlayShown()) { A.hideOverlay(); toast('悬浮歌词已关闭'); }
    else { A.showOverlay(); toast('已开启：拖动移动，长按锁定，锁定后可在通知栏解锁'); pushOverlay(); }
    return;
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id !== 'npRange') return;
  e.target.dataset.drag = '1';
  const pct = +e.target.value / 10;
  e.target.style.setProperty('--seek-pct', pct.toFixed(1) + '%');
  if (S.dur) {
    $('#npCur').textContent = fmt((+e.target.value / 1000) * S.dur);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id !== 'npRange') return;
  delete e.target.dataset.drag;
  const pct = +e.target.value / 1000;
  e.target.style.setProperty('--seek-pct', (pct * 100).toFixed(1) + '%');
  if (A && S.dur) A.seek(Math.round(pct * S.dur * 1000));
});
