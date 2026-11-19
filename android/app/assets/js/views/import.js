/*
 * views/import.js — 批量导入（解析/匹配/下载/分片渲染）。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

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
