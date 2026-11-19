/*
 * views/home.js — 首页与在线搜索。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

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

function searchBar() {
  return `<div class="searchbar">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="11" cy="11" r="6.4"/><path d="M16 16l4.5 4.5"/></svg>
    <input id="q" type="search" placeholder="搜索本地歌曲 / 歌手 / 译名" value="${esc(S.q)}">
    <button class="q-clear" id="qClear" type="button" aria-label="清空搜索" style="display:${S.q ? 'inline-flex' : 'none'}">×</button>
    <button class="q-go" id="qGo" type="button">搜在线</button>
  </div>`;
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
