/* music-play 安卓端 · 拆分中（剩余未迁移代码） */
'use strict';
window.MP = window.MP || {};

function applyLyricsStyle() {
  document.documentElement.style.setProperty('--lrc-size', (S.lrcSize || 18) + 'px');
  document.documentElement.style.setProperty('--lrc-accent', S.lrcColor || '#ec4141');
  try {
    localStorage.setItem('mob:lrcSize', String(S.lrcSize || 18));
    localStorage.setItem('mob:lrcColor', S.lrcColor || '#ec4141');
  } catch (e) { }
}

let _overlayStyleTimer = null;

function pushOverlayStyle(immediate) {
  const applyNow = () => {
    try {
      localStorage.setItem('mob:floatColor', S.floatColor);
      localStorage.setItem('mob:floatSizeSp', String(S.floatSizeSp));
      localStorage.setItem('mob:floatBgOpacity', String(S.floatBgOpacity));
      if (A && typeof A.overlaySetStyle === 'function') {
        const sz = Math.max(12, Math.min(30, Math.round(+S.floatSizeSp || 18)));
        const alpha = Math.max(0, Math.min(220, Math.round(((+S.floatBgOpacity || 0) / 100) * 255)));
        A.overlaySetStyle(String(S.floatColor || '#ffffff'), sz, alpha);
      } else if (A && typeof A.overlayColor === 'function') {
        A.overlayColor(String(S.floatColor || '#ffffff'));
      }
    } catch (e) { }
  };
  if (immediate !== false) {
    clearTimeout(_overlayStyleTimer);
    applyNow();
  } else {
    clearTimeout(_overlayStyleTimer);
    _overlayStyleTimer = setTimeout(applyNow, 45);
  }
}

/* ---------------- 视图 ---------------- */
function homeBodyHtml() {
  const q = S.q.trim().toLowerCase();
  if (q) {
    const hits = S.tracks.filter((t) => matchTrack(t, S.q));
    const on = S.online;
    const onlineBody = on.loading
      ? '<div class="search-hint">正在搜索在线歌曲…</div>'
      : on.err
        ? `<div class="search-hint err">${esc(on.err)}</div>`
        : on.songs.length
          ? on.songs.map(onlineRow).join('')
          : '<div class="search-hint">按回车或点「搜在线」查找网易云曲库</div>';
    return `
      <div class="section" style="margin-top:4px">
        <div class="section-title">本地匹配</div>
        <div class="section-more">${hits.length} 首</div>
      </div>
      ${hits.length ? hits.map((t) => songRow(t, S.tracks.indexOf(t))).join('')
                    : '<div class="search-hint">本地没有匹配（原名/译名/别名都能搜）</div>'}
      <div class="section">
        <div class="section-title">在线结果</div>
        <div class="section-more">${on.songs.length ? on.songs.length + ' 首' : ''}</div>
      </div>
      ${onlineBody}`;
  }

  const hist = getSearchHist();
  const histBar = hist.length
    ? `<div class="search-hist">
        <span class="search-hist-label">最近搜索：</span>
        ${hist.map((h) => `<button class="search-pill" data-qhist="${esc(h)}">${esc(h)}</button>`).join('')}
        <button class="search-hist-clear" data-qhist-clear="1">清空</button>
      </div>`
    : '';
  const recent = [...S.tracks].sort((a, b) => b.id - a.id).slice(0, 12);
  return `
    ${histBar}
    <div class="h1">音乐</div>
    <div class="sub">本地 ${S.tracks.length} 首 · 喜欢 ${S.favs.size} 首</div>

    <div class="section">
      <div class="section-title">最近添加</div>
      <div class="section-more">${recent.length} 首</div>
    </div>
    <div class="hscroll">${recent.map(cardHtml).join('')}</div>

    <div class="section"><div class="section-title">我的音乐</div></div>
    <div class="circles">
      <button class="circle" data-go="local">
        <span class="circle-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="2.2"/><path d="M7.5 5v5.5h9V5"/><path d="M7.5 14.5h9"/></svg></span>
        <span class="circle-name">本地音乐</span>
      </button>
      <button class="circle" data-go="liked">
        <span class="circle-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20s-7.2-4.4-7.2-9.4A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.2 3C19.2 15.6 12 20 12 20z"/></svg></span>
        <span class="circle-name">我喜欢的音乐</span>
      </button>
      <button class="circle" data-go="playlists">
        <span class="circle-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h11M4 12h11M4 17h7"/><circle cx="17.5" cy="16" r="2.5"/><path d="M20 16V8l-3 1"/></svg></span>
        <span class="circle-name">歌单</span>
      </button>
    </div>

    <div class="section">
      <div class="section-title">全部歌曲</div>
      <span style="display:flex;gap:8px">
        <button class="playall" data-shuffle-all>
          <svg viewBox="0 0 24 24"><path d="M17 3.6l3.4 3.4-3.4 3.4V8.3h-1.7c-1.2 0-2 .5-2.8 1.6l-.9 1.2-1.2-1.6.7-1C12.3 6.7 13.6 6 15.3 6H17V3.6zM3 6h2.3c1.7 0 3 .7 4.2 2.2l5.1 6.9c.8 1.1 1.6 1.6 2.8 1.6H20v-2.1l3.4 3.4L20 21.4v-2.7h-2.6c-1.7 0-3-.7-4.2-2.2L8.1 9.6C7.3 8.5 6.5 8 5.3 8H3V6zm0 10h2.3c.5 0 .9-.1 1.3-.3l1.3 1.7c-.8.4-1.7.6-2.6.6H3v-2z"/></svg>随机
        </button>
        <button class="playall" data-playall>
          <svg viewBox="0 0 24 24"><path d="M8 5.6v12.8a.9.9 0 0 0 1.38.77l10-6.4a.9.9 0 0 0 0-1.54l-10-6.4A.9.9 0 0 0 8 5.6z"/></svg>播放全部
        </button>
      </span>
    </div>
    ${S.tracks.slice(0, 30).map((t, i) => songRow(t, i)).join('')}`;
}

function viewHome() {
  return `${searchBar()}<div id="homeBody">${homeBodyHtml()}</div>`;
}

function updateHomeBody() {
  const hb = document.getElementById('homeBody');
  const qc = document.getElementById('qClear');
  if (qc) qc.style.display = S.q ? 'inline-flex' : 'none';
  if (hb) {
    hb.innerHTML = homeBodyHtml();
    paintCovers();
  } else {
    render();
  }
}

/** 横向卡片 */

/** 横向卡片 */
function cardHtml(t) {
  const idx = S.tracks.indexOf(t);
  return `<button class="card" data-song="${idx}">
    <div class="card-cover" data-cover="${idx}"></div>
    <div class="card-title">${esc(t.title || '未知标题')}</div>
    <div class="card-sub">${esc(t.artist || '未知艺人')}</div>
  </button>`;
}

/** 在线歌曲行 */

/** 在线歌曲行 */
function onlineRow(sg) {
  return `<div class="row" data-osong="${sg.id}">
    <div class="row-cover" style="background-image:url('${esc(sg.cover || '')}')"></div>
    <div class="row-main">
      <div class="row-title">${esc(sg.name)}</div>
      <div class="row-sub">${esc(sg.artist || '未知艺人')} · ${fmt(sg.duration)}</div>
    </div>
    <span class="tag-online">在线</span>
  </div>`;
}

/** 声音候选行 */

/** 声音候选行 */
function voiceRow(v, i) {
  const busy = S.voices.busy[v.mainTrackId];
  return `<div class="row">
    <div class="row-cover" style="background-image:url('${esc(v.cover || '')}')"></div>
    <div class="row-main">
      <div class="row-title">${esc(v.title || '未命名声音')}</div>
      <div class="row-sub">${esc(v.radio || '未知电台')} · ${fmt(v.duration)}</div>
    </div>
    <button class="pv-btn" data-pv="${i}" aria-label="试听">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.6v12.8a.9.9 0 0 0 1.38.77l10-6.4a.9.9 0 0 0 0-1.54l-10-6.4A.9.9 0 0 0 8 5.6z"/></svg>
    </button>
    <button class="dl-btn" data-dl="${i}" ${busy ? 'disabled' : ''}>${busy || '下载'}</button>
  </div>`;
}

/** 声音候选没有 artist 字段：dj / radio 才是可读的来源名 */

/** 声音候选没有 artist 字段：dj / radio 才是可读的来源名 */
function voiceArtist(v) {
  if (!v) return '在线试听';
  return v.dj || v.radio || '在线试听';
}

function viewVoices() {
  const v = S.voices;
  const head = v.song
    ? `<div class="section" style="margin-top:4px">
         <div class="section-title">${esc(v.song.name)}</div>
         <div class="section-more">${v.song.artist || ''}</div>
       </div>`
    : '';
  const body = v.loading
    ? '<div class="search-hint">正在匹配播客声音…</div>'
    : v.err ? `<div class="search-hint err">${esc(v.err)}</div>`
    : v.list.length ? v.list.map(voiceRow).join('')
    : '<div class="empty"><div class="big">没有找到声音</div><div>换个歌试试</div></div>';
  return backBar('匹配声音') + head + body +
    '<div class="search-hint" style="margin-top:14px">共 ' + v.list.length + ' 个可下载声音</div>';
}

function searchBar() {
  return `<div class="searchbar">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="6.4"/><path d="M16 16l4.5 4.5"/></svg>
    <input id="q" type="search" placeholder="搜索本地歌曲 / 歌手 / 译名" value="${esc(S.q)}">
    <button class="q-clear" id="qClear" type="button" aria-label="清空搜索" style="display:${S.q ? 'inline-flex' : 'none'}">×</button>
    <button class="q-go" id="qGo" type="button">搜在线</button>
  </div>`;
}

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

function viewSettings() {
  const curRoot = (function () { try { return (A && A.rootDir) ? A.rootDir() : '/storage/emulated/0/Music/music-play'; } catch (e) { return '/storage/emulated/0/Music/music-play'; } })();
  const gainMapCount = Object.keys(getTrackGainMap()).length;
  const playCountsCount = Object.keys(getPlayCounts()).length;
  const lrcColors = [
    ['#ec4141', '网易红'],
    ['#4da3ff', '极光蓝'],
    ['#10b981', '翡翠绿'],
    ['#f59e0b', '琥珀金'],
    ['#a855f7', '霓虹紫'],
    ['#ffffff', '高对比白'],
  ];
  return backBar('设置') + `<div class="set-wrap">
    <div class="set-card">
      <div>
        <div class="set-card-title">📁 曲库与下载目录</div>
        <div class="set-card-desc">调整在线下载与批量导入保存的目标目录，并检测存储读写权限</div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">当前目录（已扫 ${S.tracks.length} 首）</div>
          <div class="set-row-sub">${esc(curRoot)}</div>
        </div>
        <div class="set-row-ctrl">
          <button class="hero-btn pri" data-set-dir="picker">📁 调整目录</button>
          <button class="hero-btn" data-rescan="1">🔄 重新扫描</button>
          <button class="hero-btn" data-storage="1">${storageOK() ? '✓ 存储权限正常' : '⚠ 开启存储权限'}</button>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div>
        <div class="set-card-title">♪ 音量平衡（Loudness Normalization）</div>
        <div class="set-card-desc">基于 MP3 帧增益分析 + 原生 LoudnessEnhancer 动态均衡，自动消除不同音源声音忽大忽小问题</div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">全局自动音量平衡</div>
          <div class="set-row-sub">开启后自动衰减过响音源、放大偏轻音源（可在播放页「⚙ 播放设置」对单首歌独立调整）</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-norm="1" class="${S.normEnabled ? 'on' : ''}">开启</button>
            <button data-set-norm="0" class="${!S.normEnabled ? 'on' : ''}">关闭</button>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">目标响度模式</div>
          <div class="set-row-sub">标准模式对齐流媒体 (-14 LUFS)；夜间模式更轻柔护耳；增强模式适合偏轻播客音源</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-preset="standard" class="${S.normPreset === 'standard' ? 'on' : ''}">标准 (-14)</button>
            <button data-set-preset="night" class="${S.normPreset === 'night' ? 'on' : ''}">轻柔夜间 (-17)</button>
            <button data-set-preset="boost" class="${S.normPreset === 'boost' ? 'on' : ''}">人声增强 (-12)</button>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">单曲独立微调记录</div>
          <div class="set-row-sub">已为 ${gainMapCount} 首歌单独保存了音量微调偏移</div>
        </div>
        <div class="set-row-ctrl">
          <button class="hero-btn" data-set-cleargains="1" ${gainMapCount ? '' : 'disabled'}>清空单曲微调</button>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div>
        <div class="set-card-title">🔀 随机播放策略</div>
        <div class="set-card-desc">选择切换至「随机播放」时的下一首抽选算法</div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">随机抽选模式</div>
          <div class="set-row-sub">${
            S.randomStrategy === 'no-repeat'
              ? '不重复随机：整轮队列全部听完一遍前绝不重复抽中同一首歌（推荐）'
              : S.randomStrategy === 'rare-first'
                ? '不常听优先：结合播放次数统计，优先随机抽选少听或未听过的歌曲'
                : '真随机：每次切歌完全独立随机抽取'
          }</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-rand="no-repeat" class="${S.randomStrategy === 'no-repeat' ? 'on' : ''}">不重复随机</button>
            <button data-set-rand="rare-first" class="${S.randomStrategy === 'rare-first' ? 'on' : ''}">不常听随机</button>
            <button data-set-rand="true-random" class="${S.randomStrategy === 'true-random' ? 'on' : ''}">真随机</button>
          </div>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div>
        <div class="set-card-title">🎨 歌词外观（字号大小与高亮颜色）</div>
        <div class="set-card-desc">调整播放页双语歌词字号与当前句高亮色彩</div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">歌词字号（当前 ${S.lrcSize}px）</div>
          <div class="set-row-sub">支持档位选择或滑块调节（14px ~ 28px）</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-lrcsz="15" class="${S.lrcSize === 15 ? 'on' : ''}">小</button>
            <button data-set-lrcsz="18" class="${S.lrcSize === 18 ? 'on' : ''}">标准</button>
            <button data-set-lrcsz="21" class="${S.lrcSize === 21 ? 'on' : ''}">大</button>
            <button data-set-lrcsz="24" class="${S.lrcSize === 24 ? 'on' : ''}">特大</button>
          </div>
          <input type="range" id="mobLrcSizeRange" min="14" max="28" step="1" value="${S.lrcSize}" style="width:120px;accent-color:var(--red)">
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">当前句高亮配色</div>
          <div class="set-row-sub">点选预设主题色或自定义颜色</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-swatches">
            ${lrcColors.map(([c, name]) => `<span class="set-swatch${S.lrcColor.toLowerCase() === c ? ' on' : ''}" data-set-lrccolor="${c}" title="${name}" style="background:${c}"></span>`).join('')}
          </div>
        </div>
      </div>
      <div class="set-preview-box">
        <div id="mobLrcPrevEn" style="font-size:${S.lrcSize + 2}px;color:${esc(S.lrcColor)};font-weight:800">Can we pretend we're not angels through a cable?</div>
        <div id="mobLrcPrevZh" style="font-size:${S.lrcSize - 1}px;color:${esc(S.lrcColor)};font-weight:650;margin-top:4px">我们能否假装自己不是隔着网线相望的天使？</div>
      </div>
    </div>

    <div class="set-card">
      <div>
        <div class="set-card-title">🛠 界面外观与非常用维护工具</div>
        <div class="set-card-desc">将低频工具集中收纳，保持主界面简洁清爽</div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">界面外观主题</div>
          <div class="set-row-sub">切换浅色、深色或跟随系统</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-theme-set="auto" class="${S.theme === 'auto' ? 'on' : ''}">跟随系统</button>
            <button data-theme-set="light" class="${S.theme === 'light' ? 'on' : ''}">浅色</button>
            <button data-theme-set="dark" class="${S.theme === 'dark' ? 'on' : ''}">深色</button>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">曲库体检与补齐工具</div>
          <div class="set-row-sub">已累计统计 ${playCountsCount} 首歌播放频次</div>
        </div>
        <div class="set-row-ctrl">
          <button class="hero-btn pri" data-go="health">🩺 打开曲库体检</button>
          <button class="hero-btn" data-enrich-now="1">✦ 补齐封面与歌词</button>
          <button class="hero-btn" data-set-clearstats="1">🧹 清空统计缓存</button>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div>
        <div class="set-card-title">🧾 诊断与日志导出</div>
        <div class="set-card-desc">遇到闪退、偶发无响应、机型适配异常时用这里：一键打包现场（日志 + 崩溃堆栈 + 设备/屏幕/WebView/权限快照 + 曲库摘要），无需连电脑、无需 root</div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">导出诊断包</div>
          <div class="set-row-sub" id="diagPathTip">${esc(S.diagLastPath ? ('上次导出：' + S.diagLastPath) : '导出后会在 App 外部目录生成 zip，路径会显示在这里')}</div>
        </div>
        <div class="set-row-ctrl">
          <button class="hero-btn pri" data-diag="export">📦 导出诊断包</button>
          <button class="hero-btn" data-diag="snapshot">👁 查看快照</button>
          <button class="hero-btn" data-diag="clear">🧹 清空本地日志</button>
        </div>
      </div>
    </div>
  </div>`;
}

function backBar(title) {
  return `<div style="display:flex;align-items:center;gap:8px;margin:0 0 14px">
    <button id="goBack" style="width:34px;height:34px;display:grid;place-items:center;color:var(--text-2)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:21px;height:21px"><path d="M15 5l-7 7 7 7"/></svg>
    </button><div class="h1" style="font-size:18px">${esc(title)}</div></div>`;
}

/* ---------------- 曲库体检视图 (Phase 3) ---------------- */
function analyzeLibraryHealth() {
  const byKey = new Map();
  const dupSet = new Set();
  const noLrc = [];
  const noMeta = [];
  const shortClips = [];

  for (const t of S.tracks) {
    const k = normName(t.title || '');
    if (k) {
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(t);
    }
    if (!t.hasLrc) noLrc.push(t);
    if (!t.artist || (!t.cover && !S.covers.get(t.path))) noMeta.push(t);
    const d = +(t.duration || 0);
    if (d > 0 && d < 25) shortClips.push(t);
  }
  const dups = [];
  for (const [, group] of byKey) {
    if (group.length > 1) {
      group.forEach((x) => { if (!dupSet.has(x.path)) { dupSet.add(x.path); dups.push(x); } });
    }
  }
  return { dups, noLrc, noMeta, shortClips };
}

function viewHealth() {
  const h = analyzeLibraryHealth();
  const tab = S.healthTab || 'dup';
  const cards = [
    ['dup', '疑似重复', h.dups.length],
    ['lrc', '缺少歌词', h.noLrc.length],
    ['meta', '缺歌手/封面', h.noMeta.length],
    ['short', '异常短音频(<25s)', h.shortClips.length],
  ];
  const curList = tab === 'dup' ? h.dups : tab === 'lrc' ? h.noLrc : tab === 'meta' ? h.noMeta : h.shortClips;
  _currentShownTracks = curList;
  _pendingSongList = curList;
  _pendingSongPlId = undefined;
  const firstSlice = curList.slice(0, SONG_FIRST_CHUNK);
  const descMap = {
    dup: '同名或高度相似的本地音频文件，可对比时长/码率后清理多余副本',
    lrc: '尚未匹配到本地 .lrc 歌词的曲目，可点右上角「一键补齐歌词与封面」',
    meta: '缺少歌手名或专辑封面的曲目，可一键联网自动补齐',
    short: '时长不足 25 秒的音频（可能是试听片段或损坏文件），可点播放后「换声源」重下',
  };
  return backBar('曲库体检') + `
    <div class="sub" style="margin:-6px 2px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <span>共扫描 ${S.tracks.length} 首本地音频</span>
      <span style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="hero-btn" id="healthRebuildTags" style="padding:5px 12px;font-size:12px">重建歌手/封面</button>
        <button class="hero-btn pri" id="healthFillMeta" style="padding:5px 12px;font-size:12px">一键补齐缺失歌词/封面</button>
      </span>
    </div>
    <div class="health-grid">
      ${cards.map(([k, lbl, cnt]) => `
        <div class="health-stat${tab === k ? ' on' : ''}" data-health-tab="${k}">
          <div class="health-stat-num">${cnt}</div>
          <div class="health-stat-label">${lbl}</div>
        </div>`).join('')}
    </div>
    <div class="sub" style="margin:0 2px 10px">${descMap[tab] || ''}</div>
    ${curList.length
      ? `<div class="list-2col" id="songGridBox">${firstSlice.map((t, k) => songRow(t, t._idx, undefined, k)).join('')}</div>`
      : `<div class="empty"><div class="big">太棒了，这一项没有发现问题</div><div>曲库状态非常健康</div></div>`}
  `;
}

/* ---------------- 渲染 ---------------- */
function render() {
  const v = $('#view');
  let html = '';
  const p = S.page;
  _pendingSongList = [];
  if (p.name === 'local') html = viewLocal();
  else if (p.name === 'liked') html = viewLiked();
  else if (p.name === 'recent') html = viewRecent();
  else if (p.name === 'voices') html = viewVoices();
  else if (p.name === 'import') html = viewImport();
  else if (p.name === 'health') html = viewHealth();
  else if (p.name === 'settings') html = viewSettings();
  else if (p.name === 'playlists') html = viewPlaylists();
  else if (p.name === 'playlist') html = viewPlaylist(p.arg);
  else if (S.tab === 'me') html = viewMe();
  else html = viewHome();

  v.innerHTML = html;
  v.scrollTop = 0;
  if (p.name === 'import') mountImportRowsChunked();
  if (_pendingSongList && _pendingSongList.length > SONG_FIRST_CHUNK) mountSongRowsChunked();
  paintCovers(v);
  syncTabs();
  paintShuffle();
  const si = document.getElementById('sheetInput');
  if (si && (S.sheet.kind === 'newpl' || S.sheet.kind === 'renamepl')) { try { si.focus(); } catch (e) { } }
}

function paintCovers(rootEl) {
  const scope = rootEl || document;
  const io = ensureCoverObserver();
  scope.querySelectorAll('[data-cover]:not([data-cov-bound])').forEach((el) => {
    el.dataset.covBound = '1';
    const t = S.tracks[+el.dataset.cover];
    if (!t) return;
    if (S.covers.has(t.path)) {
      const url = S.covers.get(t.path);
      if (url) el.style.backgroundImage = `url("${url}")`;
      return;
    }
    if (io) {
      io.observe(el);
    } else {
      coverFor(t, el);
    }
  });
}

function syncTabs() {
  document.querySelectorAll('[data-tab]').forEach((el) => {
    // 只有停在「首页/个人」这一层时高亮；进入本地音乐等子页后不该还亮着
    el.classList.toggle('active', S.page.name === el.dataset.tab);
  });
  // 平板侧栏里的二级导航（本地音乐/我喜欢/最近/歌单/批量导入）高亮
  document.querySelectorAll('.rail-item[data-go]').forEach((el) => {
    el.classList.toggle('active', S.page.name === el.dataset.go);
  });
}

/* ---------------- 在线搜索 ---------------- */
let onlineTimer = null;

function scheduleOnlineSearch() {
  clearTimeout(onlineTimer);
  onlineTimer = setTimeout(doOnlineSearch, 450);
}

async function doOnlineSearch() {
  const kw = S.q.trim();
  if (!kw) { S.online = { q: '', loading: false, songs: [], err: '' }; updateHomeBody(); return; }
  pushSearchHist(kw);
  if (S.online.q === kw && !S.online.err && S.online.songs.length) { updateHomeBody(); return; }
  S.online = { q: kw, loading: true, songs: [], err: '' };
  updateHomeBody();
  try {
    if (!window.neta) throw new Error('离线模式');
    const songs = await window.neta.searchSongs(kw, 12);
    if (S.q.trim() !== kw) return;
    S.online = { q: kw, loading: false, songs: songs, err: '' };
  } catch (e) {
    S.online = { q: kw, loading: false, songs: [], err: '在线搜索失败：' + (e.message || e) };
  }
  updateHomeBody();
}

/* ---------------- 批量导入（防卡顿分片渲染 + 匹配进度条 + 错误收集 + 节流持久化） ---------------- */
const imp = {
  link: '', loading: false, matching: false, matchDone: 0, matchTotal: 0,
  name: '', items: [], err: '', busy: false, doneCount: 0, totalCount: 0,
  curPct: -1, open: -1, filter: 'all',
};

let _impSaveTimer = null;

function scheduleSaveImpState(immediate) {
  clearTimeout(_impSaveTimer);
  if (immediate) {
    saveImpState();
    return;
  }
  _impSaveTimer = setTimeout(saveImpState, 2200);
}

function saveImpState() {
  clearTimeout(_impSaveTimer);
  try {
    if (!imp.items.length && !imp.link) {
      localStorage.removeItem('imp:state');
      return;
    }
    const slimItems = imp.items.slice(0, 300).map((it, idx) => ({
      _idx: idx,
      song: it.song,
      voice: it.voice,
      cands: (it.cands || []).slice(0, 8),
      pick: it.pick || 0,
      skip: !!it.skip,
      done: !!it.done,
      manual: !!it.manual,
      suspect: it.suspect || null,
      suspectWhy: it.suspectWhy || '',
      err: it.err || '',
      gap: it.gap,
    }));
    localStorage.setItem('imp:state', JSON.stringify({
      link: imp.link || '',
      name: imp.name || '',
      items: slimItems,
    }));
  } catch (e) { }
}

function restoreImpState() {
  try {
    const raw = JSON.parse(localStorage.getItem('imp:state') || 'null');
    if (!raw || !Array.isArray(raw.items)) return;
    imp.link = raw.link || '';
    imp.name = raw.name || '';
    imp.items = raw.items.map((it, idx) => ({
      ...it,
      _idx: idx,
      running: false,
      prog: '',
    }));
  } catch (e) { }
}

function impStatusHtml(it, i) {
  const v = it.voice;
  const bad = !v && it.suspect;
  if (it.skip && it.err) return `<span class="imp-st warn" id="impprog-${i}" title="${esc(it.err)}">失败·${esc(it.err.slice(0, 10))}</span>`;
  if (it.skip) return `<span class="imp-st" id="impprog-${i}">已跳过</span>`;
  if (it.done) return `<span class="imp-st ok" id="impprog-${i}">已下载</span>`;
  if (it.redo) return `<span class="imp-st warn" id="impprog-${i}">时长不符·将重下</span>`;
  if (it.running) return `<span class="imp-st run" id="impprog-${i}">${esc(it.prog || '下载中')}</span>`;
  if (it.matching) return `<span class="imp-st run" id="impprog-${i}">匹配中…</span>`;
  if (v) return `<span class="imp-st" id="impprog-${i}">已匹配${it.gap != null && Math.abs(it.gap) > 5 ? ' ' + (it.gap > 0 ? '+' : '-') + fmt(Math.abs(it.gap)) : ''}</span>`;
  if (bad) return `<span class="imp-st warn" id="impprog-${i}">${esc(it.suspectWhy || '待确认')}</span>`;
  if (it.err) return `<span class="imp-st warn" id="impprog-${i}">${esc(it.err)}</span>`;
  return `<span class="imp-st warn" id="impprog-${i}">${imp.matching ? '待匹配' : '未找到'}</span>`;
}

function impSubText(it) {
  const v = it.voice;
  const bad = !v && it.suspect;
  if (v) return v.title + ' · ' + fmt(v.duration);
  if (bad) return '最像：' + (it.suspect.v.title || '') + ' · ' + fmt(it.suspect.v.duration) + (it.suspect.badKind === 'title' ? '（标题对不上）' : '，原曲 ' + fmt(it.song.duration));
  if (it.err) return '错误：' + it.err;
  return imp.matching && !it._matchedOnce ? '等待搜索匹配播客声源…' : '没有可用声音';
}

function importRow(it, i) {
  if (i == null) i = it._idx != null ? it._idx : imp.items.indexOf(it);
  const open = imp.open === i;
  const deferCls = i >= 24 && !open ? ' cv-defer' : '';
  const sub = impSubText(it);
  const row = `<div class="row${open ? ' open' : ''}${deferCls}" id="improw-${i}">
    <div class="row-cover" style="background-image:url('${esc(it.song.cover || '')}')"></div>
    <div class="row-main">
      <div class="row-title">${i + 1}. ${esc(it.song.name)}</div>
      <div class="row-sub" id="impsub-${i}">${esc(it.song.artist || '')} · ${fmt(it.song.duration)} · ${esc(sub)}</div>
    </div>
    <div class="imp-acts"><span id="impstwrap-${i}">${impStatusHtml(it, i)}</span>
      <button class="dl-btn" id="impswap-${i}" data-imp-swap="${i}" ${it.running || it.done ? 'disabled' : ''}>${open ? '收起' : '换'}</button>
      <button class="dl-btn ghost" id="impskip-${i}" data-imp-skip="${i}" ${it.done ? 'disabled' : ''}>${it.skip ? '恢复' : '跳过'}</button>
    </div>
  </div>`;
  return open ? row + candPanel(it, i) : row;
}

/** 局部更新单行 DOM（避免 600 首全量 innerHTML 重绘卡顿） */

/** 局部更新单行 DOM（避免 600 首全量 innerHTML 重绘卡顿） */
function updateSingleImpRow(i) {
  if (S.page.name !== 'import') return;
  const it = imp.items[i];
  if (!it) return;
  const stWrap = document.getElementById('impstwrap-' + i);
  if (stWrap) stWrap.innerHTML = impStatusHtml(it, i);
  const subEl = document.getElementById('impsub-' + i);
  if (subEl) subEl.textContent = `${it.song.artist || ''} · ${fmt(it.song.duration)} · ${impSubText(it)}`;
  const swBtn = document.getElementById('impswap-' + i);
  if (swBtn) swBtn.disabled = !!(it.running || it.done);
  const skBtn = document.getElementById('impskip-' + i);
  if (skBtn) {
    skBtn.disabled = !!it.done;
    skBtn.textContent = it.skip ? '恢复' : '跳过';
  }
  updateImpSummaryInPlace();
}

function updateImpSummaryInPlace() {
  if (S.page.name !== 'import') return;
  const total = imp.items.length;
  const usable = imp.items.filter((x) => !x.skip && !x.done && x.voice).length;
  const miss = imp.items.filter((x) => !x.done && (!x.voice || x.skip)).length;
  const doneCnt = imp.items.filter((x) => x.done).length;
  const hintEl = document.getElementById('impHintTxt');
  if (hintEl && imp.name) {
    hintEl.textContent = `${imp.name} · 共 ${total} 首 · 可下载 ${usable} · 已完成 ${doneCnt}${miss ? ' · 待确认/未匹配 ' + miss : ''}`;
  }
  const allBtn = document.getElementById('impAll');
  if (allBtn) {
    allBtn.textContent = `下载全部（${usable}）`;
    allBtn.style.display = (usable && !imp.busy) ? '' : 'none';
  }
}

/** 「换」展开的内联搜索与候选声源面板 */

/** 「换」展开的内联搜索与候选声源面板 */
function candPanel(it, i) {
  const list = it.cands || [];
  const fa = firstArtistClean(it.song.artist);
  const defKw = it.customKw || [it.song.name, fa].filter(Boolean).join(' ').trim();
  const cards = it.searching
    ? '<div class="imp-cands-empty">正在搜索匹配播客声源…</div>'
    : !list.length
      ? '<div class="imp-cands-empty">暂无候选声音，可修改上方关键词或点快捷按钮搜索</div>'
      : `<div class="imp-cands-scroll">` + list.map(function (v, k) {
          const s = scoreVoice(it.song, v);
          const sel = it.voice && String(it.voice.mainTrackId) === String(v.mainTrackId) && !it.skip;
          const gapTxt = s.gap == null ? '' : (Math.abs(s.gap) <= 3 ? ' · 时长一致' : ' · ' + (s.gap > 0 ? '+' : '-') + fmt(Math.abs(s.gap)));
          const on = imp.prevKey && String(imp.prevKey) === String(v.mainTrackId) && S.playing;
          const subTxt = [v.dj ? 'by ' + v.dj : '', v.radio || '未知电台'].filter(Boolean).join(' · ');
          return `<div class="imp-cand${sel ? ' sel' : ''}${s.bad ? ' bad' : ''}" role="button" tabindex="0" data-imp-pick="${i}" data-pick="${k}">
            <div class="imp-cand-cover" style="background-image:url('${esc(v.cover || '')}')">
              <button class="imp-cand-play${on ? ' on' : ''}" data-imp-play="${i}:${k}" aria-label="试听">${on ? '❚❚' : '▶'}</button>
            </div>
            <div class="imp-cand-title">${esc(v.title || '未命名声音')}</div>
            <div class="imp-cand-sub">${esc(subTxt)}</div>
            <div class="imp-cand-dur">${fmt(v.duration)}${gapTxt}</div>
          </div>`;
        }).join('') + `</div>`;
  return `<div class="imp-cands-box" data-panel="${i}">
    <div class="imp-inline-search">
      <input type="search" class="imp-inline-in" id="impkw-${i}" data-imp-kwin="${i}" value="${esc(defKw)}" placeholder="输入歌名/歌手搜索声音…">
      <button class="dl-btn" data-imp-kwgo="${i}" ${it.searching ? 'disabled' : ''}>${it.searching ? '搜索中' : '搜索'}</button>
    </div>
    <div class="imp-inline-chips">
      <button class="sort-pill" data-imp-kwpreset="${i}:name">仅搜歌名</button>
      ${fa ? `<button class="sort-pill" data-imp-kwpreset="${i}:both">歌名+歌手</button>` : ''}
      ${fa ? `<button class="sort-pill" data-imp-kwpreset="${i}:artist">仅搜歌手</button>` : ''}
      <button class="sort-pill" data-imp-kwpreset="${i}:smart">智能重搜</button>
      <span style="margin-left:auto;font-size:11px;color:var(--dim)">原曲 ${fmt(it.song.duration)}</span>
    </div>
    ${cards}
  </div>`;
}

/** 试听某条候选音源（局部刷新候选面板，不触发全表 render 掉帧） */

/** 试听某条候选音源（局部刷新候选面板，不触发全表 render 掉帧） */
async function previewCand(it, v) {
  const key = String(v.mainTrackId);
  const rowIdx = it._idx != null ? it._idx : imp.open;
  try {
    if (imp.prevKey === key) {
      if (S.playing) { A.pause(); S.playing = false; } else { A.resume(); S.playing = true; }
      paintPlayIcon();
      refreshOpenMobileImpPanel(rowIdx);
      return;
    }
    imp.prevKey = key;
    refreshOpenMobileImpPanel(rowIdx);
    toast('试听：' + (v.title || '未知声音'));
    const u = await window.neta.songUrl(v.mainTrackId);
    if (!u || !u.url) {
      imp.prevKey = null;
      refreshOpenMobileImpPanel(rowIdx);
      toast('这条音源拿不到试听地址');
      return;
    }
    if (A && typeof A.previewEx === 'function') A.previewEx(u.url, v.title || '试听', voiceArtist(v), v.cover || '');
    else A.preview(u.url, v.title || '试听', v.cover || '');
    let startedRow = true;
    try { if (A && typeof A.isPlaying === 'function') startedRow = !!A.isPlaying(); } catch (e2) { }
    diag('试听 row started=' + startedRow + ' title=' + (v.title || ''));
    if (startedRow) enterPreviewMode(v.title || '试听', voiceArtist(v), v.cover, v.duration);
    else { S.playing = false; paintPlayIcon(); toast('试听没能开始，音源可能已失效'); }
    refreshOpenMobileImpPanel(rowIdx);
  } catch (e) {
    imp.prevKey = null;
    refreshOpenMobileImpPanel(rowIdx);
    toast('试听失败：' + ((e && e.message) || e));
  }
}

/** 未匹配 / 时长不符的排最前面，其余保持原顺序 */

/** 未匹配 / 时长不符的排最前面，其余保持原顺序 */
function orderedImport() {
  const idx = new Map(imp.items.map(function (it, i) { return [it, i]; }));
  return imp.items.slice().sort(function (a, b) {
    const ra = a.voice ? 1 : 0, rb = b.voice ? 1 : 0;
    if (ra !== rb) return ra - rb;
    return idx.get(a) - idx.get(b);
  });
}

/** 按标题 + 时长自动挑一个；可疑的宁可不选 */

/** 按标题 + 时长自动挑一个；可疑的宁可不选 */
function applyBest(it) {
  if (it.manual) return;
  const r = pickVoice(it.song, it.cands);
  it.suspect = null;
  it.suspectWhy = '';
  it.voice = null;
  it.gap = null;
  if (r.best) { it.voice = r.best.v; it.gap = r.best.gap; return; }
  if (r.top && r.top.bad) {
    it.suspect = r.top;
    it.suspectWhy = r.top.badKind === 'title' ? '标题不符' : r.top.badKind === 'variant' ? '疑似非原曲' : '时长不符';
    it.gap = r.top.gap;
  }
}

function impQueueBar() {
  const t = imp.totalCount || 0, d = imp.doneCount || 0;
  const w = t ? Math.round(d * 100 / t) : 0;
  const cur = window.__impCurrent;
  const tail = cur ? ' · ' + cur.song.name + (cur.prog ? ' ' + cur.prog : '') : '';
  return `<div class="imp-q">
    <div class="imp-q-track"><div class="imp-q-bar" id="impqbar" style="width:${w}%"></div></div>
    <div class="imp-q-text" id="impqtext">已下载 ${d} / ${t}${tail}</div>
  </div>`;
}

function updImpBar() {
  const bar = document.getElementById('impqbar');
  const txt = document.getElementById('impqtext');
  const t = imp.totalCount || 0, d = imp.doneCount || 0;
  const cur = window.__impCurrent;
  const tail = cur ? ' · ' + cur.song.name + (cur.prog ? ' ' + cur.prog : '') : '';
  if (bar && t) bar.style.width = Math.round(d * 100 / t) + '%';
  if (txt) txt.textContent = '已下载 ' + d + ' / ' + t + tail;
}

function impMatchBar() {
  const t = imp.matchTotal || imp.items.length || 0;
  const d = imp.matchDone || 0;
  const w = t ? Math.round((d * 100) / t) : 0;
  return `<div class="imp-q" id="impmatchwrap">
    <div class="imp-q-track"><div class="imp-q-bar" id="impmbar" style="width:${w}%"></div></div>
    <div class="imp-q-text" id="impmtext">正在匹配播客声源 ${d} / ${t}…</div>
  </div>`;
}

function updImpMatchBar(subName) {
  const bar = document.getElementById('impmbar');
  const txt = document.getElementById('impmtext');
  const t = imp.matchTotal || imp.items.length || 0;
  const d = imp.matchDone || 0;
  if (bar && t) bar.style.width = Math.round((d * 100) / t) + '%';
  if (txt) txt.textContent = `正在匹配播客声源 ${d} / ${t}${subName ? ' · ' + subName : ''}`;
}

function filteredImportItems() {
  const f = imp.filter || 'all';
  if (f === 'suspect') return imp.items.filter((x) => !x.done && (!x.voice || x.skip));
  if (f === 'ready') return imp.items.filter((x) => !x.skip && !x.done && x.voice);
  if (f === 'done') return imp.items.filter((x) => x.done);
  if (f === 'err') return imp.items.filter((x) => x.err);
  // 默认保持原歌单顺序（避免匹配中行位置不断跳动与全表重排卡顿）
  return imp.items;
}

const IMP_FIRST_CHUNK = 35;

const IMP_NEXT_CHUNK = 45;

function viewImport() {
  const total = imp.items.length;
  const usable = imp.items.filter((x) => !x.skip && !x.done && x.voice).length;
  const miss = imp.items.filter((x) => !x.done && (!x.voice || x.skip)).length;
  const doneCnt = imp.items.filter((x) => x.done).length;
  const errCnt = imp.items.filter((x) => x.err).length;
  const list = filteredImportItems();
  const firstSlice = list.slice(0, IMP_FIRST_CHUNK);
  const body = imp.loading
    ? '<div class="imp-q"><div class="imp-q-track"><div class="imp-q-bar" style="width:45%"></div></div><div class="imp-q-text">正在解析歌单链接与曲目详情…</div></div>'
    : imp.err ? `<div class="search-hint err">${esc(imp.err)}</div>`
    : total ? `<div id="impListBox">${firstSlice.map((it) => importRow(it, it._idx)).join('')}</div>`
    : '<div class="search-hint">粘贴网易云歌单或单曲分享链接，自动匹配播客声源并下载</div>';
  const hint = imp.name
    ? `<div class="search-hint" id="impHintTxt" style="padding:8px 4px">${esc(imp.name)} · 共 ${total} 首 · 可下载 ${usable} · 已完成 ${doneCnt}${miss ? ' · 待确认/未匹配 ' + miss : ''}</div>`
    : '';
  const filters = total ? `<div class="imp-filter-bar">
      <button class="sort-pill${imp.filter === 'all' ? ' on' : ''}" data-imp-filter="all">全部 (${total})</button>
      <button class="sort-pill${imp.filter === 'suspect' ? ' on' : ''}" data-imp-filter="suspect">待确认 (${miss})</button>
      <button class="sort-pill${imp.filter === 'ready' ? ' on' : ''}" data-imp-filter="ready">可下载 (${usable})</button>
      <button class="sort-pill${imp.filter === 'done' ? ' on' : ''}" data-imp-filter="done">已下载 (${doneCnt})</button>
      ${errCnt ? `<button class="sort-pill${imp.filter === 'err' ? ' on' : ''}" data-imp-filter="err">异常 (${errCnt})</button>` : ''}
    </div>` : '';
  return backBar('批量导入') + `
    <div class="imp-bar">
      <input id="impLink" placeholder="https://music.163.com/playlist?id=..." value="${esc(imp.link)}">
      <button id="impGo" class="dl-btn" ${imp.loading ? 'disabled' : ''}>${total ? '重新解析' : '解析'}</button>
      ${total && !imp.busy && !imp.matching ? '<button id="impClear" class="dl-btn ghost">清空</button>' : ''}
    </div>
    ${hint}
    ${imp.matching ? impMatchBar() : ''}
    ${imp.busy ? impQueueBar() : ''}
    ${filters}
    <div style="text-align:center;margin:10px 0;display:flex;justify-content:center;gap:8px;flex-wrap:wrap">
      <button id="impAll" class="dl-btn" style="${usable && !imp.busy ? '' : 'display:none'}">下载全部（${usable}）</button>
      ${imp.matching ? '<button id="impMatchStop" class="dl-btn ghost">暂停声源匹配</button>' : ''}
      ${!imp.matching && miss > 0 && !imp.busy ? '<button id="impMatchResume" class="dl-btn ghost">继续匹配未完成项</button>' : ''}
      ${imp.busy ? '<button id="impStop" class="dl-btn ghost">停止下载</button>' : ''}
    </div>
    ${body}`;
}

/** 分片渐进挂载超长导入列表，保证切入「批量导入」首帧 < 5ms 不掉帧 */

/** 分片渐进挂载超长导入列表，保证切入「批量导入」首帧 < 5ms 不掉帧 */
function mountImportRowsChunked() {
  if (_impChunkRaf) { cancelAnimationFrame(_impChunkRaf); _impChunkRaf = 0; }
  const box = document.getElementById('impListBox');
  if (!box) return;
  const list = filteredImportItems();
  if (list.length <= IMP_FIRST_CHUNK) return;
  let offset = IMP_FIRST_CHUNK;
  const step = function () {
    if (S.page.name !== 'import') { _impChunkRaf = 0; return; }
    const b = document.getElementById('impListBox');
    if (!b) { _impChunkRaf = 0; return; }
    const slice = list.slice(offset, offset + IMP_NEXT_CHUNK);
    if (!slice.length) { _impChunkRaf = 0; return; }
    b.insertAdjacentHTML('beforeend', slice.map((it) => importRow(it, it._idx)).join(''));
    offset += slice.length;
    if (offset < list.length) {
      _impChunkRaf = requestAnimationFrame(step);
    } else {
      _impChunkRaf = 0;
    }
  };
  _impChunkRaf = requestAnimationFrame(step);
}

async function doImportParse() {
  const link = (document.getElementById('impLink') || {}).value || imp.link || '';
  const parsed = window.neta && window.neta.parseShareLink ? window.neta.parseShareLink(link) : null;
  window.__impMatchStop = true;
  imp.link = link; imp.items = []; imp.err = ''; imp.name = ''; imp.open = -1; imp.filter = 'all';
  if (!parsed) {
    imp.err = '没识别出歌单/单曲 ID，请粘贴完整的网易云分享链接或纯数字 ID';
    startTask('impparse', '解析链接失败', imp.err, 1, false);
    recordTaskError(link || '空链接', imp.err);
    finishTask('解析链接失败', imp.err);
    render();
    return;
  }
  imp.loading = true;
  startTask('impparse', '正在解析分享链接…', `正在拉取 ${parsed.type === 'playlist' ? '歌单' : '单曲'} (${parsed.id}) 曲目列表`, 0, true);
  render();
  try {
    let songs = [];
    if (parsed.type === 'playlist') {
      const pl = await window.neta.playlistSongs(parsed.id);
      imp.name = pl.name; songs = pl.songs || [];
    } else {
      songs = await window.neta.songDetail(parsed.id);
      imp.name = songs[0] ? songs[0].name : '';
    }
    if (!songs.length) {
      imp.err = '这个链接里没有解析到可用歌曲（可能歌单为空或为私有歌单）';
      recordTaskError(imp.name || parsed.id, imp.err);
      finishTask('歌单解析异常', imp.err);
    } else {
      imp.items = songs.map((sg, idx) => ({
        _idx: idx, song: sg, voice: null, cands: [], pick: 0,
        skip: false, done: false, manual: false, suspect: null, err: '', gap: null,
      }));
      scheduleSaveImpState(true);
    }
  } catch (e) {
    imp.err = '解析失败：' + (e.message || e);
    recordTaskError(parsed.id, imp.err);
    finishTask('歌单解析失败', imp.err);
  }
  imp.loading = false;
  render();
  if (imp.items.length) matchImport();
}

/** 声音搜索带本地缓存：同一个关键词只打一次接口（批量导入重解析 686 首会少掉上千次请求） */

/** 声音搜索带本地缓存：同一个关键词只打一次接口（批量导入重解析 686 首会少掉上千次请求） */
async function voiceSearchCached(kw, n) {
  const key = 'vs:' + n + ':' + kw;
  try {
    const c = localStorage.getItem(key);
    if (c) {
      const o = JSON.parse(c);
      if (o && Array.isArray(o.v)) return o.v;
    }
  } catch (e) { }
  const v = await window.neta.searchVoices(kw, n);
  try {
    // 存精简字段，控制体积；超过 400 条就丢掉最早的 100 条
    const slim = (v || []).map(function (x) {
      return { mainTrackId: x.mainTrackId, title: x.title, duration: x.duration, cover: x.cover, radio: x.radio, artist: x.artist };
    });
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('vs:') === 0) keys.push(k);
    }
    if (keys.length > 400) {
      keys.slice(0, 100).forEach(function (k) { localStorage.removeItem(k); });
    }
    localStorage.setItem(key, JSON.stringify({ t: Date.now(), v: slim }));
  } catch (e) { }
  return v;
}

/** 多查询组合智能搜索声音（保留词内括号、精简歌手括号、按时长误差决定是否继续搜纯歌名） */

/** 多查询组合智能搜索声音（保留词内括号、精简歌手括号、按时长误差决定是否继续搜纯歌名） */
async function voiceSearchSmart(song, limit) {
  const n = limit || 16;
  const raw = unwrapSongQuotes(song.name || '');
  const clean = looseSongName(song.name || '');
  const fa = firstArtistClean(song.artist || '');
  const queries = [];
  const addQ = function (q) {
    const s = String(q || '').replace(/\s+/g, ' ').trim();
    if (s && queries.indexOf(s) < 0) queries.push(s);
  };
  if (raw && normNameRaw(raw).length >= 1) {
    if (fa) addQ(raw + ' ' + fa);
    addQ(raw);
  }
  if (clean && clean !== raw) {
    if (fa) addQ(clean + ' ' + fa);
    addQ(clean);
  }
  if (!normNameRaw(raw) && fa) {
    addQ(raw + ' ' + fa);
    addQ(fa);
  }
  const seen = new Set();
  const out = [];
  for (let qi = 0; qi < queries.length; qi++) {
    const kw = queries[qi];
    let list = [];
    try { list = await voiceSearchCached(kw, n); } catch (e) { list = []; }
    for (let j = 0; j < list.length; j++) {
      const v = list[j];
      const key = String(v.mainTrackId || v.voiceId || '');
      if (key && !seen.has(key)) {
        seen.add(key);
        out.push(v);
      }
    }
    const hasStrong = out.some(function (v) {
      const sc = scoreVoice(song, v);
      return !sc.bad && (sc.gap == null || Math.abs(sc.gap) <= 6);
    });
    if (hasStrong && out.length >= 4) break;
  }
  out.sort(function (a, b) {
    return scoreVoice(song, b).score - scoreVoice(song, a).score;
  });
  return out;
}

function refreshOpenMobileImpPanel(i) {
  const it = imp.items[i];
  if (!it) return;
  const panel = document.querySelector('[data-panel="' + i + '"]');
  if (panel) panel.outerHTML = candPanel(it, i);
}

async function mobileInlineImpSearch(i, kw, useSmart) {
  const it = imp.items[i];
  if (!it || it.searching) return;
  const cleanKw = String(kw || '').trim();
  if (cleanKw) it.customKw = cleanKw;
  it.searching = true;
  it.err = '';
  refreshOpenMobileImpPanel(i);
  try {
    let list = [];
    if (useSmart || !cleanKw) {
      list = await voiceSearchSmart(it.song, 18);
    } else {
      list = await voiceSearchCached(cleanKw, 18);
      list = (list || []).slice().sort(function (a, b) {
        return scoreVoice(it.song, b).score - scoreVoice(it.song, a).score;
      });
    }
    it.cands = list || [];
    it.manual = false;
    applyBest(it);
    if (it.voice) it.skip = false;
    scheduleSaveImpState(false);
  } catch (e) {
    it.err = '搜索失败：' + (e.message || e);
  }
  it.searching = false;
  updateSingleImpRow(i);
  refreshOpenMobileImpPanel(i);
}

async function matchImport(rematchPending) {
  if (imp.matching) return;
  const total = imp.items.length;
  if (!total) return;
  imp.matching = true;
  window.__impMatchStop = false;
  if (rematchPending) {
    imp.items.forEach((x) => {
      if (!x.done && !x.manual && (!x.voice || x.skip || !x.cands || !x.cands.length)) {
        x.cands = [];
        x._matchedOnce = false;
      }
    });
  }
  imp.matchTotal = total;
  imp.matchDone = imp.items.filter((x) => x._matchedOnce || (x.cands && x.cands.length)).length;
  startTask('impmatch', '正在匹配播客声源', `共 ${total} 首 · 已匹配 ${imp.matchDone} 首`, total, false, '暂停');
  if (S.page.name === 'import') render();

  let okCnt = imp.items.filter((x) => x.voice).length;
  for (let i = 0; i < imp.items.length; i++) {
    if (window.__impMatchStop) break;
    const it = imp.items[i];
    if (!it || it.done || (it.cands && it.cands.length)) continue;
    await waitNavYield();
    it.matching = true;
    it.err = '';
    updateSingleImpRow(i);
    try {
      it.cands = await voiceSearchSmart(it.song, 14);
    } catch (e) {
      it.cands = [];
      it.err = '搜索失败：' + (e.message || e);
    }
    applyBest(it);
    if (it.voice) it.skip = false;
    it.matching = false;
    it._matchedOnce = true;
    imp.matchDone = imp.items.filter((x) => x._matchedOnce || (x.cands && x.cands.length)).length;
    if (it.voice) {
      okCnt++;
    } else if (it.suspect) {
      recordTaskError(it.song.name, `候选需人工确认（${it.suspectWhy || '时长或标题不符'}）`);
    } else {
      recordTaskError(it.song.name, it.err || '网易云播客未搜到任何可用声音');
    }
    updImpMatchBar(it.song.name);
    stepTask(imp.matchDone, `正在匹配 (${imp.matchDone}/${total})：${it.song.name}`);
    updateSingleImpRow(i);
    scheduleSaveImpState(false);
    await bgSleep(120);
  }
  imp.matching = false;
  scheduleSaveImpState(true);
  const usable = imp.items.filter((x) => !x.skip && !x.done && x.voice).length;
  const miss = imp.items.filter((x) => !x.done && (!x.voice || x.skip)).length;
  finishTask(
    window.__impMatchStop ? '声源匹配已暂停' : '播客声源匹配完成',
    `可直接下载 ${usable} 首${miss ? ` · 待确认/未找到 ${miss} 首` : ''}`,
    5000
  );
  if (S.page.name === 'import') render();
}

function importDownloadAll() {
  if (!storageOK()) { askStorage(); return; }
  const byName = new Map();
  const byNorm = new Map();
  S.tracks.forEach((t) => {
    byName.set(String(t.path).split('/').pop().toLowerCase(), t);
    const nt = normName(t.title || '');
    if (nt) byNorm.set(nt, t);
  });
  let redo = 0;
  for (const it of imp.items) {
    if (it.done || !it.voice) continue;
    const fn = (String(it.song.name || '未知').replace(/[\\/:*?"<>|]/g, '_').trim() + '.mp3').toLowerCase();
    const old = byName.get(fn) || byNorm.get(normName(it.song.name || ''));
    if (!old) continue;
    const a = +(old.duration || 0), b = +(it.song.duration || 0);
    const gap = (a && b) ? Math.abs(a - b) : 0;
    if (gap > 30) { it.redo = true; redo++; }
    else it.done = true;
  }
  scheduleSaveImpState(true);
  const todo = imp.items.filter((x) => !x.skip && !x.done && x.voice);
  if (!todo.length) { render(); toast('没有待下载的歌曲'); return; }
  if (redo) toast(redo + ' 首本地文件时长对不上，将重新下载');
  imp.busy = true;
  imp.doneCount = 0;
  imp.totalCount = todo.length;
  imp.curPct = -1;
  window.__impStop = false;
  window.__impCurrent = null;
  startTask('impdl', '正在批量下载音频…', `共 ${todo.length} 首待下载`, todo.length, false, '停止');
  if (S.page.name === 'import') render();
  window.__impQueue = todo;
  nextImportDownload();
}

async function nextImportDownload() {
  if (window.__impStop) {
    window.__impQueue = []; window.__impCurrent = null;
    imp.busy = false;
    finishTask('批量下载已停止', `已下载 ${imp.doneCount} / ${imp.totalCount} 首`);
    if (S.page.name === 'import') render();
    toast('已停止下载');
    return;
  }
  const q = window.__impQueue || [];
  const it = q.shift();
  if (!it) {
    imp.busy = false; window.__impCurrent = null;
    scheduleSaveImpState(true);
    loadLibrary();
    finishTask(
      '批量下载全部完成',
      `成功处理 ${imp.doneCount} / ${imp.totalCount} 首${S.task.errors.length ? ` · 失败 ${S.task.errors.length} 首` : ''}`,
      5500
    );
    if (S.page.name === 'import') render();
    toast('全部下载完成');
    return;
  }
  it.running = true; it.prog = '准备中…'; it.err = '';
  window.__impCurrent = it;
  updateSingleImpRow(it._idx);
  updImpBar();
  stepTask(imp.doneCount, `正在下载 (${imp.doneCount + 1}/${imp.totalCount})：${it.song.name}`);
  try {
    let u = await window.neta.songUrl(it.voice.mainTrackId);
    if ((!u || !u.url) && window.neta.songUrlV1) {
      u = await window.neta.songUrlV1(it.voice.mainTrackId, 'exhigh');
    }
    if (!u || !u.url) throw new Error('拿不到音频地址（版权或接口限制）');
    let lrc = '';
    try {
      const ly = await window.neta.lyric(it.song.id);
      lrc = ly ? (window.neta.mergeLrc ? window.neta.mergeLrc(ly.lrc || '', ly.tlyric || '') : (ly.lrc || '')) : '';
    } catch (e) { }
    window.__dlCtx = { song: it.song, voice: it.voice, lrc: lrc };
    window.__impCurrent = it;
    const safe = String(it.song.name || '未知').replace(/[\\/:*?"<>|]/g, '_').trim();
    A.downloadAsync(u.url, safe + '.mp3', lrc);
  } catch (e) {
    it.running = false; it.prog = ''; it.skip = true;
    it.err = e.message || '获取下载地址失败';
    recordTaskError(it.song.name, it.err);
    updateSingleImpRow(it._idx);
    bgSchedule(nextImportDownload, 120);
  }
}

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

function shuffled(list) {
  const a = (list || []).slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const x = a[i]; a[i] = a[j]; a[j] = x;
  }
  return a;
}

const MODE_ICONS = {
  loop: '<path d="M17 2l4 4-4 4V7H7a3 3 0 0 0-3 3v2H2v-2a5 5 0 0 1 5-5h10V2zM7 22l-4-4 4-4v3h10a3 3 0 0 0 3-3v-2h2v2a5 5 0 0 1-5 5H7v3z"/>',
  shuffle: '<path d="M17 3.6l3.4 3.4-3.4 3.4V8.3h-1.7c-1.2 0-2 .5-2.8 1.6l-.9 1.2-1.2-1.6.7-1C12.3 6.7 13.6 6 15.3 6H17V3.6zM3 6h2.3c1.7 0 3 .7 4.2 2.2l5.1 6.9c.8 1.1 1.6 1.6 2.8 1.6H20v-2.1l3.4 3.4L20 21.4v-2.7h-2.6c-1.7 0-3-.7-4.2-2.2L8.1 9.6C7.3 8.5 6.5 8 5.3 8H3V6zm0 10h2.3c.5 0 .9-.1 1.3-.3l1.3 1.7c-.8.4-1.7.6-2.6.6H3v-2z"/>',
  one: '<path d="M17 2l4 4-4 4V7H7a3 3 0 0 0-3 3v2H2v-2a5 5 0 0 1 5-5h10V2zM7 22l-4-4 4-4v3h10a3 3 0 0 0 3-3v-2h2v2a5 5 0 0 1-5 5H7v3zm4.2-13h1.8v6h-1.6v-4.3l-1.2.8-.7-1.1 1.7-1.4z"/>',
};

function paintShuffle() {
  const b = document.getElementById('npShuffle');
  if (b) {
    b.classList.toggle('on', S.mode !== 'loop');
    const ic = document.getElementById('npModeIcon') || b.querySelector('svg');
    if (ic) ic.innerHTML = MODE_ICONS[S.mode] || MODE_ICONS.loop;
  }
  const sub = document.getElementById('npHeadSub');
  if (sub) {
    const mName = S.mode === 'shuffle' ? '随机播放' : S.mode === 'one' ? '单曲循环' : '顺序循环';
    sub.textContent = S.queuePaths.length ? `${mName} · ${S.cur + 1} / ${S.queuePaths.length}` : '本地曲库';
  }
  const qc = document.getElementById('npQueueCount');
  if (qc) qc.textContent = S.queuePaths.length ? String(S.queuePaths.length) : '';
}

function setPlayMode(mode) {
  S.mode = mode;
  S.shuffle = (mode === 'shuffle');
  S.hist = [];
  try {
    localStorage.setItem('playMode', mode);
    localStorage.setItem('shuffle', S.shuffle ? '1' : '0');
  } catch (e) { }
  paintShuffle();
  savePlayerSession();
}

function ensureShuffle() {
  if (S.mode === 'shuffle') return;
  setPlayMode('shuffle');
}

function toggleShuffle() {
  const next = S.mode === 'loop' ? 'shuffle' : S.mode === 'shuffle' ? 'one' : 'loop';
  setPlayMode(next);
  toast(next === 'shuffle' ? '随机播放' : next === 'one' ? '单曲循环' : '顺序循环');
  if (S.sheet && S.sheet.kind === 'queue') refreshOpenSheet();
}

function playShuffleAll() {
  if (!S.tracks.length) return;
  ensureShuffle();
  const list = shuffled(S.tracks);
  playAt(list, 0);
  toast('随机播放 ' + list.length + ' 首');
}

function refreshOpenSheet() {
  const dlg = sheetDlg();
  if (dlg && dlg.open && S.sheet && S.sheet.kind) {
    dlg.innerHTML = sheetHtml();
  }
}

/* ---------------- 播放队列操作 & 下一首播放 ---------------- */
function openQueueSheet() {
  openSheet('queue');
  setTimeout(() => {
    const curEl = document.querySelector('#qListBox .q-item.cur');
    if (curEl && curEl.scrollIntoView) {
      try { curEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) { }
    }
  }, 60);
}

function playNextInsert(t) {
  if (!t) return;
  if (!S.queuePaths.length || S.cur < 0) {
    playAt([t], 0);
    toast('开始播放：' + (t.title || ''));
    return;
  }
  if (S.queuePaths[S.cur] === t.path) {
    toast('当前正在播放这首歌');
    return;
  }
  const curPath = S.queuePaths[S.cur];
  const existIdx = S.queuePaths.indexOf(t.path);
  if (existIdx >= 0) {
    S.queuePaths.splice(existIdx, 1);
    S.cur = S.queuePaths.indexOf(curPath);
  }
  S.queuePaths.splice(S.cur + 1, 0, t.path);
  paintShuffle();
  savePlayerSession();
  toast('已设为下一首播放：' + (t.title || ''));
}

/* ---------------- 播放页直接「更换声源」 ---------------- */
async function openSourceSwitcher() {
  const curPath = S.queuePaths[S.cur];
  const t = curPath ? trackByPath(curPath) : null;
  if (!t) { toast('请先播放一首本地歌曲'); return; }
  const kw = (String(t.title || '') + ' ' + String(t.artist || '')).trim();
  S.srcSwitch = {
    track: t,
    kw: kw,
    loading: true,
    cands: [],
    err: '',
    prevId: '',
    busyId: '',
    savedPos: S.pos || 0,
  };
  openSheet('source');
  await searchSourceCands(kw);
}

async function searchSourceCands(kw) {
  const sw = S.srcSwitch;
  const t = sw.track;
  if (!t) return;
  kw = String(kw || '').trim();
  sw.kw = kw;
  sw.loading = true;
  sw.err = '';
  refreshOpenSheet();
  try {
    if (!window.neta) throw new Error('离线模式不可用');
    let raw = await voiceSearchCached(kw || t.title, 14);
    const seen = new Set((raw || []).map((v) => String(v.mainTrackId)));
    const targetDur = +(t.duration || 0);
    const songObj = { name: t.title || kw, duration: targetDur };
    const goodCount = (raw || []).filter((v) => !scoreVoice(songObj, v).bad).length;
    if (goodCount < 3 && t.title && kw !== t.title) {
      try {
        const more = await voiceSearchCached(t.title, 12);
        (more || []).forEach((v) => {
          if (!seen.has(String(v.mainTrackId))) { raw.push(v); seen.add(String(v.mainTrackId)); }
        });
      } catch (e) { }
    }
    const scored = (raw || []).map((v) => {
      const s = scoreVoice(songObj, v);
      return { v: v, score: s.score, gap: s.gap, bad: s.bad, badKind: s.badKind, why: s.why };
    }).sort((a, b) => b.score - a.score);
    sw.cands = scored;
    sw.loading = false;
  } catch (e) {
    sw.loading = false;
    sw.err = '搜索声源失败：' + (e.message || e);
  }
  refreshOpenSheet();
}

async function previewSourceCand(idx) {
  const sw = S.srcSwitch;
  const item = sw.cands[idx];
  if (!item || !item.v) return;
  const v = item.v;
  const id = String(v.mainTrackId);
  if (sw.prevId === id && S.playing) {
    restoreSourceOriginal();
    return;
  }
  try {
    sw.prevId = id;
    refreshOpenSheet();
    toast('正在获取试听：' + (v.title || ''));
    let u = await window.neta.songUrl(v.mainTrackId);
    if ((!u || !u.url) && window.neta.songUrlV1) {
      u = await window.neta.songUrlV1(v.mainTrackId, 'exhigh');
    }
    if (!u || !u.url) {
      sw.prevId = '';
      refreshOpenSheet();
      toast('该声源暂不可试听');
      return;
    }
    if (A && typeof A.previewEx === 'function') A.previewEx(u.url, v.title || '声源试听', voiceArtist(v), v.cover || '');
    else if (A) A.preview(u.url, v.title || '声源试听', v.cover || '');
    let started2 = true;
    try { if (A && typeof A.isPlaying === 'function') started2 = !!A.isPlaying(); } catch (e2) { }
    if (started2) enterPreviewMode(v.title || '声源试听', voiceArtist(v), v.cover, v.duration);
    else { S.playing = false; paintPlayIcon(); }
    refreshOpenSheet();
  } catch (e) {
    sw.prevId = '';
    refreshOpenSheet();
    toast('试听失败：' + (e.message || e));
  }
}

function restoreSourceOriginal() {
  const sw = S.srcSwitch;
  sw.prevId = '';
  const t = sw.track;
  if (t && A) {
    A.playEx(t.path, t.title || '', t.artist || '', t.cover || '');
    if (sw.savedPos > 2) {
      setTimeout(() => { try { A.seek(Math.round(sw.savedPos * 1000)); } catch (e) { } }, 220);
    }
    S.playing = true;
    paintPlayIcon();
  }
  refreshOpenSheet();
}

async function applySourceCand(idx) {
  const sw = S.srcSwitch;
  const item = sw.cands[idx];
  const t = sw.track;
  if (!item || !item.v || !t) return;
  if (!storageOK()) { closeSheet(); askStorage(); return; }
  const v = item.v;
  sw.busyId = String(v.mainTrackId);
  sw.dlPct = 5;
  sw.dlText = '正在获取高音质下载地址…';
  sw.dlErr = '';
  refreshOpenSheet();
  try {
    let u = await window.neta.songUrl(v.mainTrackId);
    if ((!u || !u.url) && window.neta.songUrlV1) {
      u = await window.neta.songUrlV1(v.mainTrackId, 'exhigh');
    }
    if (!u || !u.url) throw new Error('拿不到该声源的音频地址（可能受版权或网络限制）');
    sw.dlPct = 12;
    sw.dlText = '正在下载替换音频文件…';
    refreshOpenSheet();
    const oldPath = t.path;
    const fileName = String(oldPath).split('/').pop() || (String(t.title || '未知歌曲').replace(/[\\/:*?"<>|]/g, '_') + '.mp3');
    let oldMeta = {};
    try { oldMeta = JSON.parse(localStorage.getItem('meta:' + oldPath) || '{}') || {}; } catch (e) { oldMeta = {}; }
    window.__dlCtx = {
      song: {
        name: t.title || oldMeta.title || '',
        artist: t.artist || oldMeta.artist || '',
        album: t.album || oldMeta.album || '',
        cover: t.cover || oldMeta.cover || v.cover || '',
        alias: t.alias || (oldMeta.alias ? String(oldMeta.alias).split('|') : []),
      },
      voice: v,
      lrc: '',
    };
    const res = await downloadOnce(u.url, fileName, '');
    if (!res || !res.ok) throw new Error((res && res.p) || '下载替换失败');
    const newPath = (res.p && res.p.indexOf('/') >= 0) ? res.p : oldPath;
    const updatedMeta = {
      artist: t.artist || oldMeta.artist || '',
      album: t.album || oldMeta.album || '',
      cover: t.cover || oldMeta.cover || v.cover || '',
      hasLrc: !!(t.hasLrc || oldMeta.hasLrc),
      title: t.title || oldMeta.title || '',
      alias: Array.isArray(t.alias) ? t.alias.join('|') : (oldMeta.alias || ''),
      voiceId: v.voiceId || v.mainTrackId,
      mainTrackId: v.mainTrackId,
      voiceTitle: v.title || '',
      v: 2,
    };
    try {
      localStorage.setItem('meta:' + newPath, JSON.stringify(updatedMeta));
      if (newPath !== oldPath) localStorage.setItem('meta:' + oldPath, JSON.stringify(updatedMeta));
    } catch (e) { }
    t.duration = v.duration || t.duration;
    if (newPath !== oldPath) {
      S.queuePaths = S.queuePaths.map((p) => p === oldPath ? newPath : p);
      if (S.favs.has(oldPath)) { S.favs.delete(oldPath); S.favs.add(newPath); saveFavs(); }
      S.playlists.forEach((pl) => { pl.tracks = pl.tracks.map((p) => p === oldPath ? newPath : p); });
      savePlaylists();
      t.path = newPath;
    }
    loadLibrary();
    const fresh = trackByPath(newPath) || t;
    fresh.duration = v.duration || fresh.duration;
    sw.busyId = '';
    sw.prevId = '';
    sw.dlPct = 100;
    sw.dlErr = '';
    closeSheet();
    if (A) A.playEx(fresh.path, fresh.title || '', fresh.artist || '', fresh.cover || '');
    S.playing = true;
    showMini(fresh);
    loadLyrics(fresh);
    paintPlayIcon();
    render();
    toast('已更换声源：' + (v.title || ''));
  } catch (e) {
    sw.busyId = '';
    sw.dlErr = '更换声源失败：' + (e.message || e);
    refreshOpenSheet();
    toast(sw.dlErr);
  }
}

/* ---------------- 播放状态持久化与恢复 ---------------- */
let _posSaveTimer = 0;

function savePlayerSession(posOnly) {
  try {
    if (!posOnly && S.queuePaths.length && S.cur >= 0) {
      localStorage.setItem('player:session', JSON.stringify({
        q: S.queuePaths.slice(0, 500),
        cur: S.cur,
        path: S.queuePaths[S.cur] || '',
      }));
    }
    if (S.queuePaths[S.cur]) {
      localStorage.setItem('player:pos', JSON.stringify({
        path: S.queuePaths[S.cur],
        pos: Math.floor(S.pos || 0),
      }));
    }
  } catch (e) { }
}

function restorePlayerSession() {
  if (S._sessionRestored || !S.tracks.length || S.queuePaths.length) return;
  S._sessionRestored = true;
  try {
    const raw = JSON.parse(localStorage.getItem('player:session') || 'null');
    if (!raw || !Array.isArray(raw.q) || !raw.q.length) return;
    const valid = raw.q.filter((p) => !!trackByPath(p));
    if (!valid.length) return;
    let idx = valid.indexOf(raw.path);
    if (idx < 0) idx = Math.min(Math.max(0, raw.cur || 0), valid.length - 1);
    const t = trackByPath(valid[idx]);
    if (!t) return;
    S.queuePaths = valid;
    S.cur = idx;
    const posObj = JSON.parse(localStorage.getItem('player:pos') || 'null');
    const savedSec = (posObj && posObj.path === t.path && posObj.pos > 0) ? posObj.pos : 0;
    S.pos = savedSec;
    S.dur = t.duration || 0;
    S._restoredNeedsPlay = !(A && A.isPlaying && A.isPlaying());
    showMini(t);
    loadLyrics(t);
    const pct = S.dur ? Math.min(100, (savedSec / S.dur) * 100) : 0;
    $('#miniBar').style.width = pct + '%';
    $('#npCur').textContent = fmt(savedSec);
    const r = $('#npRange');
    if (r) {
      r.value = Math.round(pct * 10);
      r.style.setProperty('--seek-pct', pct.toFixed(1) + '%');
    }
    if (savedSec > 0) syncLyric(savedSec);
    paintPlayIcon();
    paintShuffle();
  } catch (e) { }
}

/* ---------------- 播放（O(1) 局部高亮更新，不重建大列表 DOM） ---------------- */
function updatePlayingRowInPlace() {
  const curPath = S.queuePaths[S.cur] || '';
  document.querySelectorAll('.row.playing').forEach((row) => {
    if (row.dataset.path !== curPath) {
      row.classList.remove('playing');
      const slot = row.querySelector('.row-eq-slot');
      if (slot) slot.innerHTML = '';
      else row.querySelector('.eq-bars')?.remove();
    }
  });
  if (!curPath) return;
  const curTrack = trackByPath(curPath);
  if (!curTrack || curTrack._idx == null) return;
  document.querySelectorAll(`.row[data-song="${curTrack._idx}"]`).forEach((row) => {
    row.classList.add('playing');
    const eqHtml = `<span class="eq-bars${S.playing ? '' : ' paused'}"><i></i><i></i><i></i></span>`;
    const slot = row.querySelector('.row-eq-slot');
    if (slot) slot.innerHTML = eqHtml;
  });
}

// 三策略算法已下沉到 assets/js/random.js（与桌面端 lib/random.js 逐字节同步的
// 普通 script 副本，Android WebView 不能 require）；这里只做状态适配。

// 三策略算法已下沉到 assets/js/random.js（与桌面端 lib/random.js 逐字节同步的
// 普通 script 副本，Android WebView 不能 require）；这里只做状态适配。
function pickNextShuffleIndexMobile() {
  // 兜底：assets/js/random.js 缺失时退化为真随机
  if (typeof MusicPlayRandom === 'undefined' || !MusicPlayRandom.pickNextShuffleIndex) {
    return Math.floor(Math.random() * Math.max(1, S.queuePaths.length))
  }
  return MusicPlayRandom.pickNextShuffleIndex({
    queuePaths: S.queuePaths,
    qPos: S.cur,
    strategy: S.randomStrategy || 'no-repeat',
    playedSet: S.shufflePlayed,
    playCountOf: getPlayCount,
  });
}

function playAt(list, i) {
  const t = list[i];
  if (!t) return;
  pushRecent(t.path);
  incPlayCount(t.path);
  S.queuePaths = list.map((x) => x.path);
  S.cur = i;
  S.playing = true;
  S._restoredNeedsPlay = false;
  if (A) A.playEx(t.path, t.title || '', t.artist || '', t.cover || '');
  applyCurrentTrackGain();
  showMini(t);
  loadLyrics(t);
  paintPlayIcon();
  paintShuffle();
  savePlayerSession();
  updatePlayingRowInPlace();
}

function queueNext(delta, autoEnded) {
  if (!S.queuePaths.length) return;
  let i;
  if (autoEnded && S.mode === 'one' && S.cur >= 0) {
    i = S.cur;
  } else if (S.mode === 'shuffle' && delta > 0) {
    i = pickNextShuffleIndexMobile();
    S.hist.push(S.cur);
    if (S.hist.length > 300) S.hist.shift();
  } else if (S.mode === 'shuffle' && delta < 0 && S.hist.length) {
    i = S.hist.pop();
  } else {
    i = S.cur + delta;
    if (i < 0) i = S.queuePaths.length - 1;
    if (i >= S.queuePaths.length) i = 0;
  }
  const t = trackByPath(S.queuePaths[i]);
  if (!t) return;
  pushRecent(t.path);
  incPlayCount(t.path);
  S.cur = i;
  S.playing = true;
  S._restoredNeedsPlay = false;
  if (A) A.playEx(t.path, t.title || '', t.artist || '', t.cover || '');
  applyCurrentTrackGain();
  showMini(t);
  loadLyrics(t);
  paintPlayIcon();
  paintShuffle();
  savePlayerSession();
  if (S.sheet && (S.sheet.kind === 'queue' || S.sheet.kind === 'npset')) refreshOpenSheet();
  updatePlayingRowInPlace();
}

function paintNpFav() {
  if (S.previewPath) {
    const b0 = document.getElementById('npFav');
    const i0 = document.getElementById('npFavIcon');
    if (b0) b0.classList.remove('on');
    if (i0) i0.setAttribute('fill', 'none');
    return;
  }
  const curPath = S.queuePaths[S.cur] || '';
  const on = !!(curPath && S.favs.has(curPath));
  const btn = document.getElementById('npFav');
  const ic = document.getElementById('npFavIcon');
  if (btn) btn.classList.toggle('on', on);
  if (ic) ic.setAttribute('fill', on ? 'currentColor' : 'none');
}

function showMini(t) {
  // 非试听占用时自动退出试听展示模式
  if (S.previewPath && t && t.path !== S.previewPath) S.previewPath = null;
  const m = $('#mini');
  m.classList.remove('hidden');
  $('#miniTitle').textContent = t.title || '未知标题';
  $('#miniArtist').textContent = t.artist || '未知艺人';
  coverFor(t, $('#miniCover'));
  coverFor(t, $('#npCover'));
  const url = S.covers.get(t.path) || '';
  const bg = $('#npBg');
  if (bg) {
    bg.style.backgroundImage = url ? `url("${url}")` : '';
  }
  extractAmbientColor(url);
  $('#npTitle').textContent = t.title || '未知标题';
  $('#npArtist').textContent = t.artist || '未知艺人';
  S.dur = t.duration || 0;
  $('#npDur').textContent = fmt(S.dur);
  paintNpFav();
  paintShuffle();
  applyCurrentTrackGain();
}

/** 关键事件落盘：logcat 被刷掉也能事后取证（路径见 Bridge.diag） */

/** 试听不建队列，但 mini 条与播放页必须跟着试听走：
 *  以前只更新播放图标，标题/封面/歌手仍是上一首，看起来像「放的是上首歌」。 */
function enterPreviewMode(title, artist, coverUrl, durSec) {
  const path = 'preview:' + Date.now();
  S.previewPath = path;
  // 关键：试听也属于「已经播过东西」，必须清掉恢复会话标志，
  // 否则之后点「恢复」会被 _restoredNeedsPlay 分支劫走，去重播队列里的本地歌。
  S._restoredNeedsPlay = false;
  S.covers.set(path, coverUrl || '');
  showMini({
    path,
    title: title || '试听',
    artist: artist || '在线试听',
    cover: coverUrl || '',
    duration: durSec || 0,
  });
  S.playing = true;
  paintPlayIcon();
  const box = document.getElementById('npLyrics') || document.getElementById('lyricsBox');
  if (box) box.innerHTML = '<div class="lyric-line">试听片段，暂无歌词</div>';
}

function exitPreviewMode() { S.previewPath = null; }

function paintPlayIcon() {
  // discSpinToggle: 唱盘旋转跟随播放状态
  document.querySelector('.np-stage')?.classList.toggle('playing', S.playing);
  const play = '<path d="M8 5.6v12.8a.9.9 0 0 0 1.38.77l10-6.4a.9.9 0 0 0 0-1.54l-10-6.4A.9.9 0 0 0 8 5.6z"/>';
  const pause = '<rect x="7.2" y="5" width="3.4" height="14" rx="1.4"/><rect x="13.4" y="5" width="3.4" height="14" rx="1.4"/>';
  $('#miniIcon').innerHTML = S.playing ? pause : play;
  $('#npIcon').innerHTML = S.playing ? pause : play;
  document.querySelectorAll('.eq-bars').forEach((el) => el.classList.toggle('paused', !S.playing));
}

function togglePlayPause() {
  // 试听不建立播放队列，所以「队列为空」不能等价于「不能播放」
  if (S._restoredNeedsPlay && !S.playing && !S.previewPath && S.queuePaths.length) {
    const t = trackByPath(S.queuePaths[S.cur]);
    if (t && A) {
      const savedSec = S.pos || 0;
      S._restoredNeedsPlay = false;
      S.playing = true;
      A.playEx(t.path, t.title || '', t.artist || '', t.cover || '');
      if (savedSec > 1) {
        setTimeout(() => { try { A.seek(Math.round(savedSec * 1000)); } catch (e) { } }, 220);
      }
      paintPlayIcon();
      return;
    }
  }
  if (!A) return;
  if (S.playing) {
    A.pause();
    diag('pause 发出');
    let stillPlaying = false;
    try { stillPlaying = !!(A.isPlaying && A.isPlaying()); } catch (e) { }
    S.playing = stillPlaying;
    paintPlayIcon();
    if (stillPlaying) toast('暂停失败，请重试');
    return;
  }
  S._restoredNeedsPlay = false;
  A.resume();
  S.playing = true;
  paintPlayIcon();
  diag('resume 发出');
  checkAfterResume(0);
}

/** 恢复后按原生状态复核；第一次失败就让原生重开数据源，第二次仍失败才认输 */

/** 恢复后按原生状态复核；第一次失败就让原生重开数据源，第二次仍失败才认输 */
function checkAfterResume(attempt) {
  setTimeout(() => {
    let ok = true;
    try { ok = !!(A && A.isPlaying && A.isPlaying()); } catch (e) { }
    diag('resume 复核#' + attempt + ' ok=' + ok + ' playing(JS)=' + S.playing);
    if (ok) return;
    if (attempt === 0 && A && typeof A.recover === 'function') {
      diag('resume 复核失败 → 请求原生重开');
      try { A.recover(); } catch (e) { }
      checkAfterResume(1);
      return;
    }
    if (S.playing) {
      S.playing = false;
      paintPlayIcon();
      toast('恢复播放失败，请重新点「试听」');
      diag('resume 最终失败，界面回滚为暂停');
    }
  }, 1800);
}

/* ---------------- 歌词 ---------------- */
function setOffset(ms) {
  const p = S.queuePaths[S.cur];
  if (!p) return;
  S.offset = Math.max(-5000, Math.min(5000, Math.round(ms)));
  localStorage.setItem('off:' + p, String(S.offset));
  const el = document.getElementById('npOffset');
  if (el) el.textContent = (S.offset > 0 ? '+' : '') + (S.offset / 1000).toFixed(1) + 's';
  S.lyricIdx = -2;
  syncLyric(S.pos || 0);
}

function loadLyrics(t) {
  S.lyrics = [];
  S.lyricIdx = -1;
  S.lastUserScrollAt = 0;
  document.getElementById('npResume')?.classList.add('hidden');
  S.offset = +(localStorage.getItem('off:' + t.path) || 0);
  const offEl = $('#npOffset');
  if (offEl) offEl.textContent = (S.offset > 0 ? '+' : '') + (S.offset / 1000).toFixed(1) + 's';
  if (!A || !t.hasLrc) { renderLyrics(); return; }
  const lrcPath = t.path.replace(/\.[^.]+$/, '') + '.lrc';
  let txt = A.readText(lrcPath);
  if (!txt && A.loadLyric) txt = A.loadLyric(t.path);
  if (!txt && A.loadLyricByBase) txt = A.loadLyricByBase(t.path);
  if (!txt) { renderLyrics(); return; }
  S.lyrics = parseLrc(txt);
  renderLyrics();
}

function parseLrc(txt) {
  const out = [];
  String(txt).split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
    if (!m) return;
    const t = +m[1] * 60 + +m[2] + (m[3] ? +m[3].padEnd(2, '0').slice(0, 2) / 100 : 0);
    const body = m[4].trim();
    if (!body) return;
    const last = out[out.length - 1];
    // 同时间戳相邻两行 → 原文 + 译文
    if (last && Math.abs(last.t - t) < 0.06 && !last.tr) { last.tr = body; return; }
    out.push({ t, text: body, tr: '' });
  });
  return out;
}

function renderLyrics() {
  const box = $('#npLyrics');
  const pm = document.getElementById('npPeekMain');
  const ps = document.getElementById('npPeekSub');
  if (!S.lyrics.length) {
    box.innerHTML = '<div class="np-empty">暂无歌词 · 可点下方「换声源」或等待自动补全</div>';
    if (pm) pm.textContent = '暂无歌词';
    if (ps) ps.textContent = '轻点唱片切换歌词视图';
    return;
  }
  if (pm) pm.textContent = S.lyrics[0].text || '轻点唱片查看双语歌词';
  if (ps) ps.textContent = S.lyrics[0].tr || (S.lyrics[1] ? S.lyrics[1].text : '');
  box.innerHTML = S.lyrics.map((l, i) =>
    `<div class="np-line" data-line="${i}">${esc(l.text)}</div>` +
    (l.tr ? `<div class="np-line tr" data-line="${i}">${esc(l.tr)}</div>` : '')
  ).join('');
  box.querySelectorAll('[data-line]').forEach((el) => {
    el.addEventListener('click', () => {
      const l = S.lyrics[+el.dataset.line];
      if (l && A) {
        S.lastUserScrollAt = 0;
        document.getElementById('npResume')?.classList.add('hidden');
        A.seek(Math.round(l.t * 1000));
      }
    });
  });
}

function pushOverlay() {
  if (!A || !A.overlayText || !A.overlayShown || !A.overlayShown()) return;
  const i = S.lyricIdx;
  if (i == null || i < 0 || !S.lyrics[i]) { A.overlayText('', ''); return; }
  A.overlayText(S.lyrics[i].text || '', S.lyrics[i].tr || '');
}

function scrollToCurrentLyric() {
  const first = document.querySelector(`[data-line="${S.lyricIdx}"]`);
  if (!first) return;
  const box = $('#npLyrics');
  if (!box) return;
  const top = first.offsetTop - box.clientHeight / 2 + first.clientHeight / 2;
  box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
}

function syncLyric(sec) {
  if (!S.lyrics.length) return;
  const t = sec - S.offset / 1000;
  let idx = -1;
  for (let i = 0; i < S.lyrics.length; i++) if (S.lyrics[i].t <= t + 0.05) idx = i;
  const userScrolling = (Date.now() - (S.lastUserScrollAt || 0)) < 3800;
  document.getElementById('npResume')?.classList.toggle('hidden', !userScrolling);
  if (idx === S.lyricIdx) return;
  S.lyricIdx = idx;
  document.querySelectorAll('#npLyrics .np-line').forEach((e) => {
    const li = +e.dataset.line;
    const dist = Math.abs(li - idx);
    e.classList.toggle('cur', li === idx);
    e.classList.toggle('near', dist === 1);
    e.classList.toggle('far', dist >= 3);
  });
  if (idx < 0) return;
  const curL = S.lyrics[idx];
  const pm = document.getElementById('npPeekMain');
  const ps = document.getElementById('npPeekSub');
  if (pm && curL) pm.textContent = curL.text || '';
  if (ps && curL) ps.textContent = curL.tr || (S.lyrics[idx + 1] ? S.lyrics[idx + 1].text : '');
  pushOverlay();
  if (!userScrolling) scrollToCurrentLyric();
}

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

/* ---------------- 导航 ---------------- */
function goBack() {
  markNavTransition();
  if (S.page.name === 'playlist') S.page = { name: 'playlists', arg: null };
  else S.page = { name: S.tab, arg: null };
  render();
}

function setTab(tab) {
  markNavTransition();
  S.tab = tab;
  S.page = { name: tab, arg: null };
  S.q = '';
  render();
}

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

function openNpSheet() {
  const npEl = document.getElementById('np');
  if (!npEl) return;
  npEl.classList.remove('hidden');
  const sec = S.pos || 0;
  const pct = S.dur ? Math.min(100, (sec / S.dur) * 100) : 0;
  const curEl = document.getElementById('npCur');
  if (curEl) curEl.textContent = fmt(sec);
  const r = document.getElementById('npRange');
  if (r && !r.dataset.drag) {
    r.value = Math.round(pct * 10);
    r.style.setProperty('--seek-pct', pct.toFixed(1) + '%');
  }
  S.lyricIdx = -2;
  syncLyric(sec);
}

// mini 播放条 & 播放页控制

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

/* ---------------- 歌词手动滚动防抢夺 ---------------- */
function bindLyricsScrollGuard() {
  const box = document.getElementById('npLyrics');
  if (!box) return;
  const markManual = () => {
    if (!S.lyrics.length) return;
    S.lastUserScrollAt = Date.now();
    document.getElementById('npResume')?.classList.remove('hidden');
  };
  box.addEventListener('touchmove', markManual, { passive: true });
  box.addEventListener('wheel', markManual, { passive: true });
}

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
