/*
 * native-callbacks.js — 原生 WebView 回调入口（window.onTick/onPlaying/onEnded/…）。函数名与签名保持不变。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

/* ---------------- 原生回调 ---------------- */
window.onTick = function (sec) {
  S.pos = sec;
  const pct = S.dur ? Math.min(100, (sec / S.dur) * 100) : 0;
  $('#miniBar').style.width = pct + '%';
  const npEl = document.getElementById('np');
  const npOpen = npEl && !npEl.classList.contains('hidden');
  if (npOpen) {
    const r = $('#npRange');
    if (!r || !r.dataset.drag) {
      $('#npCur').textContent = fmt(sec);
      if (r) {
        r.value = Math.round(pct * 10);
        r.style.setProperty('--seek-pct', pct.toFixed(1) + '%');
      }
    }
    syncLyric(sec);
  } else if (S.lyrics.length && A && A.overlayShown && A.overlayShown()) {
    // 播放页收起但开启了桌面悬浮词时，只做轻量级二分/线性定位，不触碰 #npLyrics DOM
    const t = sec - S.offset / 1000;
    let idx = -1;
    for (let i = 0; i < S.lyrics.length; i++) if (S.lyrics[i].t <= t + 0.05) idx = i;
    if (idx !== S.lyricIdx) {
      S.lyricIdx = idx;
      pushOverlay();
    }
  }
  if (Date.now() - _posSaveTimer > 4000) {
    _posSaveTimer = Date.now();
    savePlayerSession(true);
  }
};

window.onPlaying = function (dur) {
  S.playing = true;
  if (dur > 0) {
    S.dur = dur;
    $('#npDur').textContent = fmt(S.dur);
  }
  paintPlayIcon();
};

window.onEnded = function () {
  // 试听不建队列：播完直接收尾，别把用户切到队列里的本地歌，也别卡在「播放中」
  if (S.previewPath) {
    exitPreviewMode();
    S.playing = false;
    paintPlayIcon();
    diagLog('preview', '试听播完，已退出试听态');
    return;
  }
  queueNext(1, true);
};

window.onPlayerError = function (what, extra) {
  diag('onPlayerError what=' + what + ' extra=' + extra);
  if (S.previewPath) {
    exitPreviewMode();
    S.playing = false;
    paintPlayIcon();
    toast('试听失败（' + (what === -2 ? '播放服务未就绪' : what) + '），请重新点试听');
    return;
  }
  S.playing = false;
  paintPlayIcon();
  toast('播放失败');
};

window.onDownload = function (pct, name, got, total) {
  const label = pct >= 0 ? pct + '%' : (got > 0 ? mbStr(got, total) : '下载中');
  if (S.sheet && S.sheet.kind === 'source' && S.srcSwitch.busyId) {
    const p = pct >= 0 ? pct : 50;
    S.srcSwitch.dlPct = p;
    S.srcSwitch.dlText = `正在下载声源：${label}${got > 0 ? ' (' + mbStr(got, total) + ')' : ''}`;
    const bEl = document.getElementById('srcDlBar');
    const tEl = document.getElementById('srcDlText');
    if (bEl) bEl.style.width = p + '%';
    if (tEl) tEl.textContent = S.srcSwitch.dlText;
  }
  const it = window.__impCurrent;
  if (imp.busy && it) {
    it.prog = label;
    imp.curPct = pct;
    const rowIdx = it._idx != null ? it._idx : imp.items.indexOf(it);
    const el = document.getElementById('impprog-' + rowIdx);
    if (el) el.textContent = label;
    updImpBar();
    stepTask(imp.doneCount, `正在下载 (${imp.doneCount + 1}/${imp.totalCount})：${it.song.name} · ${label}`);
    return;
  }
  const k = S.voices.activeKey;
  if (!k) return;
  S.voices.busy[k] = label;
  const sel = S.voices.activeIdx == null ? '[data-dl]' : '[data-dl="' + S.voices.activeIdx + '"]';
  const btn = document.querySelector(sel);
  if (btn) btn.textContent = label;
};

window.onMediaNext = function () { queueNext(1); };

window.onMediaPrev = function () { queueNext(-1); };

window.onDownloadDone = function (ok, pathOrMsg) {
  const k = S.voices.activeKey;
  const ctx = window.__dlCtx || null;
  const batch = !!(imp.busy && window.__impCurrent);
  let finishedIt = null;
  if (batch) {
    const it = window.__impCurrent;
    finishedIt = it;
    it.running = false;
    it.done = !!ok;
    it.prog = '';
    if (!ok) {
      it.skip = true;
      it.err = String(pathOrMsg || '下载失败');
      recordTaskError(it.song.name, it.err);
    }
    imp.doneCount = (imp.doneCount || 0) + 1;
    window.__impCurrent = null;
  } else if (k) {
    S.voices.busy[k] = ok ? '完成' : '失败';
  }

  if (ok && ctx && pathOrMsg && pathOrMsg.indexOf('/') >= 0) {
    const path = pathOrMsg;
    if (ctx.lrc && A.saveLyric) {
      try { A.saveLyric(path, ctx.lrc) } catch (e) { }
    }
    try {
      localStorage.setItem('meta:' + path, JSON.stringify({
        artist: ctx.song.artist || '',
        album: ctx.song.album || '',
        cover: ctx.song.cover || '',
        hasLrc: !!(ctx.lrc && ctx.lrc.length > 30),
        title: ctx.song.name || '',
        alias: (ctx.song.alias || []).join('|'),
        v: 2,
      }));
    } catch (e) { }
    if (!batch) toast(/Android\/data\//.test(String(pathOrMsg)) ? '已保存到应用私有目录（公共目录不可写）' : '已保存到 Music/');
  } else if (!batch) {
    toast(ok ? (/Android\/data\//.test(String(pathOrMsg)) ? '已保存到应用私有目录' : '已保存到 Music/') : ('下载失败：' + pathOrMsg));
  } else if (!ok) {
    toast('下载失败已记录：' + pathOrMsg);
  }
  if (ok && !batch) { refreshLibrary([0, 800, 2000, 4000, 7000]); }
  window.__dlCtx = null;
  if (batch) {
    if (finishedIt) updateSingleImpRow(finishedIt._idx);
    updImpBar();
    scheduleSaveImpState(false);
    if (window.__impStop) {
      window.__impQueue = []; imp.busy = false;
      scheduleSaveImpState(true);
      finishTask('批量下载已停止', `已处理 ${imp.doneCount} / ${imp.totalCount} 首`);
      if (S.page.name === 'import') render();
      toast('已停止下载');
      return;
    }
    bgSchedule(nextImportDownload, 140);
    return;
  }
  loadLibrary();
  render();
};

window.onAppResume = function () {
  // 回前台：权限可能刚批、媒体库可能刚扫完，或后台批量匹配/下载刚更新了多行 → 重新读库并刷新当前视图
  try {
    grabBridge();
    if (S.page.name === 'import') {
      render();
    } else {
      refreshLibrary([0, 700, 1800]);
    }
  } catch (e) {
    try { render(); } catch (e2) { }
  }
};

window.onAndroidBack = function () {
  if (S.sheet && S.sheet.kind) { closeSheet(); return true; }   // 弹层最优先
  const npB = $('#np');
  if (!npB.classList.contains('hidden')) {
    if (npB.classList.contains('mode-lyrics')) { npB.classList.remove('mode-lyrics'); return true; }
    npB.classList.add('hidden');
    return true;
  }
  if (S.page.name !== 'home' && S.page.name !== 'me') { goBack(); return true; }
  return false;
};
