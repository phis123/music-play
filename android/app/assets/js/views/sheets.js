/*
 * views/sheets.js — 底部 <dialog> 弹层（操作面板/歌单/队列/设置抽屉）。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

/* ---------------- 歌单 / 底部弹层 / 随机播放 ---------------- */
/* 底部弹层：<dialog showModal()> —— 焦点陷阱 / inert / ::backdrop 浏览器白送。
   返回键走 window.onAndroidBack（WebView 108 没有 closedby），Esc 走 dialog 的 cancel 事件。 */
function sheetDlg() { return document.getElementById('sheetDlg'); }

function openSheet(kind, arg) {
  S.sheet = { kind: kind, arg: arg || null };
  const dlg = sheetDlg();
  if (!dlg) { render(); return; }
  dlg.innerHTML = sheetHtml();
  if (!dlg.open) dlg.showModal();
  requestAnimationFrame(function () { dlg.classList.add('open'); });   // 108 没有 @starting-style，用类驱动进场
  const inp = dlg.querySelector('#sheetInput');
  if (inp) setTimeout(function () { inp.focus(); if (inp.select) inp.select(); }, 40);
}

function closeSheet() {
  const dlg = sheetDlg();
  S.sheet = { kind: '', arg: null };
  if (!dlg || !dlg.open) return;
  dlg.classList.remove('open');
  let done = false;
  const fin = function () {
    if (done) return;
    done = true;
    try { dlg.close(); } catch (e) { }
    dlg.innerHTML = '';
  };
  dlg.addEventListener('transitionend', fin, { once: true });
  setTimeout(fin, 280);   // 兜底：动画被 reduced-motion 关掉也要能关
}

function sheetHtml() {
  const sh = S.sheet;
  if (!sh || !sh.kind) return '';
  if (sh.kind === 'queue') {
    const modeLabel = S.mode === 'shuffle' ? '🔀 随机播放' : S.mode === 'one' ? '🔂 单曲循环' : '🔁 顺序循环';
    const items = S.queuePaths.map((p, i) => {
      const t = trackByPath(p);
      if (!t) return '';
      const isCur = i === S.cur;
      const eq = isCur ? `<span class="eq-bars${S.playing ? '' : ' paused'}"><i></i><i></i><i></i></span>` : '';
      return `<div class="q-item${isCur ? ' cur' : ''}" data-q-jump="${i}">
        <div class="q-item-main">
          <div class="q-item-title">${eq}${i + 1}. ${esc(t.title || '未知标题')}</div>
          <div class="q-item-sub">${esc(t.artist || '未知艺人')} · ${fmt(t.duration)}</div>
        </div>
        <button class="q-item-rm" data-q-rm="${i}" aria-label="从队列移除">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>`;
    }).join('');
    return `<div class="sheet">
      <div class="sheet-head-row">
        <div class="sheet-title">播放队列（${S.queuePaths.length}）</div>
        <div style="display:flex;gap:6px">
          <button class="sheet-sub-btn" data-q-mode="1">${modeLabel}</button>
          ${S.queuePaths.length ? '<button class="sheet-sub-btn danger" data-q-clear="1">清空</button>' : ''}
        </div>
      </div>
      <div class="q-list" id="qListBox">${items || '<div class="sheet-dim" style="padding:24px 0;text-align:center">队列还是空的，去点首歌吧</div>'}</div>
      <div class="sheet-acts">
        <button class="sheet-btn ghost" data-sheet-close="1">关闭</button>
      </div>
    </div>`;
  }
  if (sh.kind === 'source') {
    const sw = S.srcSwitch;
    const t = sw.track || {};
    let curVoiceTxt = '';
    try {
      const m = JSON.parse(localStorage.getItem('meta:' + t.path) || 'null');
      if (m && m.voiceTitle) curVoiceTxt = ' · 当前源：' + m.voiceTitle;
    } catch (e) { }
    let listHtml = '';
    if (sw.loading) {
      listHtml = '<div class="search-hint">正在搜索匹配的播客声源…</div>';
    } else if (sw.err) {
      listHtml = `<div class="search-hint err">${esc(sw.err)}</div>`;
    } else if (!sw.cands.length) {
      listHtml = '<div class="search-hint">未找到可用声源，可修改上方关键词重试</div>';
    } else {
      listHtml = sw.cands.map((c, idx) => {
        const v = c.v;
        const isPv = String(sw.prevId) === String(v.mainTrackId) && S.playing;
        const isBusy = String(sw.busyId) === String(v.mainTrackId);
        let badge = '';
        if (c.gap != null && Math.abs(c.gap) <= 3 && !c.bad) {
          badge = '<span class="src-tag">时长一致 · 推荐</span>';
        } else if (c.bad) {
          badge = `<span class="src-tag warn">${esc(c.why || '疑似不符')}</span>`;
        } else if (c.gap != null) {
          badge = `<span class="src-tag">差 ${(c.gap > 0 ? '+' : '-') + fmt(Math.abs(c.gap))}</span>`;
        }
        return `<div class="src-item${idx === 0 && !c.bad ? ' best' : ''}">
          <div class="src-cover" style="background-image:url('${esc(v.cover || '')}')"></div>
          <div class="src-main">
            <div class="src-title">${esc(v.title || '未命名声音')}</div>
            <div class="src-sub">
              <span>${esc(v.radio || '未知电台')}</span>
              <span>· ${fmt(v.duration)}</span>
              ${badge}
            </div>
          </div>
          <div class="src-acts">
            <button class="src-pv${isPv ? ' on' : ''}" data-src-pv="${idx}" ${sw.busyId ? 'disabled' : ''}>${isPv ? '❚❚ 停止' : '▶ 试听'}</button>
            <button class="src-use" data-src-use="${idx}" ${sw.busyId ? 'disabled' : ''}>${isBusy ? '替换中…' : '选用替换'}</button>
          </div>
        </div>`;
      }).join('');
    }
    return `<div class="sheet">
      <div class="sheet-head-row">
        <div>
          <div class="sheet-title">更换声源</div>
          <div class="sheet-dim" style="margin-top:2px">${esc(t.title || '未知')} — ${esc(t.artist || '未知艺人')}（当前 ${fmt(t.duration)}${esc(curVoiceTxt)}）</div>
        </div>
      </div>
      <div class="src-search">
        <input id="srcKwInput" placeholder="输入歌名 / 歌手搜索声源" value="${esc(sw.kw)}">
        <button class="dl-btn" id="srcKwGo" ${sw.loading || sw.busyId ? 'disabled' : ''}>搜索</button>
      </div>
      <div id="srcDlBox" class="imp-q" style="${sw.busyId || sw.dlErr ? 'margin:0 0 8px' : 'display:none'}">
        <div class="imp-q-track"><div class="imp-q-bar" id="srcDlBar" style="width:${sw.dlPct || 0}%"></div></div>
        <div class="imp-q-text" id="srcDlText" style="${sw.dlErr ? 'color:var(--red)' : ''}">${esc(sw.dlErr || sw.dlText || '正在准备下载声源…')}</div>
      </div>
      <div class="src-list">${listHtml}</div>
      <div class="sheet-acts">
        ${sw.prevId ? '<button class="sheet-btn ghost" data-src-restore="1">恢复原曲播放</button>' : ''}
        <button class="sheet-btn ghost" data-sheet-close="1">关闭</button>
      </div>
    </div>`;
  }
  if (sh.kind === 'taskerr') {
    const errs = (S.task && S.task.errors) || [];
    const rows = errs.map((er, i) => `
      <div class="err-item">
        <div class="err-item-t">${i + 1}. ${esc(er.name)}</div>
        <div class="err-item-s">${esc(er.reason)}</div>
      </div>`).join('');
    return `<div class="sheet">
      <div class="sheet-head-row">
        <div>
          <div class="sheet-title">任务报错与异常详情（${errs.length}）</div>
          <div class="sheet-dim" style="margin-top:2px">${esc(S.task.title || '')}</div>
        </div>
      </div>
      <div class="err-list">${rows || '<div class="sheet-dim" style="padding:18px 0;text-align:center">暂无报错记录</div>'}</div>
      <div class="sheet-acts">
        <button class="sheet-btn ghost" data-sheet-close="1">关闭</button>
      </div>
    </div>`;
  }
  if (sh.kind === 'diagsnap') {
    return `<div class="sheet">
      <div class="sheet-head-row">
        <div>
          <div class="sheet-title">环境快照</div>
          <div class="sheet-dim" style="margin-top:2px">设备 / 屏幕 / WebView / 权限 / 存储 / 播放状态</div>
        </div>
      </div>
      <pre class="diag-pre">${esc(S.diagSnapshotText || '')}</pre>
      <div class="sheet-acts">
        <button class="sheet-btn ghost" data-sheet-close="1">关闭</button>
      </div>
    </div>`;
  }
  if (sh.kind === 'npset') {
    const curPath = S.queuePaths[S.cur] || '';
    const t = curPath ? trackByPath(curPath) : null;
    const { autoDb, manualDb, totalDb } = getCurrentTrackEffectiveGain();
    const offSec = ((S.offset || 0) / 1000).toFixed(1);
    const floatShown = !!(A && A.overlayShown && A.overlayShown());
    const floatLocked = !!(A && A.overlayLocked && A.overlayLocked());
    const floatSwatches = ['#ffffff', '#ec4141', '#4da3ff', '#ffd54a', '#4ade80', '#ff8ad4', '#c084fc'];
    return `<div class="sheet">
      <div class="sheet-head-row">
        <div>
          <div class="sheet-title">播放设置（单曲调音 / 歌词延迟 / 悬浮词）</div>
          <div class="sheet-dim" style="margin-top:2px">${esc(t ? (t.title || '当前曲目') : '未在播放')}</div>
        </div>
      </div>

      <div class="npset-sec">
        <div class="npset-head">
          <span class="npset-title">♪ 本曲音量平衡（单歌微调）</span>
          <span class="npset-sub" id="mobMiniGainInfo">自动 ${autoDb >= 0 ? '+' : ''}${autoDb.toFixed(1)}dB · 合成 ${totalDb >= 0 ? '+' : ''}${totalDb.toFixed(1)}dB</span>
        </div>
        <div class="npset-row">
          <span style="font-size:12px;color:var(--dim)">单曲增益</span>
          <input type="range" id="mobMiniGainRange" min="-12" max="12" step="0.5" value="${manualDb}">
          <span id="mobMiniGainVal" style="font-size:12px;font-weight:700;min-width:48px;text-align:right">${manualDb > 0 ? '+' : ''}${manualDb.toFixed(1)}dB</span>
        </div>
        <div class="npset-chips">
          <button class="npset-chip" data-npset-gain="-1.5">-1.5dB</button>
          <button class="npset-chip" data-npset-gain="-0.5">-0.5dB</button>
          <button class="npset-chip${manualDb === 0 ? ' on' : ''}" data-npset-gain="reset">重置 0dB</button>
          <button class="npset-chip" data-npset-gain="0.5">+0.5dB</button>
          <button class="npset-chip" data-npset-gain="1.5">+1.5dB</button>
          <button class="npset-chip${S.normEnabled ? ' on' : ''}" data-npset-normtoggle="1" style="margin-left:auto">${S.normEnabled ? '全局均衡:开' : '全局均衡:关'}</button>
        </div>
      </div>

      <div class="npset-sec">
        <div class="npset-head">
          <span class="npset-title">⏱ 本曲歌词延迟微调</span>
          <span class="npset-sub" id="mobMiniOffVal">当前偏移 ${S.offset > 0 ? '+' : ''}${offSec}s</span>
        </div>
        <div class="npset-row">
          <span style="font-size:12px;color:var(--dim)">时间轴</span>
          <input type="range" id="mobMiniOffRange" min="-5000" max="5000" step="100" value="${Math.max(-5000, Math.min(5000, S.offset || 0))}">
        </div>
        <div class="npset-chips">
          <button class="npset-chip" data-npset-off="-500">-0.5s</button>
          <button class="npset-chip" data-npset-off="-100">提前 0.1s</button>
          <button class="npset-chip${!S.offset ? ' on' : ''}" data-npset-off="reset">重置 0.0s</button>
          <button class="npset-chip" data-npset-off="100">延后 0.1s</button>
          <button class="npset-chip" data-npset-off="500">+0.5s</button>
        </div>
      </div>

      <div class="npset-sec">
        <div class="npset-head">
          <span class="npset-title">💬 悬浮歌词设计</span>
          <div style="display:flex;gap:6px">
            <button class="npset-chip${floatShown ? ' on' : ''}" data-npset-float="toggle">${floatShown ? '悬浮词:已开' : '开启悬浮词'}</button>
            <button class="npset-chip${floatLocked ? ' on' : ''}" data-npset-float="lock">${floatLocked ? '解锁穿透' : '锁定穿透'}</button>
          </div>
        </div>
        <div class="npset-row">
          <span style="font-size:12px;color:var(--dim);min-width:44px">字号</span>
          <input type="range" id="mobMiniFloatSz" min="12" max="28" step="1" value="${S.floatSizeSp}">
          <span id="mobMiniFloatSzVal" style="font-size:12px;font-weight:700;min-width:40px;text-align:right">${S.floatSizeSp}sp</span>
        </div>
        <div class="npset-row">
          <span style="font-size:12px;color:var(--dim);min-width:44px">底色度</span>
          <input type="range" id="mobMiniFloatBg" min="0" max="80" step="5" value="${S.floatBgOpacity}">
          <span id="mobMiniFloatBgVal" style="font-size:12px;font-weight:700;min-width:40px;text-align:right">${S.floatBgOpacity}%</span>
        </div>
        <div class="npset-row">
          <span style="font-size:12px;color:var(--dim);min-width:44px">配色</span>
          <div class="set-swatches">
            ${floatSwatches.map((c) => `<span class="set-swatch${S.floatColor.toLowerCase() === c ? ' on' : ''}" data-npset-floatcol="${c}" style="width:22px;height:22px;background:${c}"></span>`).join('')}
          </div>
        </div>
      </div>

      <div class="sheet-acts">
        <button class="sheet-btn ghost" data-sheet-close="1">完成</button>
      </div>
    </div>`;
  }
  if (sh.kind === 'setdir') {
    const curRoot = (function () { try { return (A && A.rootDir) ? A.rootDir() : '/storage/emulated/0/Music/music-play'; } catch (e) { return '/storage/emulated/0/Music/music-play'; } })();
    return `<div class="sheet">
      <div class="sheet-title">调整曲库与下载目录</div>
      <div class="sheet-line">选择预设目录或在下方输入 <code>/sdcard/Music/</code> 下的子文件夹名：</div>
      <div class="npset-chips" style="margin:8px 0 10px">
        <button class="npset-chip" data-dir-preset="music-play">默认 (Music/music-play)</button>
        <button class="npset-chip" data-dir-preset="/storage/emulated/0/Music">系统 Music 根目录</button>
        <button class="npset-chip" data-dir-preset="music-play-podcast">Music/music-play-podcast</button>
      </div>
      <input id="sheetInput" class="sheet-input" placeholder="输入目录路径或子文件夹名" value="${esc(curRoot)}">
      <div class="sheet-acts">
        <button class="sheet-btn ghost" data-sheet-close="1">取消</button>
        <button class="sheet-btn" data-sheet-ok="1">保存并重新扫描</button>
      </div>
    </div>`;
  }
  let title = '', body = '', okText = '确定';
  if (sh.kind === 'del') {
    const t = sh.arg || {};
    title = '删除歌曲';
    body = `<div class="sheet-line">确定从设备删除《${esc(t.title || '未知')}》？<div class="sheet-dim">音频和同名 .lrc 会一起删掉，不可恢复。</div></div>`;
  } else if (sh.kind === 'newpl') {
    title = '新建歌单';
    body = '<input id="sheetInput" class="sheet-input" placeholder="歌单名称" value="">';
  } else if (sh.kind === 'renamepl') {
    title = '重命名歌单';
    body = `<input id="sheetInput" class="sheet-input" placeholder="歌单名称" value="${esc((sh.arg && sh.arg.name) || '')}">`;
    okText = '保存';
  } else if (sh.kind === 'delpl') {
    title = '删除歌单';
    body = `<div class="sheet-line">删除歌单《${esc((sh.arg && sh.arg.name) || '')}》？<div class="sheet-dim">只删歌单，歌曲文件保留。</div></div>`;
    okText = '删除';
  } else if (sh.kind === 'storage') {
    title = '需要存储权限';
    body = `<div class="sheet-line">Android 11 以后，要在「音乐」目录里<strong>删除/写入</strong>文件，必须给本 App「所有文件访问权限」。
      <div class="sheet-dim">设置 → 权限管理 → 所有文件访问权限 → music-play。授权后返回 App 即可正常删除和下载。</div></div>`;
    okText = '去授权';
  } else if (sh.kind === 'addpl') {
    title = '加入歌单';
    const rows = S.playlists.map((p) => `<button class="sheet-item" data-sheet-pl="${esc(p.id)}">
        <span class="sheet-item-t">${esc(p.name)}</span>
        <span class="sheet-item-s">${p.tracks.length} 首 ›</span></button>`).join('');
    body = `<div class="sheet-list">${rows || '<div class="sheet-dim" style="padding:10px 2px">还没有歌单</div>'}</div>`;
    okText = '新建歌单';
  }
  return `<div class="sheet">
      <div class="sheet-title">${esc(title)}</div>
      ${body}
      <div class="sheet-acts">
        <button class="sheet-btn ghost" data-sheet-close="1">取消</button>
        <button class="sheet-btn" data-sheet-ok="1">${esc(okText)}</button>
      </div>
    </div>`;
}

function sheetOk() {
  const sh = S.sheet;
  if (!sh || !sh.kind) return;
  const el = document.getElementById('sheetInput');
  const val = el ? el.value : '';
  if (sh.kind === 'del') { const t = sh.arg; closeSheet(); deleteTrackNow(t); return; }
  if (sh.kind === 'newpl') {
    const pl = newPlaylist(val);
    if (!pl) return;
    const addTrack = sh.arg && sh.arg.addTrack;
    if (addTrack && pl.tracks.indexOf(addTrack.path) < 0) { pl.tracks.push(addTrack.path); savePlaylists(); }
    closeSheet();
    toast('已新建「' + pl.name + '」' + (addTrack ? '，并加入 1 首' : ''));
    return;
  }
  if (sh.kind === 'renamepl') { const p = sh.arg; closeSheet(); renamePlaylist(p, val); return; }
  if (sh.kind === 'delpl') { const p = sh.arg; closeSheet(); removePlaylist(p); return; }
  if (sh.kind === 'addpl') { openSheet('newpl', { addTrack: sh.arg }); return; }
  if (sh.kind === 'storage') { closeSheet(); if (A && A.openAllFilesSettings) A.openAllFilesSettings(); return; }
  if (sh.kind === 'setdir') {
    closeSheet();
    if (A && typeof A.setRootDir === 'function') {
      const nextDir = A.setRootDir(val || 'music-play');
      toast('下载与曲库目录已设为：' + nextDir);
      manualRescan();
    }
    return;
  }
}

function sheetPickPlaylist(id) {
  const sh = S.sheet;
  const t = sh && sh.kind === 'addpl' ? sh.arg : null;
  const pl = S.playlists.find((x) => x.id === id);
  if (!t || !pl) return;
  if (pl.tracks.indexOf(t.path) < 0) pl.tracks.push(t.path);
  savePlaylists();
  closeSheet();
  toast('已加入「' + pl.name + '」');
}

function newPlaylist(name) {
  name = String(name || '').trim();
  if (!name) { toast('歌单名不能为空'); return null; }
  const pl = { id: String(Date.now()), name: name, tracks: [] };
  S.playlists.push(pl);
  savePlaylists();
  try { if (A && A.mkdir) A.mkdir(name); } catch (e) { }
  return pl;
}

function renamePlaylist(pl, name) {
  name = String(name || '').trim();
  if (!pl) return;
  if (!name) { toast('歌单名不能为空'); return; }
  pl.name = name;
  savePlaylists();
  render();
  toast('已重命名');
}

function removePlaylist(pl) {
  if (!pl) return;
  S.playlists = S.playlists.filter((p) => p.id !== pl.id);
  savePlaylists();
  S.page = { name: 'playlists', arg: null };
  render();
  toast('歌单已删除（歌曲文件保留）');
}

function removeFromPlaylist(pl, path) {
  if (!pl) return;
  pl.tracks = pl.tracks.filter((x) => x !== path);
  savePlaylists();
  render();
  toast('已移出歌单');
}

/** 真删文件（弹层确认后调用） */

/** 真删文件（弹层确认后调用） */
function deleteTrackNow(t) {
  if (!t) return;
  if (!A || !A.removeFile) { toast('当前版本不支持删除'); return; }
  if (!storageOK()) { askStorage(); return; }
  let r = null;
  try { r = JSON.parse(A.removeFile(t.path) || '{}'); } catch (e) { r = null; }
  if (!r || !r.ok) {
    if (r && r.needPerm) askStorage();
    else toast('删除失败' + (r && r.reason ? '：' + r.reason : ''));
    return;
  }
  S.favs.delete(t.path);
  saveFavs();
  S.playlists.forEach((p) => { p.tracks = p.tracks.filter((x) => x !== t.path); });
  savePlaylists();
  try { localStorage.removeItem('meta:' + t.path); } catch (e) { }
  try { localStorage.setItem('recentPaths', JSON.stringify(getRecentPaths().filter((p) => p !== t.path))); } catch (e) { }
  loadLibrary();
  render();
  toast('已删除');
}
