/*
 * views/local.js — 本地/最近/喜欢/歌单列表视图与列表通用组件。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

function songRow(t, idx, plId, orderIdx) {
  if (idx == null) idx = t._idx != null ? t._idx : S.tracks.indexOf(t);
  const on = S.favs.has(t.path);
  const curPath = S.queuePaths[S.cur] || '';
  const isCur = !!(curPath && t.path === curPath);
  const deferCls = orderIdx != null && orderIdx >= 24 ? ' cv-defer' : '';
  const eq = isCur ? `<span class="eq-bars${S.playing ? '' : ' paused'}"><i></i><i></i><i></i></span>` : '';
  const kb = t.kbps ? `<span class="badge-k">${t.kbps}k</span>` : '';
  const qNextBtn = `<button class="row-act" data-qnext="${idx}" aria-label="下一首播放" title="下一首播放"><svg viewBox="0 0 24 24"><use href="#ico-qnext"/></svg></button>`;
  const acts = plId
    ? `${qNextBtn}<button class="row-act" data-plrm="${esc(plId)}" data-path="${esc(t.path)}" aria-label="移出歌单"><svg viewBox="0 0 24 24"><use href="#ico-plrm"/></svg></button>`
    : `${qNextBtn}<button class="row-act" data-pladd="${idx}" aria-label="加入歌单"><svg viewBox="0 0 24 24"><use href="#ico-pladd"/></svg></button><button class="row-act del" data-del="${idx}" aria-label="删除"><svg viewBox="0 0 24 24"><use href="#ico-del"/></svg></button>`;
  return `<div class="row${isCur ? ' playing' : ''}${deferCls}" data-song="${idx}" data-path="${esc(t.path)}">
    <div class="row-cover" data-cover="${idx}"></div>
    <div class="row-main">
      <div class="row-title"><span class="row-eq-slot">${eq}</span>${esc(t.title || '未知标题')}${kb}</div>
      <div class="row-sub">${esc(t.artist || '未知艺人')} · ${fmt(t.duration)}${t.hasLrc ? ' · 词' : ''}</div>
    </div>
    <button class="row-act ${on ? 'on' : ''}" data-fav="${idx}" aria-label="喜欢"><svg viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}"><use href="#ico-heart"/></svg></button>
    ${acts}
  </div>`;
}

/* ---------------- 列表 Hero 顶栏 + 页内筛选与排序 ---------------- */
function totalDurStr(list) {
  const sec = (list || []).reduce((acc, t) => acc + (+(t && t.duration) || 0), 0);
  const mins = Math.round(sec / 60);
  return mins > 0 ? ` · 约 ${mins} 分钟` : '';
}

const _zhCollator = (typeof Intl !== 'undefined' && Intl.Collator) ? new Intl.Collator('zh-CN') : null;

const cmpZh = (a, b) => _zhCollator ? _zhCollator.compare(a, b) : String(a).localeCompare(String(b));

function filterAndSortTracks(list) {
  let out = (list || []).slice();
  const kw = (S.listFilter || '').trim();
  if (kw) out = out.filter((t) => matchTrack(t, kw));
  const st = S.listSort || 'default';
  if (st === 'title') {
    out.sort((a, b) => cmpZh(a.title || '', b.title || ''));
  } else if (st === 'artist') {
    out.sort((a, b) => cmpZh(a.artist || '', b.artist || ''));
  } else if (st === 'duration') {
    out.sort((a, b) => (+(b.duration || 0)) - (+(a.duration || 0)));
  } else if (st === 'recent') {
    out.sort((a, b) => (+(b.id || 0)) - (+(a.id || 0)));
  }
  return out;
}

function heroCardHtml(opts) {
  const firstIdx = opts.firstTrack ? S.tracks.indexOf(opts.firstTrack) : -1;
  const covAttr = firstIdx >= 0 ? `data-cover="${firstIdx}"` : '';
  return `<div class="hero-card">
    <div class="hero-cover" ${covAttr}>
      ${firstIdx < 0 ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18V6.5l9-2V16"/><circle cx="6.6" cy="18" r="2.4"/><circle cx="15.6" cy="16" r="2.4"/></svg>' : ''}
    </div>
    <div class="hero-main">
      <div class="hero-title">${esc(opts.title)}</div>
      <div class="hero-sub">${esc(opts.sub)}</div>
      <div class="hero-acts">${opts.actsHtml || ''}</div>
    </div>
  </div>`;
}

function listToolbarHtml() {
  const st = S.listSort || 'default';
  const sorts = [
    ['default', '默认'],
    ['title', '歌名'],
    ['artist', '歌手'],
    ['duration', '时长'],
    ['recent', '最新'],
  ];
  return `<div class="list-toolbar">
    <div class="list-filter">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="6.4"/><path d="M16 16l4.5 4.5"/></svg>
      <input id="listFilterInput" type="search" placeholder="在当前列表中筛选歌曲/歌手…" value="${esc(S.listFilter)}">
    </div>
    <div class="list-sorts">
      ${sorts.map(([k, lbl]) => `<button class="sort-pill${st === k ? ' on' : ''}" data-sort="${k}">${lbl}</button>`).join('')}
    </div>
  </div>`;
}

function currentListBaseTracks() {
  const p = S.page;
  if (p.name === 'local') return S.tracks;
  if (p.name === 'liked') return favTracks();
  if (p.name === 'recent') return recentTracks();
  if (p.name === 'playlist') {
    const pl = S.playlists.find((x) => x.id === p.arg);
    return pl ? pl.tracks.map(trackByPath).filter(Boolean) : [];
  }
  return S.tracks;
}

const SONG_FIRST_CHUNK = 28;

const SONG_NEXT_CHUNK = 36;

let _pendingSongList = [];

let _pendingSongPlId = undefined;

function renderListRowsHtml() {
  const base = currentListBaseTracks();
  const shown = filterAndSortTracks(base);
  const plId = S.page.name === 'playlist' ? S.page.arg : undefined;
  _currentShownTracks = shown;
  _pendingSongList = shown;
  _pendingSongPlId = plId;
  if (!shown.length) {
    return `<div class="search-hint">没有符合筛选条件的歌曲</div>`;
  }
  const firstSlice = shown.slice(0, SONG_FIRST_CHUNK);
  return `<div class="list-2col" id="songGridBox">${firstSlice.map((t, k) => songRow(t, t._idx, plId, k)).join('')}</div>`;
}

async function mountSongRowsChunked() {
  const token = ++_songChunkToken;
  const list = _pendingSongList || [];
  const plId = _pendingSongPlId;
  if (list.length <= SONG_FIRST_CHUNK) return;
  // 先让出主线程，让首屏 28 首立即完成排版与上屏绘制（首屏 < 15ms）
  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (token !== _songChunkToken) return;
  let offset = SONG_FIRST_CHUNK;
  let deadline = performance.now() + 50;
  while (offset < list.length) {
    if (token !== _songChunkToken) return;
    const b = document.getElementById('songGridBox');
    if (!b) return;
    const slice = list.slice(offset, offset + SONG_NEXT_CHUNK);
    if (!slice.length) break;
    const startIdx = offset;
    b.insertAdjacentHTML('beforeend', slice.map((t, k) => songRow(t, t._idx, plId, startIdx + k)).join(''));
    paintCovers(b);
    offset += slice.length;
    if (offset < list.length && performance.now() >= deadline) {
      if ('scheduler' in window && 'yield' in window.scheduler) {
        await window.scheduler.yield();
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      deadline = performance.now() + 50;
    }
  }
}

function updateListBody() {
  const box = document.getElementById('listBody');
  if (!box) { render(); return; }
  box.innerHTML = renderListRowsHtml();
  document.querySelectorAll('.sort-pill[data-sort]').forEach((el) => {
    el.classList.toggle('on', el.dataset.sort === S.listSort);
  });
  paintCovers(box);
  mountSongRowsChunked();
}

function viewLocal() {
  const list = S.tracks;
  const hero = heroCardHtml({
    title: '本地音乐',
    sub: `共 ${list.length} 首${totalDurStr(list)}`,
    firstTrack: list[0],
    actsHtml: `
      <button class="hero-btn pri" data-list-playall="1"><svg viewBox="0 0 24 24"><path d="M8 5.6v12.8a.9.9 0 0 0 1.38.77l10-6.4a.9.9 0 0 0 0-1.54l-10-6.4A.9.9 0 0 0 8 5.6z"/></svg>播放全部</button>
      <button class="hero-btn" data-list-shuffle="1">随机播放</button>
      <button class="hero-btn" data-rescan="1">刷新扫描</button>
      <button class="hero-btn" data-go="settings">⚙ 目录与设置</button>`,
  });
  if (!list.length) {
    return backBar('本地音乐') + hero +
      `<div class="empty"><div class="big">还没有歌曲</div><div>点「刷新扫描」或去「设置」查看下载目录与存储权限</div></div>`;
  }
  return backBar('本地音乐') + hero + listToolbarHtml() + `<div id="listBody">${renderListRowsHtml()}</div>`;
}

function viewRecent() {
  const list = recentTracks();
  if (!list.length) return backBar('最近播放') + '<div class="empty"><div class="big">还没有播放记录</div><div>听过的歌会出现在这里</div></div>';
  const hero = heroCardHtml({
    title: '最近播放',
    sub: `最近 ${list.length} 首${totalDurStr(list)}`,
    firstTrack: list[0],
    actsHtml: `
      <button class="hero-btn pri" data-list-playall="1"><svg viewBox="0 0 24 24"><path d="M8 5.6v12.8a.9.9 0 0 0 1.38.77l10-6.4a.9.9 0 0 0 0-1.54l-10-6.4A.9.9 0 0 0 8 5.6z"/></svg>播放全部</button>
      <button class="hero-btn" data-list-shuffle="1">随机播放</button>`,
  });
  return backBar('最近播放') + hero + listToolbarHtml() + `<div id="listBody">${renderListRowsHtml()}</div>`;
}

function viewLiked() {
  const list = favTracks();
  if (!list.length) return backBar('我喜欢的音乐') + `<div class="empty"><div class="big">还没有喜欢的歌</div><div>在歌曲右侧点心形收藏</div></div>`;
  const hero = heroCardHtml({
    title: '我喜欢的音乐',
    sub: `共 ${list.length} 首${totalDurStr(list)}`,
    firstTrack: list[0],
    actsHtml: `
      <button class="hero-btn pri" data-list-playall="1"><svg viewBox="0 0 24 24"><path d="M8 5.6v12.8a.9.9 0 0 0 1.38.77l10-6.4a.9.9 0 0 0 0-1.54l-10-6.4A.9.9 0 0 0 8 5.6z"/></svg>播放全部</button>
      <button class="hero-btn" data-list-shuffle="1">随机播放</button>`,
  });
  return backBar('我喜欢的音乐') + hero + listToolbarHtml() + `<div id="listBody">${renderListRowsHtml()}</div>`;
}

function viewPlaylists() {
  const rows = S.playlists.map((p) => {
    const firstT = p.tracks.map(trackByPath).find(Boolean);
    const covIdx = firstT ? S.tracks.indexOf(firstT) : -1;
    return `<div class="row" data-pl="${esc(p.id)}">
      <div class="row-cover" ${covIdx >= 0 ? `data-cover="${covIdx}"` : ''}></div>
      <div class="row-main"><div class="row-title">${esc(p.name)}</div>
      <div class="row-sub">${p.tracks.length} 首</div></div>
      <button class="row-act del" data-pldel="${esc(p.id)}" aria-label="删除歌单">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V4.8h5V7M6.2 7l.9 12.4a1 1 0 0 0 1 .9h7.8a1 1 0 0 0 1-.9L17.8 7"/><path d="M10.2 11v6M13.8 11v6"/></svg>
      </button>
    </div>`;
  }).join('');
  return backBar('歌单') +
    `<button class="quick-item" id="newPl" style="width:100%;display:flex;align-items:center;gap:10px;margin-bottom:12px">
       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" style="width:18px;height:18px"><path d="M12 5v14M5 12h14"/></svg>
       <span style="font-size:13.5px;font-weight:600">新建歌单</span></button>
     ${rows || `<div class="empty"><div class="big">还没有歌单</div><div>点上面「新建歌单」创建一个</div></div>`}`;
}

function viewPlaylist(id) {
  const p = S.playlists.find((x) => x.id === id);
  if (!p) return backBar('歌单') + `<div class="empty">歌单不存在</div>`;
  const list = p.tracks.map(trackByPath).filter(Boolean);
  const hero = heroCardHtml({
    title: p.name,
    sub: `共 ${list.length} 首${totalDurStr(list)}`,
    firstTrack: list[0],
    actsHtml: `
      <button class="hero-btn pri" data-plplay="${esc(p.id)}"><svg viewBox="0 0 24 24"><path d="M8 5.6v12.8a.9.9 0 0 0 1.38.77l10-6.4a.9.9 0 0 0 0-1.54l-10-6.4A.9.9 0 0 0 8 5.6z"/></svg>播放全部</button>
      <button class="hero-btn" data-plshuffle="${esc(p.id)}">随机</button>
      <button class="hero-btn" data-plrename="${esc(p.id)}">重命名</button>
      <button class="hero-btn danger" data-pldel="${esc(p.id)}">删除歌单</button>`,
  });
  return backBar(p.name) + hero +
    (list.length
      ? listToolbarHtml() + `<div id="listBody">${renderListRowsHtml()}</div>`
      : '<div class="empty"><div class="big">歌单还是空的</div><div>在歌曲行点「＋」就能加进来</div></div>');
}

function viewMe() {
  return `
    <div class="me-head">
      <div class="me-avatar">M</div>
      <div style="flex:1;min-width:0">
        <div class="me-name">本地音乐库</div>
        <div class="me-sub">${S.tracks.length} 首 · 我喜欢 ${S.favs.size} 首 · ${S.playlists.length} 个歌单</div>
        <div class="me-sub" style="opacity:.6;font-size:11px">曲库 ${esc((function(){try{return A.rootDir? A.rootDir() : ''}catch(e){return ''}})())}</div>
        <div class="me-sub" style="opacity:.55;font-size:11px">build ${
          (function(){ try { return (window.Android && window.Android.buildTag) ? window.Android.buildTag() : 'web-preview'; } catch(e){ return '?'; } })()
        }</div>
      </div>
    </div>
    <div class="entry" style="cursor:default">
      <div class="entry-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2"/></svg></div>
      <div class="entry-main"><div class="entry-title">外观主题</div><div class="entry-sub">浅色 / 深色 / 跟随系统</div></div>
      <div class="theme-seg">
        <button data-theme-set="light" class="${S.theme === 'light' ? 'on' : ''}">浅色</button>
        <button data-theme-set="dark" class="${S.theme === 'dark' ? 'on' : ''}">深色</button>
        <button data-theme-set="auto" class="${S.theme === 'auto' ? 'on' : ''}">跟随</button>
      </div>
    </div>
    <div class="entry" data-go="local">
      <div class="entry-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2.2"/><path d="M7.5 5v5.5h9V5"/><path d="M7.5 14.5h9"/></svg></div>
      <div class="entry-main"><div class="entry-title">本地音乐</div><div class="entry-sub">${S.tracks.length} 首歌曲</div></div>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
    </div>
    <div class="entry" data-go="liked">
      <div class="entry-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7.2-4.4-7.2-9.4A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.2 3C19.2 15.6 12 20 12 20z"/></svg></div>
      <div class="entry-main"><div class="entry-title">我喜欢的音乐</div><div class="entry-sub">${S.favs.size} 首</div></div>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
    </div>
    <div class="entry" data-go="recent">
      <div class="entry-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 7.6V12l3 1.8"/></svg></div>
      <div class="entry-main"><div class="entry-title">最近播放</div><div class="entry-sub">最多 30 首</div></div>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
    </div>
    <div class="entry" data-go="import">
      <div class="entry-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10"/><path d="M8 10l4 4 4-4"/><path d="M5 18h14"/></svg></div>
      <div class="entry-main"><div class="entry-title">批量导入</div><div class="entry-sub">粘贴分享链接批量下载</div></div>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
    </div>
    <div class="entry" data-go="playlists">
      <div class="entry-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h11M4 12h11M4 17h7"/><circle cx="17.5" cy="16" r="2.5"/><path d="M20 16V8l-3 1"/></svg></div>
      <div class="entry-main"><div class="entry-title">歌单</div><div class="entry-sub">${S.playlists.length} 个</div></div>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
    </div>
    <div class="entry" data-go="settings">
      <div class="entry-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></div>
      <div class="entry-main"><div class="entry-title">设置</div><div class="entry-sub">下载目录 · 音量平衡 · 随机策略 · 歌词字号与配色 · 曲库体检</div></div>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
    </div>`;
}

function backBar(title) {
  return `<div style="display:flex;align-items:center;gap:8px;margin:0 0 14px">
    <button id="goBack" style="width:34px;height:34px;display:grid;place-items:center;color:var(--text-2)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:21px;height:21px"><path d="M15 5l-7 7 7 7"/></svg>
    </button><div class="h1" style="font-size:18px">${esc(title)}</div></div>`;
}
