/*
 * events/library.js — 曲目行操作、歌单、批量导入、曲库体检与在线试听/下载事件。
 * 依赖：window.MP（按 index.html 顺序在 events.js 之前加载）。
 */
'use strict';
window.MP = window.MP || {};

function handleLibraryAndTrackClick(e) {
  /* ---- 行内动作（必须排在 data-song 之前，否则会被当成播放） ---- */
  const qNextBtn = e.target.closest('[data-qnext]');
  if (qNextBtn) {
    e.stopPropagation();
    playNextInsert(S.tracks[+qNextBtn.dataset.qnext]);
    return true;
  }
  const plRm = e.target.closest('[data-plrm]');
  if (plRm) {
    e.stopPropagation();
    removeFromPlaylist(S.playlists.find((x) => x.id === plRm.dataset.plrm), plRm.dataset.path);
    return true;
  }
  const plDelBtn = e.target.closest('[data-pldel]');
  if (plDelBtn) {
    e.stopPropagation();
    const p = S.playlists.find((x) => x.id === plDelBtn.dataset.pldel);
    if (p) openSheet('delpl', p);
    return true;
  }
  const plRenBtn = e.target.closest('[data-plrename]');
  if (plRenBtn) {
    e.stopPropagation();
    const p = S.playlists.find((x) => x.id === plRenBtn.dataset.plrename);
    if (p) openSheet('renamepl', p);
    return true;
  }
  const plPlayBtn = e.target.closest('[data-plplay]');
  if (plPlayBtn) {
    const p = S.playlists.find((x) => x.id === plPlayBtn.dataset.plplay);
    const list = p ? p.tracks.map(trackByPath).filter(Boolean) : [];
    if (list.length) playAt(list, 0); else toast('歌单是空的');
    return true;
  }
  const plShufBtn = e.target.closest('[data-plshuffle]');
  if (plShufBtn) {
    const p = S.playlists.find((x) => x.id === plShufBtn.dataset.plshuffle);
    const list = p ? shuffled(p.tracks.map(trackByPath).filter(Boolean)) : [];
    if (!list.length) { toast('歌单是空的'); return true; }
    ensureShuffle();
    playAt(list, 0);
    toast('随机播放 ' + list.length + ' 首');
    return true;
  }
  const plAddBtn = e.target.closest('[data-pladd]');
  if (plAddBtn) { e.stopPropagation(); addToPlaylist(S.tracks[+plAddBtn.dataset.pladd]); return true; }
  const delBtnX = e.target.closest('[data-del]');
  if (delBtnX) { e.stopPropagation(); deleteTrack(S.tracks[+delBtnX.dataset.del]); return true; }
  if (e.target.closest('[data-shuffle-all]')) { playShuffleAll(); return true; }
  if (e.target.closest('#npShuffle')) { toggleShuffle(); return true; }

  if (e.target.closest('[data-storage]')) {
    if (!storageOK()) { askStorage(); return true; }
    let txt = '存储权限已开启';
    try {
      const d = JSON.parse(A.storageInfo());
      txt = '公共 ' + (d.publicListable ? d.publicAudio + ' 首' : '读不到') + ' · 私有 ' + d.privateAudio + ' 首' + (d.allFiles ? '' : ' · 无所有文件访问');
    } catch (err) { }
    toast(txt);
    return true;
  }

  const song = e.target.closest('[data-song]');
  if (song) {
    const idx = +song.dataset.song;
    const t = S.tracks[idx];
    if (!t) return true;
    let visible = (_currentShownTracks && _currentShownTracks.length)
      ? _currentShownTracks
      : [...document.querySelectorAll('[data-song]')].map((el) => S.tracks[+el.dataset.song]).filter(Boolean);
    let pos = visible.findIndex((x) => x && x.path === t.path);
    if (pos < 0) {
      visible = S.tracks;
      pos = idx;
    }
    playAt(visible, pos < 0 ? 0 : pos);
    return true;
  }
  return false;
}

function handleImportClick(e) {
  const impFilterBtn = e.target.closest('[data-imp-filter]');
  if (impFilterBtn) {
    e.stopPropagation();
    imp.filter = impFilterBtn.dataset.impFilter || 'all';
    render();
    return true;
  }
  if (e.target.closest('#impMatchStop')) {
    e.stopPropagation();
    window.__impMatchStop = true;
    toast('正在暂停声源匹配…');
    return true;
  }
  if (e.target.closest('#impMatchResume')) {
    e.stopPropagation();
    matchImport(true);
    return true;
  }

  const kwGoBtn = e.target.closest('[data-imp-kwgo]');
  if (kwGoBtn) {
    e.stopPropagation();
    const idx = +kwGoBtn.dataset.impKwgo;
    const inEl = document.getElementById('impkw-' + idx);
    mobileInlineImpSearch(idx, inEl ? inEl.value : '', false);
    return true;
  }
  const kwPreBtn = e.target.closest('[data-imp-kwpreset]');
  if (kwPreBtn) {
    e.stopPropagation();
    const pair = String(kwPreBtn.dataset.impKwpreset).split(':');
    const idx = +pair[0];
    const kind = pair[1];
    const it = imp.items[idx];
    if (!it) return true;
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
    return true;
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
      return true;
    }
    if (e.target.closest('#impGo')) { doImportParse(); return true; }
    if (e.target.closest('#impAll')) { importDownloadAll(); return true; }
    if (e.target.closest('#impClear')) {
      window.__impMatchStop = true;
      imp.link = ''; imp.name = ''; imp.items = []; imp.err = ''; imp.open = -1; imp.matching = false;
      scheduleSaveImpState(true);
      dismissTask();
      render();
      toast('已清空导入列表');
      return true;
    }
    if (e.target.closest('#impStop')) {
      window.__impStop = true;
      if (!window.__impCurrent) { window.__impQueue = []; imp.busy = false; scheduleSaveImpState(true); render(); }
      toast('正在停止…');
      return true;
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
      return true;
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
      return true;
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
    return true;
  }

  /* ---- 曲库体检与在线试听/下载 ---- */
  const hTab = e.target.closest('[data-health-tab]');
  if (hTab) {
    e.stopPropagation();
    S.healthTab = hTab.dataset.healthTab || 'dup';
    render();
    return true;
  }
  if (e.target.closest('#healthRebuildTags')) {
    e.stopPropagation();
    toast('正在清空标签缓存并重新读取歌手与封面…');
    rebuildTagsAndCovers();
    return true;
  }
  if (e.target.closest('#healthFillMeta')) {
    e.stopPropagation();
    S.tracks.forEach((t) => { if (!t.hasLrc || !t.artist || !t.cover) t._enriched = false; });
    const todoCnt = S.tracks.filter((t) => !t.hasLrc || !t.artist || (!t.cover && !S.covers.get(t.path))).length;
    toast(`开始自动补齐 ${todoCnt} 首缺失歌词与封面…`);
    enrichMissing();
    return true;
  }

  const pvBtn = e.target.closest('[data-pv]');
  if (pvBtn) { e.stopPropagation(); previewVoice(+pvBtn.dataset.pv); return true; }

  const dlBtn = e.target.closest('[data-dl]');
  if (dlBtn) { e.stopPropagation(); downloadVoice(+dlBtn.dataset.dl); return true; }

  const oSong = e.target.closest('[data-osong]');
  if (oSong) { openVoices(oSong.dataset.osong); return true; }

  return false;
}
