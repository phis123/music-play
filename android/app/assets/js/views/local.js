/*
 * views/local.js — 本地/最近/喜欢/歌单/个人中心视图与通用组件（v2 重构）。
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
  const qNextBtn = `<button class="row-act" data-qnext="${idx}" aria-label="下一首播放" title="下一首播放">${ico('qnext')}</button>`;
  const acts = plId
    ? `${qNextBtn}<button class="row-act" data-plrm="${esc(plId)}" data-path="${esc(t.path)}" aria-label="移出歌单">${ico('plrm')}</button>`
    : `${qNextBtn}<button class="row-act" data-pladd="${idx}" aria-label="加入歌单">${ico('pladd')}</button><button class="row-act del" data-del="${idx}" aria-label="删除">${ico('del')}</button>`;
  return `<div class="row${isCur ? ' playing' : ''}${deferCls}" data-song="${idx}" data-path="${esc(t.path)}">
    <div class="row-cover" data-cover="${idx}"></div>
    <div class="row-main">
      <div class="row-title"><span class="row-eq-slot">${eq}</span><span class="row-title-txt">${esc(t.title || '未知标题')}</span>${kb}</div>
      <div class="row-sub">${esc(t.artist || '未知艺人')} · ${fmt(t.duration)}${t.hasLrc ? ' · 双语词' : ''}</div>
    </div>
    <div class="row-actions">
      <button class="row-act ${on ? 'on' : ''}" data-fav="${idx}" aria-label="喜欢"><svg class="ico" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}"><use href="#ico-heart"/></svg></button>
      ${acts}
    </div>
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
  if (st === 'title') out.sort((a, b) => cmpZh(a.title || '', b.title || ''));
  else if (st === 'artist') out.sort((a, b) => cmpZh(a.artist || '', b.artist || ''));
  else if (st === 'duration') out.sort((a, b) => (+(b.duration || 0)) - (+(a.duration || 0)));
  else if (st === 'recent') out.sort((a, b) => (+(b.id || 0)) - (+(a.id || 0)));
  return out;
}

function heroCardHtml(opts) {
  const firstIdx = opts.firstTrack ? S.tracks.indexOf(opts.firstTrack) : -1;
  const covAttr = firstIdx >= 0 ? `data-cover="${firstIdx}"` : '';
  return `<div class="hero-card">
    <div class="hero-cover" ${covAttr}>
      ${firstIdx < 0 ? ico('disc', 'hero-fallback-ico') : ''}
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
      <span class="filter-ico">${ico('search', 'ico-xs')}</span>
      <input id="listFilterInput" type="search" placeholder="筛选歌曲 / 歌手…" value="${esc(S.listFilter)}">
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
  if (!shown.length) return '<div class="search-hint">没有符合筛选条件的歌曲</div>';
  const firstSlice = shown.slice(0, SONG_FIRST_CHUNK);
  return `<div class="list-2col" id="songGridBox">${firstSlice.map((t, k) => songRow(t, t._idx, plId, k)).join('')}</div>`;
}

async function mountSongRowsChunked() {
  const token = ++_songChunkToken;
  const list = _pendingSongList || [];
  const plId = _pendingSongPlId;
  if (list.length <= SONG_FIRST_CHUNK) return;
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
      if ('scheduler' in window && 'yield' in window.scheduler) await window.scheduler.yield();
      else await new Promise((resolve) => setTimeout(resolve, 0));
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
      <button class="hero-btn pri" data-list-playall="1">${ico('play', 'ico-xs')}<span>播放全部</span></button>
      <button class="hero-btn" data-list-shuffle="1">${ico('shuffle', 'ico-xs')}<span>随机播放</span></button>
      <button class="hero-btn" data-rescan="1">${ico('refresh', 'ico-xs')}<span>刷新扫描</span></button>
      <button class="hero-btn" data-go="settings">${ico('sliders', 'ico-xs')}<span>目录与设置</span></button>`,
  });
  if (!list.length) {
    return `<div class="page-shell">${backBar('本地音乐')}${hero}<div class="empty"><div class="big">还没有歌曲</div><div>点「刷新扫描」或前往「设置」查看下载目录与存储权限</div></div></div>`;
  }
  return `<div class="page-shell">${backBar('本地音乐')}${hero}${listToolbarHtml()}<div id="listBody">${renderListRowsHtml()}</div></div>`;
}

function viewRecent() {
  const list = recentTracks();
  if (!list.length) {
    return `<div class="page-shell">${backBar('最近播放')}<div class="empty"><div class="big">还没有播放记录</div><div>听过的歌会出现在这里</div></div></div>`;
  }
  const hero = heroCardHtml({
    title: '最近播放',
    sub: `最近 ${list.length} 首${totalDurStr(list)}`,
    firstTrack: list[0],
    actsHtml: `
      <button class="hero-btn pri" data-list-playall="1">${ico('play', 'ico-xs')}<span>播放全部</span></button>
      <button class="hero-btn" data-list-shuffle="1">${ico('shuffle', 'ico-xs')}<span>随机播放</span></button>`,
  });
  return `<div class="page-shell">${backBar('最近播放')}${hero}${listToolbarHtml()}<div id="listBody">${renderListRowsHtml()}</div></div>`;
}

function viewLiked() {
  const list = favTracks();
  if (!list.length) {
    return `<div class="page-shell">${backBar('我喜欢的音乐')}<div class="empty"><div class="big">还没有喜欢的歌</div><div>点击歌曲右侧心形即可收藏</div></div></div>`;
  }
  const hero = heroCardHtml({
    title: '我喜欢的音乐',
    sub: `共 ${list.length} 首${totalDurStr(list)}`,
    firstTrack: list[0],
    actsHtml: `
      <button class="hero-btn pri" data-list-playall="1">${ico('play', 'ico-xs')}<span>播放全部</span></button>
      <button class="hero-btn" data-list-shuffle="1">${ico('shuffle', 'ico-xs')}<span>随机播放</span></button>`,
  });
  return `<div class="page-shell">${backBar('我喜欢的音乐')}${hero}${listToolbarHtml()}<div id="listBody">${renderListRowsHtml()}</div></div>`;
}

function viewPlaylists() {
  const rows = S.playlists.map((p) => {
    const firstT = p.tracks.map(trackByPath).find(Boolean);
    const covIdx = firstT ? S.tracks.indexOf(firstT) : -1;
    return `<div class="row" data-pl="${esc(p.id)}">
      <div class="row-cover" ${covIdx >= 0 ? `data-cover="${covIdx}"` : ''}></div>
      <div class="row-main">
        <div class="row-title"><span class="row-title-txt">${esc(p.name)}</span></div>
        <div class="row-sub">${p.tracks.length} 首歌曲</div>
      </div>
      <div class="row-actions">
        <button class="row-act del" data-pldel="${esc(p.id)}" aria-label="删除歌单">${ico('del')}</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="page-shell">${backBar('歌单')}
    <button class="new-pl-btn" id="newPl" type="button">
      <span class="new-pl-ico">${ico('pladd', 'ico-sm')}</span>
      <span class="new-pl-text">新建歌单</span>
    </button>
    ${rows ? `<div class="list-2col">${rows}</div>` : '<div class="empty"><div class="big">还没有歌单</div><div>点击上方「新建歌单」创建一个</div></div>'}
  </div>`;
}

function viewPlaylist(id) {
  const p = S.playlists.find((x) => x.id === id);
  if (!p) return `<div class="page-shell">${backBar('歌单')}<div class="empty">歌单不存在</div></div>`;
  const list = p.tracks.map(trackByPath).filter(Boolean);
  const hero = heroCardHtml({
    title: p.name,
    sub: `共 ${list.length} 首${totalDurStr(list)}`,
    firstTrack: list[0],
    actsHtml: `
      <button class="hero-btn pri" data-plplay="${esc(p.id)}">${ico('play', 'ico-xs')}<span>播放全部</span></button>
      <button class="hero-btn" data-plshuffle="${esc(p.id)}">${ico('shuffle', 'ico-xs')}<span>随机</span></button>
      <button class="hero-btn" data-plrename="${esc(p.id)}"><span>重命名</span></button>
      <button class="hero-btn danger" data-pldel="${esc(p.id)}">${ico('del', 'ico-xs')}<span>删除歌单</span></button>`,
  });
  return `<div class="page-shell">${backBar(p.name)}${hero}${
    list.length
      ? listToolbarHtml() + `<div id="listBody">${renderListRowsHtml()}</div>`
      : '<div class="empty"><div class="big">歌单还是空的</div><div>在歌曲行点击「＋」即可加入</div></div>'
  }</div>`;
}

function viewMe() {
  const rootPath = (function () { try { return A && A.rootDir ? A.rootDir() : ''; } catch (e) { return ''; } })();
  const bTag = (function () { try { return (window.Android && window.Android.buildTag) ? window.Android.buildTag() : 'web-preview'; } catch (e) { return '?'; } })();
  return `<div class="page-shell">
    <div class="me-card">
      <div class="me-avatar">${ico('disc')}</div>
      <div class="me-info">
        <div class="me-name">本地音乐库</div>
        <div class="me-sub">${S.tracks.length} 首歌曲 · 喜欢 ${S.favs.size} 首 · ${S.playlists.length} 个歌单</div>
        <div class="me-meta">${esc(rootPath)} · ${esc(bTag)}</div>
      </div>
    </div>

    <div class="entry-group">
      <div class="entry entry-static">
        <div class="entry-ico tone-amber">${ico('sun')}</div>
        <div class="entry-main">
          <div class="entry-title">外观主题</div>
          <div class="entry-sub">浅色 / 深色 / 跟随系统</div>
        </div>
        <div class="theme-seg">
          <button data-theme-set="light" class="${S.theme === 'light' ? 'on' : ''}">浅色</button>
          <button data-theme-set="dark" class="${S.theme === 'dark' ? 'on' : ''}">深色</button>
          <button data-theme-set="auto" class="${S.theme === 'auto' ? 'on' : ''}">跟随</button>
        </div>
      </div>
    </div>

    <div class="entry-group">
      <div class="entry" data-go="local">
        <div class="entry-ico tone-red">${ico('disc')}</div>
        <div class="entry-main"><div class="entry-title">本地音乐</div><div class="entry-sub">${S.tracks.length} 首歌曲</div></div>
        <span class="chev">${ico('chev-right', 'ico-sm')}</span>
      </div>
      <div class="entry" data-go="liked">
        <div class="entry-ico tone-red">${ico('heart', '', 'none')}</div>
        <div class="entry-main"><div class="entry-title">我喜欢的音乐</div><div class="entry-sub">${S.favs.size} 首</div></div>
        <span class="chev">${ico('chev-right', 'ico-sm')}</span>
      </div>
      <div class="entry" data-go="recent">
        <div class="entry-ico tone-blue">${ico('clock')}</div>
        <div class="entry-main"><div class="entry-title">最近播放</div><div class="entry-sub">最多保留 30 首</div></div>
        <span class="chev">${ico('chev-right', 'ico-sm')}</span>
      </div>
      <div class="entry" data-go="playlists">
        <div class="entry-ico tone-green">${ico('playlist')}</div>
        <div class="entry-main"><div class="entry-title">歌单</div><div class="entry-sub">${S.playlists.length} 个自建歌单</div></div>
        <span class="chev">${ico('chev-right', 'ico-sm')}</span>
      </div>
    </div>

    <div class="entry-group">
      <div class="entry" data-go="import">
        <div class="entry-ico tone-blue">${ico('download')}</div>
        <div class="entry-main"><div class="entry-title">批量导入</div><div class="entry-sub">粘贴歌单分享链接批量匹配下载</div></div>
        <span class="chev">${ico('chev-right', 'ico-sm')}</span>
      </div>
      <div class="entry" data-go="settings">
        <div class="entry-ico tone-slate">${ico('settings')}</div>
        <div class="entry-main"><div class="entry-title">设置</div><div class="entry-sub">曲库目录 · 音量平衡 · 随机策略 · 歌词配色 · 体检诊断</div></div>
        <span class="chev">${ico('chev-right', 'ico-sm')}</span>
      </div>
    </div>
  </div>`;
}

function backBar(title) {
  return `<div class="page-bar">
    <button id="goBack" class="back-btn" type="button" aria-label="返回">${ico('back')}</button>
    <h1 class="page-bar-title">${esc(title)}</h1>
  </div>`;
}
