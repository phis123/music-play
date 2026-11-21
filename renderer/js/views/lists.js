/**
 * views/lists.js — 列表类视图（歌单/喜欢/最近/本地）与行渲染、行内动作
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { $, $$, audio, cleanTitle, esc, fmt } from '../core/dom.js'
import { state } from '../core/state.js'
import { FAV_DIR, FAV_KEY, favSet, getPlaylists, getRecent, isFav, savePlaylists } from '../core/store.js'
import { askConfirm, askText, toast } from '../core/ui.js'
import { loadCover, setCover } from '../library/cover.js'
import { rescan } from '../library/scan.js'
import { matchLocalTrack } from '../library/search.js'
import { play, playPath } from '../player/queue.js'
import { render } from './router.js'


export function renderSidebar() {
  const el = document.getElementById('plList')
  if (!el) return
  el.innerHTML = getPlaylists().map((p) =>
    `<a class="nav-item" data-route="#/playlist/${p.id}"><span class="ico">▸</span>` +
    `<span class="pl-name">${esc(p.name)}</span><span class="pl-n">${p.tracks.length}</span></a>`
  ).join('')
  el.querySelectorAll('.nav-item').forEach((a) => {
    a.addEventListener('click', () => { location.hash = a.dataset.route })
  })
  $$('.nav-item').forEach((el2) => el2.classList.toggle('active', el2.dataset.route === location.hash))
}


export function closeAddMenu() {
  document.getElementById('addMenu')?.remove()
}

export function openAddMenu(t, anchor) {
  closeAddMenu()
  const list = getPlaylists()
  const menu = document.createElement('div')
  menu.id = 'addMenu'
  menu.className = 'add-menu'
  menu.innerHTML = '<div class="am-title">加入歌单</div>' +
    list.map((p) => `<button data-pl="${p.id}">${esc(p.name)}<span class="am-n">${p.tracks.length}</span></button>`).join('') +
    '<button data-pl-new="1" class="am-new">＋ 新建歌单</button>'
  document.body.appendChild(menu)
  const r = anchor.getBoundingClientRect()
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 230)) + 'px'
  menu.style.top = Math.min(r.bottom + 6, window.innerHeight - 200) + 'px'
  menu.addEventListener('click', async (e) => {
    e.stopPropagation()
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.plNew) {
      const name = await askText('新建歌单', '新歌单')
      if (!name) return
      const v = getPlaylists()
      v.push({ id: String(Date.now()), name, tracks: [] })
      savePlaylists(v)
      closeAddMenu()
      renderSidebar()
      return
    }
    const v = getPlaylists()
    const pl = v.find((x) => x.id === b.dataset.pl)
    if (!pl) return
    if (!pl.tracks.some((x) => x.path === t.path)) {
      pl.tracks.push({ path: t.path, title: t.title, artist: t.artist, duration: t.duration })
    }
    savePlaylists(v)
    closeAddMenu()
    renderSidebar()
    render()
  })
  setTimeout(() => document.addEventListener('click', closeAddMenu, { once: true }), 0)
}


/* ---------------- Hero 顶栏 + 列表页内筛选排序 + 曲库体检 (Phase 2 & 3) ---------------- */
export function totalDurStr(list) {
  const sec = (list || []).reduce((acc, t) => acc + (+(t && t.duration) || 0), 0)
  const mins = Math.round(sec / 60)
  return mins > 0 ? ` · 约 ${mins} 分钟` : ''
}


export function filterAndSortTracks(list) {
  let out = (list || []).slice()
  const kw = (state.listFilter || '').trim()
  if (kw) out = out.filter((t) => matchLocalTrack(t, kw))
  const st = state.listSort || 'default'
  if (st === 'title') {
    out.sort((a, b) => cleanTitle(a.title).localeCompare(cleanTitle(b.title), 'zh-CN'))
  } else if (st === 'artist') {
    out.sort((a, b) => String(a.artist || '').localeCompare(String(b.artist || ''), 'zh-CN'))
  } else if (st === 'duration') {
    out.sort((a, b) => (+(b.duration || 0)) - (+(a.duration || 0)))
  } else if (st === 'bitrate') {
    out.sort((a, b) => (+(b.bitrate || 0)) - (+(a.bitrate || 0)))
  }
  return out
}


export function heroCardHtml({ title, sub, firstTrack, actsHtml }) {
  const covIdx = firstTrack ? state.tracks.indexOf(firstTrack) : -1
  return `<div class="hero-card">
    <div class="hero-cover" ${covIdx >= 0 ? `data-rowcov="${covIdx}"` : ''}>${covIdx < 0 ? '♪' : ''}</div>
    <div class="hero-main">
      <div class="hero-title">${esc(title)}</div>
      <div class="hero-sub">${esc(sub)}</div>
      <div class="hero-acts">${actsHtml || ''}</div>
    </div>
  </div>`
}


export function listToolbarHtml() {
  const st = state.listSort || 'default'
  const sorts = [
    ['default', '默认'],
    ['title', '歌名'],
    ['artist', '歌手'],
    ['duration', '时长'],
    ['bitrate', '音质'],
  ]
  return `<div class="list-toolbar">
    <div class="list-filter">
      <span>🔍</span>
      <input id="listFilterInput" type="search" placeholder="在当前列表中筛选歌名/歌手…" value="${esc(state.listFilter)}">
    </div>
    <div class="list-sorts">
      ${sorts.map(([k, lbl]) => `<button class="sort-pill${st === k ? ' on' : ''}" data-sort="${k}">${lbl}</button>`).join('')}
    </div>
  </div>`
}


export function currentListBaseTracks() {
  const hash = location.hash || '#/local'
  if (hash === '#/liked') return favTracks()
  if (hash === '#/recent') {
    return getRecent().map((r) => state.tracks.find((x) => x.path === r.path) || r)
  }
  if (hash.startsWith('#/playlist/')) {
    const pl = getPlaylists().find((p) => p.id === hash.split('/').pop())
    return pl ? pl.tracks.map((r) => state.tracks.find((x) => x.path === r.path) || r) : []
  }
  return state.tracks
}


export function renderCurrentListRowsHtml() {
  const hash = location.hash || '#/local'
  const base = currentListBaseTracks()
  const shown = filterAndSortTracks(base)
  if (!shown.length) return `<div class="search-hint">没有符合筛选条件的歌曲</div>`
  if (hash.startsWith('#/playlist/')) {
    return `<div class="tracklist">${shown.map((t, i) => {
      const idx = state.tracks.findIndex((x) => x.path === t.path)
      const isCur = idx >= 0 && state.cur === idx
      const paused = !audio || audio.paused
      const eq = isCur ? `<span class="eq-bars${paused ? ' paused' : ''}"><i></i><i></i><i></i></span>` : ''
      return `<div class="track-row${isCur ? ' active' : ''}" data-path="${esc(t.path)}" ${idx >= 0 ? `data-i="${idx}"` : ''}>
        <div class="idx">${i + 1}</div>
        <div class="cov" ${idx >= 0 ? `data-rowcov="${idx}"` : ''}></div>
        <div class="tt">${eq}${esc(cleanTitle(t.title))}</div>
        <div class="ar">${esc(t.artist || '未知艺人')}</div>
        <div class="du">${fmt(t.duration || 0)}</div>
        <div class="row-acts">
          ${idx >= 0 ? `<button class="act" data-qnext="${idx}" title="下一首播放">↷</button>` : ''}
          <button class="act" data-plrm-path="${esc(t.path)}" title="移出歌单">✕</button>
        </div>
      </div>`
    }).join('')}</div>`
  }
  return `<div class="tracklist">${shown.map((t, i) => {
    const idx = state.tracks.findIndex((x) => x.path === t.path)
    if (idx >= 0) return trackRowHtml(state.tracks[idx], idx, i + 1)
    return `<div class="track-row" data-path="${esc(t.path)}">
      <div class="idx">${i + 1}</div>
      <div class="cov"></div>
      <div class="tt">${esc(cleanTitle(t.title))}</div>
      <div class="ar">${esc(t.artist || '未知艺人')}</div>
      <div class="du">${fmt(t.duration || 0)}</div>
      <div class="row-acts"></div>
    </div>`
  }).join('')}</div>`
}


export function updateListBody() {
  const box = $('#listBody')
  if (!box) { render(); return }
  box.innerHTML = renderCurrentListRowsHtml()
  $$('.sort-pill[data-sort]').forEach((el) => el.classList.toggle('on', el.dataset.sort === state.listSort))
  bindListBodyEvents()
}


export function bindListBodyEvents() {
  $$('#listBody .track-row').forEach((el) => el.addEventListener('click', () => {
    if (el.dataset.i != null && el.dataset.i !== '') play(+el.dataset.i)
    else if (el.dataset.path) playPath(el.dataset.path)
  }))
  $$('#listBody [data-rowcov]').forEach((el) => {
    const t = state.tracks[+el.dataset.rowcov]
    if (t) loadCover(t.path, (url) => setCover(el, url))
  })
  $$('#listBody [data-plrm-path]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation()
    const id = location.hash.split('/').pop()
    const v = getPlaylists()
    const p2 = v.find((x) => x.id === id)
    if (p2) {
      p2.tracks = p2.tracks.filter((x) => x.path !== el.dataset.plrmPath)
      savePlaylists(v)
      renderSidebar()
      render()
    }
  }))
}


export function viewPlaylist(id) {
  const pl = getPlaylists().find((p) => p.id === id)
  if (!pl) return viewEmpty('歌单不存在', '可能已被删除')
  const base = currentListBaseTracks()
  const hero = heroCardHtml({
    title: pl.name,
    sub: `共 ${pl.tracks.length} 首${totalDurStr(base)}`,
    firstTrack: base[0],
    actsHtml: `
      <button class="btn-sm primary" data-list-playall="1">▶ 播放全部</button>
      <button class="btn-sm" data-list-shuffle="1">🔀 随机播放</button>
      <button class="btn-sm" id="plRename">重命名</button>
      <button class="btn-sm" id="plDel">删除歌单</button>`,
  })
  if (!pl.tracks.length) {
    return hero + `<div class="empty-note"><div class="big">这个歌单还没有歌曲</div><div>点歌曲右边的 ＋ 加入歌单</div></div>`
  }
  return hero + listToolbarHtml() + `<div id="listBody">${renderCurrentListRowsHtml()}</div>`
}


export async function toggleFav(t) {
  if (!t || !t.path) return
  const set = favSet()
  const on = !set.has(t.path)
  const r = await window.api.fav({ filePath: t.path, on })
  if (!r || !r.ok) { toast('操作失败：' + ((r && r.reason) || '未知错误')); return }
  if (on) set.add(t.path); else set.delete(t.path)
  localStorage.setItem(FAV_KEY, JSON.stringify([...set]))
  await rescan()
  render()
}


export async function deletePlaylist(id) {
  const pl = getPlaylists().find((p) => p.id === id)
  if (!pl) return
  if (!(await askConfirm(`删除歌单「${pl.name}」？\n（只删歌单，不动音乐文件）`))) return
  const v = getPlaylists().filter((p) => p.id !== id)
  savePlaylists(v)
  renderSidebar()
  location.hash = '#/local'
  render()
}


/* ---------------- 我喜欢的音乐视图 ---------------- */
export function favTracks() {
  return state.tracks.filter((t) => t.path.includes('\\' + FAV_DIR + '\\'))
}

export function viewLiked() {
  const list = favTracks()
  const hero = heroCardHtml({
    title: '我喜欢的音乐',
    sub: `共 ${list.length} 首${totalDurStr(list)} · ${state.root}\\${FAV_DIR}`,
    firstTrack: list[0],
    actsHtml: `
      <button class="btn-sm primary" data-list-playall="1">▶ 播放全部</button>
      <button class="btn-sm" data-list-shuffle="1">🔀 随机播放</button>`,
  })
  if (!list.length) return hero + `<div class="empty-note"><div class="big">还没有喜欢的歌曲</div><div>点歌曲右边的 ♥ 收藏，文件会同步到「${FAV_DIR}」文件夹</div></div>`
  return hero + listToolbarHtml() + `<div id="listBody">${renderCurrentListRowsHtml()}</div>`
}


/* ---------------- 行模板（带 下一首播放 / ♥ / ＋ / 删） ---------------- */
export function trackRowHtml(t, idx, no) {
  const isCur = state.cur === idx && idx >= 0
  const paused = !audio || audio.paused
  const eq = isCur ? `<span class="eq-bars${paused ? ' paused' : ''}"><i></i><i></i><i></i></span>` : ''
  return `
    <div class="track-row${isCur ? ' active' : ''}" data-i="${idx}" data-path="${esc(t.path)}">
      <div class="idx">${no != null ? no : idx + 1}</div>
      <div class="cov" data-rowcov="${idx}"></div>
      <div class="tt">${eq}${esc(cleanTitle(t.title))}${t.hasLrc ? '<span class="badge">词</span>' : ''}${t.bitrate ? `<span class="badge kbps-badge">${t.bitrate}k</span>` : ''}</div>
      <div class="ar">${esc(t.artist || '未知艺人')}</div>
      <div class="du">${fmt(t.duration || 0)}</div>
      <div class="row-acts">
        <button class="act" data-qnext="${idx}" title="下一首播放">↷</button>
        <button class="act${isFav(t.path) ? ' on' : ''}" data-fav="${idx}" title="喜欢">♥</button>
        <button class="act" data-pladd="${idx}" title="加入歌单">＋</button>
        <button class="act del" data-del="${idx}" title="删除（移到回收站）"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V4.8h5V7M6.2 7l.9 12.4a1 1 0 0 0 1 .9h7.8a1 1 0 0 0 1-.9L17.8 7"/><path d="M10.2 11v6M13.8 11v6"/></svg></button>
      </div>
    </div>`
}


export function viewRecent() {
  const list = getRecent()
  if (!list.length) return viewEmpty('最近播放', '播放过的歌会出现在这里（最多 30 首）')
  const base = currentListBaseTracks()
  const hero = heroCardHtml({
    title: '最近播放',
    sub: `最近 ${list.length} 首${totalDurStr(base)}`,
    firstTrack: base[0],
    actsHtml: `
      <button class="btn-sm primary" data-list-playall="1">▶ 播放全部</button>
      <button class="btn-sm" data-list-shuffle="1">🔀 随机播放</button>`,
  })
  return hero + listToolbarHtml() + `<div id="listBody">${renderCurrentListRowsHtml()}</div>`
}


export function viewLocal() {
  const list = state.tracks
  const hero = heroCardHtml({
    title: '本地音乐',
    sub: `共 ${list.length} 首${totalDurStr(list)} · 目录：${state.root || '未设置'}`,
    firstTrack: list[0],
    actsHtml: `
      <button class="btn-sm primary" data-list-playall="1">▶ 播放全部</button>
      <button class="btn-sm" data-list-shuffle="1">🔀 随机播放</button>
      <button id="btnRescan" class="btn-sm">🔄 刷新扫描</button>
      <button id="btnGoSettings" class="btn-sm">⚙ 目录与设置</button>`,
  })
  if (!list.length) {
    return hero + `<div class="empty-note"><div class="big">当前目录还没有音频文件</div><div>可点击上方「⚙ 目录与设置」切换音乐文件夹，或前往「批量导入」下载歌曲</div></div>`
  }
  return hero + listToolbarHtml() + `<div id="listBody">${renderCurrentListRowsHtml()}</div>`
}


export function viewEmpty(title, desc) {
  return `<div class="page-title">${esc(title)}</div>
    <div class="page-sub">${esc(desc)}</div>
    <div class="empty-note"><div class="big">这里还是空的</div><div>功能待接入</div></div>`
}
