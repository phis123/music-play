/*
 * views/router.js — 渲染分发、封面绘制、标签同步与返回/切标签。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

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
