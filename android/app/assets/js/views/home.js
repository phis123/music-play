/*
 * views/home.js — 首页与在线搜索（v2 重构：精致网格对齐 + 统一 SVG 图标）。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

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
          ? `<div class="list-2col">${on.songs.map(onlineRow).join('')}</div>`
          : '<div class="search-hint">按回车或点「搜在线」查找网易云曲库</div>';
    return `
      <div class="section section-first">
        <div class="section-title">本地匹配</div>
        <div class="section-more">${hits.length} 首</div>
      </div>
      ${hits.length ? `<div class="list-2col">${hits.map((t) => songRow(t, S.tracks.indexOf(t))).join('')}</div>`
                    : '<div class="search-hint">本地没有匹配（原名 / 译名 / 别名均可搜索）</div>'}
      <div class="section">
        <div class="section-title">在线结果</div>
        <div class="section-more">${on.songs.length ? on.songs.length + ' 首' : ''}</div>
      </div>
      ${onlineBody}`;
  }

  const hist = getSearchHist();
  const histBar = hist.length
    ? `<div class="search-hist">
        <span class="search-hist-label">最近</span>
        ${hist.map((h) => `<button class="search-pill" data-qhist="${esc(h)}">${esc(h)}</button>`).join('')}
        <button class="search-hist-clear" data-qhist-clear="1">清空</button>
      </div>`
    : '';
  const recent = [...S.tracks].sort((a, b) => b.id - a.id).slice(0, 12);
  return `
    ${histBar}
    <div class="home-greet">
      <div>
        <div class="h1">音乐库</div>
        <div class="sub">本地 ${S.tracks.length} 首 · 喜欢 ${S.favs.size} 首 · ${S.playlists.length} 个歌单</div>
      </div>
      <button class="pill-cta" data-shuffle-all>
        ${ico('shuffle', 'ico-sm')}
        <span>随心听</span>
      </button>
    </div>

    <div class="quick-grid">
      <button class="quick-tile tone-red" data-go="local">
        <span class="quick-ico">${ico('disc')}</span>
        <span class="quick-text">
          <span class="quick-name">本地音乐</span>
          <span class="quick-count">${S.tracks.length} 首</span>
        </span>
      </button>
      <button class="quick-tile tone-amber" data-go="liked">
        <span class="quick-ico">${ico('heart', '', 'none')}</span>
        <span class="quick-text">
          <span class="quick-name">我喜欢的</span>
          <span class="quick-count">${S.favs.size} 首</span>
        </span>
      </button>
      <button class="quick-tile tone-blue" data-go="playlists">
        <span class="quick-ico">${ico('playlist')}</span>
        <span class="quick-text">
          <span class="quick-name">歌单</span>
          <span class="quick-count">${S.playlists.length} 个</span>
        </span>
      </button>
    </div>

    <div class="section">
      <div class="section-title">最近添加</div>
      <div class="section-more">${recent.length} 首</div>
    </div>
    <div class="hscroll">${recent.map(cardHtml).join('')}</div>

    <div class="section">
      <div class="section-title">全部歌曲</div>
      <div class="section-acts">
        <button class="playall" data-shuffle-all>${ico('shuffle', 'ico-xs')}<span>随机</span></button>
        <button class="playall pri" data-playall>${ico('play', 'ico-xs')}<span>播放全部</span></button>
      </div>
    </div>
    <div class="list-2col">${S.tracks.slice(0, 30).map((t, i) => songRow(t, i)).join('')}</div>`;
}

function viewHome() {
  return `<div class="page-shell">${searchBar()}<div id="homeBody">${homeBodyHtml()}</div></div>`;
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

function cardHtml(t) {
  const idx = S.tracks.indexOf(t);
  return `<button class="card" data-song="${idx}">
    <div class="card-cover" data-cover="${idx}"></div>
    <div class="card-title">${esc(t.title || '未知标题')}</div>
    <div class="card-sub">${esc(t.artist || '未知艺人')}</div>
  </button>`;
}

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

function searchBar() {
  return `<div class="searchbar">
    <span class="search-ico">${ico('search', 'ico-sm')}</span>
    <input id="q" type="search" placeholder="搜索本地歌曲 / 歌手 / 译名" value="${esc(S.q)}">
    <button class="q-clear" id="qClear" type="button" aria-label="清空搜索" style="display:${S.q ? 'inline-flex' : 'none'}">${ico('close', 'ico-xs')}</button>
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
