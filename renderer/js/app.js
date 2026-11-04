/* music-play · 渲染进程：路由 / 视图 / 播放条 / 歌词页 */
const $ = (s) => document.querySelector(s)
const $$ = (s) => Array.from(document.querySelectorAll(s))
const audio = $('#audio')

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a.9.9 0 0 0 1.38.77l10-6.4a.9.9 0 0 0 0-1.54l-10-6.4A.9.9 0 0 0 8 5.6z"/></svg>'
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.2" y="5" width="3.4" height="14" rx="1.4"/><rect x="13.4" y="5" width="3.4" height="14" rx="1.4"/></svg>'

const state = {
  tracks: [],
  cur: -1,
  lines: [],
  activeIdx: -1,
  lastUserScrollAt: 0,
  floatOn: false,
  offsetMs: 0,
  searchTab: 'local',
  root: '',
  activeIdx: -1,
}

/* ---------------- 工具 ---------------- */
const fmt = (s) => {
  if (!isFinite(s) || s < 0) s = 0
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
const cleanTitle = (t) => String(t || '').replace(/^\d{1,3}\s*[-_.、)\]]\s*/, '').trim() || String(t || '')
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const toFileUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/').split('/')
  .map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join('/')

/* ---------------- 最近播放 ---------------- */
const RECENT_KEY = 'recentTracks'

function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}
function pushRecent(t) {
  if (!t || !t.path) return
  const list = getRecent().filter((x) => x.path !== t.path)
  list.unshift({ path: t.path, title: t.title, artist: t.artist, duration: t.duration, at: Date.now() })
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 30)))
}
async function playPath(p) {
  const idx = state.tracks.findIndex((t) => t.path === p)
  if (idx >= 0) return play(idx)
  const rec = getRecent().find((x) => x.path === p)
  const base = String(p).split(/[\\/]/).pop()
  return playTrack(rec ? { ...rec, hasLrc: false } : { path: p, title: base }, -1)
}

/* ---------------- 封面加载队列（限并发） ---------------- */
const coverQ = []
let coverBusy = 0
const coverCache = new Map()

function pumpCover() {
  while (coverBusy < 3 && coverQ.length) {
    const job = coverQ.shift()
    coverBusy++
    const finish = () => { coverBusy--; pumpCover() }
    if (coverCache.has(job.path)) {
      job.apply(coverCache.get(job.path))
      coverBusy--
      continue
    }
    window.api.cover(job.path).then((url) => {
      coverCache.set(job.path, url)
      job.apply(url)
    }).catch(() => {}).finally(finish)
  }
}
function loadCover(path, apply) {
  coverQ.push({ path, apply })
  pumpCover()
}
const setCover = (el, url) => {
  if (!el) return
  if (url) {
    el.style.backgroundImage = `url("${url}")`
    el.style.backgroundSize = 'cover'
    el.style.backgroundPosition = 'center'
    el.classList.add('has-cover')
  } else {
    el.style.backgroundImage = ''
    el.classList.remove('has-cover')
  }
}

/* ---------------- 视图 ---------------- */
const search = {
  kw: '',
  tab: 'song',
  loading: false,
  songs: [],
  voices: [],
  song: null,
  err: '',
  playingVoiceId: null,
  downloading: {},
}

const fmtDur = (sec) => {
  sec = Math.round(sec || 0)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}
const fmtPlays = (n) => (n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n || 0))

function viewSearchBody() {
  if (search.loading) return `<div class="search-hint">搜索中…</div>`
  if (search.err) return `<div class="search-hint" style="color:var(--red)">${esc(search.err)}</div>`

  // 播客 Tab：直接列声音
  if (search.tab === 'voice') {
    if (!search.voices.length) return `<div class="search-hint">输入关键词，搜索网易云播客里的声音</div>`
    return voiceListHtml()
  }

  // 歌曲 Tab：已选歌曲 → 声音列表
  if (search.song) {
    return `
      <div class="result-head">
        <button id="btnBackSongs" class="btn-ghost">← 返回歌曲列表</button>
        <span class="result-title">《${esc(search.song.name)}》的相关声音</span>
      </div>
      ${search.voices.length ? voiceListHtml() : `<div class="search-hint">没找到匹配的声音</div>`}`
  }

  if (!search.songs.length) return `<div class="search-hint">输入关键词，搜索网易云歌曲</div>`

  const rows = search.songs.map((s, i) => `
    <div class="song-row" data-song="${i}">
      <div class="cov"${s.cover ? ` style="background-image:url(&quot;${esc(s.cover)}&quot;)"` : ''}></div>
      <div class="s-main">
        <div class="s-name">${esc(s.name)}${s.fee === 1 ? '<span class="vip">VIP</span>' : ''}</div>
        <div class="s-sub">${esc(s.artist || '未知艺人')}${s.album ? ' · ' + esc(s.album) : ''}</div>
      </div>
      <div class="s-dur">${fmtDur(s.duration)}</div>
      <button class="btn-sm" data-pick="${i}">找声音</button>
    </div>`).join('')
  return `<div class="songlist">${rows}</div>`
}

function voiceListHtml() {
  const rows = search.voices.map((v, i) => {
    const dl = search.downloading[v.voiceId]
    const playing = search.playingVoiceId === v.voiceId
    return `
      <div class="voice-row">
        <div class="v-cov"${v.cover ? ` style="background-image:url(&quot;${esc(v.cover)}&quot;)"` : ''}></div>
        <div class="v-main">
          <div class="v-title">${esc(v.title || '(无标题)')}</div>
          <div class="v-sub">${esc(v.radio || '未知电台')} · ${fmtDur(v.duration)} · ${fmtPlays(v.plays)}播放</div>
        </div>
        <button class="btn-sm" data-preview="${i}">${playing ? '停止' : '试听'}</button>
        <button class="btn-sm primary" data-download="${i}" ${dl && dl !== '失败' ? 'disabled' : ''}>${dl || '下载'}</button>
      </div>`
  }).join('')
  return `<div class="voicelist">${rows}</div>`
}

function viewHome() {
  const tabs = ['song', 'voice'].map((t) => {
    const label = t === 'song' ? '歌曲' : '播客'
    return `<button class="tab ${search.tab === t ? 'active' : ''}" data-tab="${t}">${label}</button>`
  }).join('')

  return `
    <div class="home">
      <div class="search-wrap">
        <label class="search-box">
          <span>🔍</span>
          <input id="searchInput" type="text" placeholder="搜索歌曲 / 歌手，再挑声音下载"
                 value="${esc(search.kw)}">
          <button id="btnSearch">搜索</button>
        </label>
      </div>
      <div class="search-tabs">${tabs}</div>
      ${viewSearchBody()}
    </div>`
}

async function doSearch(explicitKw) {
  const kw = String(explicitKw || $('#searchInput')?.value || search.kw || '').trim()
  if (!kw) return
  search.kw = kw
  search.err = ''
  search.songs = []
  search.voices = []
  search.song = null
  search.playingVoiceId = null
  search.loading = true
  render()
  try {
    if (search.tab === 'song') search.songs = await window.api.searchSongs(kw)
    else search.voices = await window.api.searchVoices(kw)
  } catch (e) {
    search.err = '搜索失败：' + (e.message || e)
  }
  search.loading = false
  render()
}

async function pickSong(idx) {
  const song = search.songs[idx]
  if (!song) return
  search.song = song
  search.voices = []
  search.loading = true
  render()
  try {
    search.voices = await window.api.searchVoices({ name: song.name, artist: song.artist, duration: song.duration })
  } catch (e) {
    search.err = '声音搜索失败：' + (e.message || e)
  }
  search.loading = false
  render()
}

function stopPreview() {
  const a = $('#previewAudio')
  if (!a) return
  try { a.pause() } catch { }
  try { a.removeAttribute('src'); a.load() } catch { }
  search.playingVoiceId = null
}

async function togglePreview(idx) {
  const v = search.voices[idx]
  if (!v) return
  const a = $('#previewAudio')
  if (search.playingVoiceId === v.voiceId) {
    stopPreview()
    render()
    return
  }
  try {
    const url = await window.api.preview(v.mainTrackId)
    if (!url) { search.err = '拿不到试听地址'; render(); return }
    stopPreview()
    a.src = url
    await a.play()
    search.playingVoiceId = v.voiceId
  } catch (e) {
    search.err = '试听失败：' + (e.message || e)
  }
  render()
}

async function doDownload(idx) {
  const v = search.voices[idx]
  if (!v) return
  search.downloading[v.voiceId] = '下载中…'
  render()
  try {
    const r = await window.api.downloadVoice({ voice: v, song: search.song || { name: v.title } })
    const kb = r && r.br ? Math.round(r.br / 1000) : 0
    search.downloading[v.voiceId] = kb ? `已保存 ${kb}k` : '已保存'
    try {
      const lib = await window.api.scan(state.root)
      state.tracks = lib.tracks
      state.root = lib.root
    } catch { }
  } catch (e) {
    search.downloading[v.voiceId] = '失败'
    search.err = '下载失败：' + (e.message || e)
  }
  render()
}

/* ---------------- 批量导入 ---------------- */
const imp = { link: '', loading: false, name: '', items: [], err: '', busy: false, done: 0 }

function parseShareLink(text) {
  const t = String(text || '')
  const mp = t.match(/playlist[^0-9]{0,12}(\d{5,})/) || t.match(/playlist\/(\d+)/)
  const ms = t.match(/song[^0-9]{0,12}(\d{5,})/) || t.match(/song\/(\d+)/)
  if (mp) return { type: 'playlist', id: mp[1] }
  if (ms) return { type: 'song', id: ms[1] }
  const m = t.match(/(\d{6,})/)
  if (m) return { type: 'playlist', id: m[1] }
  return null
}

function importRowHtml(it, i) {
  const v = it.voices[it.pick]
  const st = it.skip ? '<span class="imp-st skip">已跳过</span>'
    : it.done ? '<span class="imp-st ok">已下载</span>'
    : v ? '<span class="imp-st">已匹配</span>'
    : '<span class="imp-st warn">未找到</span>'
  const vo = v
    ? `<div class="imp-v">${esc(v.title)}<span class="imp-v-sub">${esc(v.radio)} · ${fmt(v.duration)} · ${fmtPlays(v.plays)}播放</span></div>`
    : '<div class="imp-v muted">没有可用候选项</div>'
  return `<div class="imp-row">
    <div class="imp-main">
      <div class="imp-name">${i + 1}. ${esc(it.song.name)}<span class="imp-artist">${esc(it.song.artist || '')}</span></div>
      ${vo}
    </div>
    <div class="imp-right">${st}
      <button class="btn-sm" data-imp-swap="${i}" ${it.skip || it.done ? 'disabled' : ''}>换</button>
      <button class="btn-sm" data-imp-skip="${i}" ${it.done ? 'disabled' : ''}>${it.skip ? '恢复' : '跳过'}</button>
    </div>
  </div>`
}

function viewImport() {
  const total = imp.items.length
  const usable = imp.items.filter((x) => !x.skip && !x.done && x.voices[x.pick]).length
  const body = imp.loading
    ? '<div class="search-hint">解析中…</div>'
    : imp.err ? `<div class="search-hint" style="color:var(--red)">${esc(imp.err)}</div>`
    : total ? `<div class="imp-list">${imp.items.map(importRowHtml).join('')}</div>`
    : '<div class="search-hint">粘贴网易云歌单/歌曲分享链接，自动匹配播客声音</div>'
  return `<div class="page-title">批量导入</div>
    <div class="page-sub">粘贴分享链接（歌单或单曲），自动找对应的播客声音</div>
    <div class="imp-bar">
      <input id="impLink" value="${esc(imp.link)}" placeholder="https://music.163.com/playlist?id=...">
      <button id="impParse" class="btn-sm primary">${total ? '重新解析' : '解析'}</button>
      ${usable ? `<button id="impAll" class="btn-sm primary" ${imp.busy ? 'disabled' : ''}>下载全部（${usable}）</button>` : ''}
    </div>
    ${body}`
}

async function doImportParse() {
  const link = ($('#impLink')?.value || imp.link || '').trim()
  const parsed = parseShareLink(link)
  imp.link = link
  imp.items = []
  imp.err = ''
  if (!parsed) { imp.err = '没识别出歌单/歌曲 ID，请检查链接'; render(); return }
  imp.loading = true
  render()
  try {
    let songs = []
    if (parsed.type === 'playlist') {
      const pl = await window.api.playlist(parsed.id)
      imp.name = pl.name
      songs = pl.songs || []
    } else {
      songs = await window.api.songDetail(parsed.id)
      imp.name = songs[0] ? songs[0].name : ''
    }
    if (!songs.length) imp.err = '这个链接里没有歌曲'
    imp.items = songs.map((sg) => ({ song: sg, voices: [], pick: 0, skip: false, done: false }))
  } catch (e) {
    imp.err = '解析失败：' + (e.message || e)
  }
  imp.loading = false
  render()
  matchAllImport()
}

async function matchAllImport() {
  for (const it of imp.items) {
    if (it.voices.length) continue
    try {
      it.voices = await window.api.searchVoices({ name: it.song.name, artist: it.song.artist, duration: it.song.duration })
    } catch { it.voices = [] }
    render()
  }
}

async function importSwap(i) {
  const it = imp.items[i]
  if (!it) return
  it.pick += 1
  if (it.pick < it.voices.length) { render(); return }
  const kw = prompt('换个关键词重新搜声音（留空取消）', it.song.name)
  if (!kw) { it.pick = Math.max(0, it.pick - 1); render(); return }
  try {
    const list = await window.api.searchVoices(kw)
    it.voices = list
    it.pick = 0
  } catch { it.pick = Math.max(0, it.pick - 1) }
  render()
}

async function importAll() {
  imp.busy = true
  render()
  for (const it of imp.items) {
    if (it.skip || it.done) continue
    const v = it.voices[it.pick]
    if (!v) continue
    try {
      await window.api.downloadVoice({ voice: v, song: it.song })
      it.done = true
    } catch (e) { /* 单个失败继续 */ }
    render()
  }
  imp.busy = false
  await rescan()
  render()
}

/* ---------------- 歌单 ---------------- */
const PL_KEY = 'playlists'
const DEF_PL = [{ id: '1', name: '新建歌单', tracks: [] }, { id: '2', name: '我的歌单', tracks: [] }]

function getPlaylists() {
  try {
    const v = JSON.parse(localStorage.getItem(PL_KEY) || 'null')
    if (Array.isArray(v) && v.length) return v
  } catch { }
  return DEF_PL.map((x) => ({ ...x, tracks: [] }))
}
function savePlaylists(v) { localStorage.setItem(PL_KEY, JSON.stringify(v)) }

function renderSidebar() {
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

function closeAddMenu() {
  document.getElementById('addMenu')?.remove()
}
function openAddMenu(t, anchor) {
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
  menu.addEventListener('click', (e) => {
    e.stopPropagation()
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.plNew) {
      const name = prompt('歌单名称', '新歌单')
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

function viewPlaylist(id) {
  const pl = getPlaylists().find((p) => p.id === id)
  if (!pl) return viewEmpty('歌单不存在', '可能已被删除')
  if (!pl.tracks.length) return viewEmpty(pl.name, '这个歌单还没有歌曲（点歌曲右边的 ＋ 加入）')
  const rows = pl.tracks.map((t, i) => {
    const idx = state.tracks.findIndex((x) => x.path === t.path)
    return `<div class="track-row" data-path="${esc(t.path)}">
      <div class="idx">${i + 1}</div>
      <div class="cov" data-plcov="${i}"></div>
      <div class="tt">${esc(cleanTitle(t.title))}</div>
      <div class="ar">${esc(t.artist || '未知艺人')}</div>
      <div class="du">${fmt(t.duration || 0)}</div>
      <div class="row-acts"><button class="act" data-plrm="${i}" title="移出歌单">✕</button></div>
    </div>`
  }).join('')
  return `<div class="page-head">
      <div>
        <div class="page-title">${esc(pl.name)}</div>
        <div class="page-sub">共 ${pl.tracks.length} 首</div>
      </div>
      <div class="page-actions">
        <button id="plDel" class="btn-sm">删除歌单</button>
      </div>
    </div>
    <div class="tracklist">${rows}</div>`
}

/* ---------------- 我喜欢的音乐 ---------------- */
const FAV_KEY = 'favPaths'
const FAV_DIR = '我喜欢的音乐'

function favSet() {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')) } catch { return new Set() }
}
const isFav = (p) => favSet().has(p)

async function toggleFav(t) {
  if (!t || !t.path) return
  const set = favSet()
  const on = !set.has(t.path)
  const r = await window.api.fav({ filePath: t.path, on })
  if (!r || !r.ok) { alert('操作失败：' + ((r && r.reason) || '未知错误')); return }
  if (on) set.add(t.path); else set.delete(t.path)
  localStorage.setItem(FAV_KEY, JSON.stringify([...set]))
  await rescan()
  render()
}

async function rescan() {
  try {
    const lib = await window.api.scan(state.root)
    state.tracks = lib.tracks
    state.root = lib.root
  } catch { }
}

async function deleteTrack(t) {
  if (!t || !t.path) return
  if (!confirm(`删除《${cleanTitle(t.title)}》？\n文件会移到回收站（含歌词/封面）`)) return
  const r = await window.api.remove(t.path)
  if (!r || !r.ok) { alert('删除失败：' + ((r && r.reason) || '未知错误')); return }
  // 清掉本地记录
  const set = favSet(); set.delete(t.path)
  localStorage.setItem(FAV_KEY, JSON.stringify([...set]))
  const rec = getRecent().filter((x) => x.path !== t.path)
  localStorage.setItem(RECENT_KEY, JSON.stringify(rec))
  const pls = getPlaylists()
  for (const p of pls) p.tracks = p.tracks.filter((x) => x.path !== t.path)
  savePlaylists(pls)
  if (state.cur >= 0 && state.tracks[state.cur] && state.tracks[state.cur].path === t.path) {
    audio.pause()
    audio.removeAttribute('src')
    state.cur = -1
  }
  await rescan()
  renderSidebar()
  render()
}

async function deletePlaylist(id) {
  const pl = getPlaylists().find((p) => p.id === id)
  if (!pl) return
  if (!confirm(`删除歌单「${pl.name}」？\n（只删歌单，不动音乐文件）`)) return
  const v = getPlaylists().filter((p) => p.id !== id)
  savePlaylists(v)
  renderSidebar()
  location.hash = '#/local'
  render()
}

async function fixCovers() {
  const btn = $('#btnFixCover')
  if (btn) { btn.disabled = true; btn.textContent = '处理中…' }
  try {
    const r = await window.api.coverFix(state.tracks)
    alert(`已补 ${r.done} 张高清封面（检查了 ${r.total} 首）`)
  } catch (e) {
    alert('补封面失败：' + (e.message || e))
  }
  await rescan()
  render()
}
async function pickRoot() {
  const dir = await window.api.pickFolder()
  if (!dir) return
  const lib = await window.api.scan(dir)
  state.tracks = lib.tracks
  state.root = lib.root
  render()
}

/* ---------------- 我喜欢的音乐视图 ---------------- */
function favTracks() {
  return state.tracks.filter((t) => t.path.includes('\\' + FAV_DIR + '\\'))
}
function viewLiked() {
  const list = favTracks()
  if (!list.length) return viewEmpty('我喜欢的音乐', '点歌曲右边的 ♥ 收藏，文件会复制到「' + FAV_DIR + '」文件夹')
  const rows = list.map((t, i) => trackRowHtml(t, state.tracks.indexOf(t), i + 1)).join('')
  return `<div class="page-title">我喜欢的音乐</div>
    <div class="page-sub">共 ${list.length} 首 · ${esc(state.root)}\\${FAV_DIR}</div>
    <div class="tracklist">${rows}</div>`
}

/* ---------------- 行模板（带 ♥ / ＋） ---------------- */
function trackRowHtml(t, idx, no) {
  return `
    <div class="track-row" data-i="${idx}">
      <div class="idx">${no != null ? no : idx + 1}</div>
      <div class="cov" data-rowcov="${idx}"></div>
      <div class="tt">${esc(cleanTitle(t.title))}${t.hasLrc ? '<span class="badge">词</span>' : ''}${t.bitrate ? `<span class="badge kbps-badge">${t.bitrate}k</span>` : ''}</div>
      <div class="ar">${esc(t.artist || '未知艺人')}</div>
      <div class="du">${fmt(t.duration || 0)}</div>
      <div class="row-acts">
        <button class="act${isFav(t.path) ? ' on' : ''}" data-fav="${idx}" title="喜欢">♥</button>
        <button class="act" data-pladd="${idx}" title="加入歌单">＋</button>
        <button class="act del" data-del="${idx}" title="删除（移到回收站）"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9.5 7V4.8h5V7M6.2 7l.9 12.4a1 1 0 0 0 1 .9h7.8a1 1 0 0 0 1-.9L17.8 7"/><path d="M10.2 11v6M13.8 11v6"/></svg></button>
      </div>
    </div>`
}

function viewRecent() {
  const list = getRecent()
  if (!list.length) return viewEmpty('最近播放', '播放过的歌会出现在这里（最多 30 首）')
  const rows = list.map((t, i) => {
    const idx = state.tracks.findIndex((x) => x.path === t.path)
    if (idx >= 0) return trackRowHtml(state.tracks[idx], idx, i + 1)
    return `<div class="track-row" data-path="${esc(t.path)}">
      <div class="idx">${i + 1}</div>
      <div class="cov" data-recent-cov="${i}"></div>
      <div class="tt">${esc(cleanTitle(t.title))}</div>
      <div class="ar">${esc(t.artist || '未知艺人')}</div>
      <div class="du">${fmt(t.duration || 0)}</div>
    </div>`
  }).join('')
  return `<div class="page-title">最近播放</div>
    <div class="page-sub">最近 ${list.length} 首</div>
    <div class="tracklist">${rows}</div>`
}

function viewLocal() {
  if (!state.tracks.length) {
    return `<div class="page-head">
        <div>
          <div class="page-title">本地音乐</div>
          <div class="page-sub">${esc(state.root)}</div>
        </div>
        <div class="page-actions">
          <button id="btnPickRoot" class="btn-sm">选择文件夹</button>
          <button id="btnFixCover" class="btn-sm">补高清封面</button>
        <button id="btnImport" class="btn-sm primary">批量导入</button>
        </div>
      </div>
      <div class="empty-note"><div class="big">还没有歌曲</div><div>扫描目录为空，或标签读取失败</div></div>`
  }
  const rows = state.tracks.map((t, i) => trackRowHtml(t, i)).join('')
  return `<div class="page-head">
      <div>
        <div class="page-title">本地音乐</div>
        <div class="page-sub">共 ${state.tracks.length} 首 · ${esc(state.root)}</div>
      </div>
      <div class="page-actions">
        <button id="btnPickRoot" class="btn-sm">选择文件夹</button>
        <button id="btnImport" class="btn-sm primary">批量导入</button>
      </div>
    </div>
    <div class="tracklist">${rows}</div>`
}

function viewEmpty(title, desc) {
  return `<div class="page-title">${esc(title)}</div>
    <div class="page-sub">${esc(desc)}</div>
    <div class="empty-note"><div class="big">这里还是空的</div><div>功能待接入</div></div>`
}

const routes = {
  '#/home': viewHome,
  '#/liked': viewLiked,
  '#/recent': viewRecent,
  '#/local': viewLocal,
  '#/import': viewImport,
}

let __actsBound = false
function bindRowActions() {
  if (__actsBound) return
  __actsBound = true
  const view = document.getElementById('view')
  view.addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]')
    if (fav) {
      e.stopPropagation()
      const t = state.tracks[+fav.dataset.fav]
      if (t) toggleFav(t)
      return
    }
    const delBtn = e.target.closest('[data-del]')
    if (delBtn) {
      e.stopPropagation()
      const t = state.tracks[+delBtn.dataset.del]
      if (t) deleteTrack(t)
      return
    }
    const add = e.target.closest('[data-pladd]')
    if (add) {
      e.stopPropagation()
      const t = state.tracks[+add.dataset.pladd]
      if (t) openAddMenu(t, add)
    }
  })
}

function render() {
  const hash = location.hash || '#/home'
  let fn = routes[hash]
  if (!fn && hash.startsWith('#/playlist/')) fn = () => viewPlaylist(hash.split('/').pop())
  if (!fn) fn = viewHome
  $('#view').innerHTML = fn()
  $('#view').scrollTop = 0
  bindRowActions()
  renderSidebar()
  $$('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.route === hash))

  if (hash === '#/home') {
    const input = $('#searchInput')
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch() })
    $('#btnSearch')?.addEventListener('click', doSearch)
    $$('.tab').forEach((el) => el.addEventListener('click', () => {
      search.tab = el.dataset.tab
      search.song = null
      search.songs = []
      search.voices = []
      render()
      if (search.kw) doSearch()
    }))
    $$('[data-pick]').forEach((el) => el.addEventListener('click', (e) => {
      e.stopPropagation()
      pickSong(+el.dataset.pick)
    }))
    $$('.song-row').forEach((el) => el.addEventListener('click', () => pickSong(+el.dataset.song)))
    $$('[data-preview]').forEach((el) => el.addEventListener('click', () => togglePreview(+el.dataset.preview)))
    $$('[data-download]').forEach((el) => el.addEventListener('click', () => doDownload(+el.dataset.download)))
    $('#btnBackSongs')?.addEventListener('click', () => { search.song = null; search.voices = []; render() })
  }
  if (hash.startsWith('#/playlist/')) {
    $('#plDel')?.addEventListener('click', () => deletePlaylist(hash.split('/').pop()))
    const pl = getPlaylists().find((p) => p.id === hash.split('/').pop())
    $$('.track-row').forEach((el) => el.addEventListener('click', () => playPath(el.dataset.path)))
    $$('[data-plcov]').forEach((el) => {
      const t = pl && pl.tracks[+el.dataset.plcov]
      if (t) loadCover(t.path, (url) => setCover(el, url))
    })
    $$('[data-plrm]').forEach((el) => el.addEventListener('click', (e) => {
      e.stopPropagation()
      const v = getPlaylists()
      const p2 = v.find((x) => x.id === hash.split('/').pop())
      if (p2) { p2.tracks.splice(+el.dataset.plrm, 1); savePlaylists(v); renderSidebar(); render() }
    }))
  }
  if (hash === '#/recent') {
    $$('.track-row').forEach((el) => el.addEventListener('click', () => playPath(el.dataset.path)))
    const list = getRecent()
    $$('[data-recent-cov]').forEach((el) => {
      const t = list[+el.dataset.recentCov]
      if (t) loadCover(t.path, (url) => setCover(el, url))
    })
  }
  if (hash === '#/import') {
    $('#impParse')?.addEventListener('click', doImportParse)
    $('#impLink')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doImportParse() })
    $('#impAll')?.addEventListener('click', importAll)
    $$('[data-imp-swap]').forEach((el) => el.addEventListener('click', () => importSwap(+el.dataset.impSwap)))
    $$('[data-imp-skip]').forEach((el) => el.addEventListener('click', () => {
      const it = imp.items[+el.dataset.impSkip]
      if (it) { it.skip = !it.skip; render() }
    }))
  }
  $$('[data-rowcov]').forEach((el) => {
    const t = state.tracks[+el.dataset.rowcov]
    if (t) loadCover(t.path, (url) => setCover(el, url))
  })
  if (hash === '#/local') {
    $$('.track-row').forEach((el) => el.addEventListener('click', () => play(+el.dataset.i)))
    $('#btnPickRoot')?.addEventListener('click', pickRoot)
    $('#btnImport')?.addEventListener('click', () => { location.hash = '#/import' })
    // 懒加载列表封面
    $$('[data-cov]').forEach((el) => {
      const t = state.tracks[+el.dataset.cov]
      if (t) loadCover(t.path, (url) => setCover(el, url))
    })
  }
}

/* ---------------- 播放 ---------------- */
function play(i) {
  if (i < 0 || i >= state.tracks.length) return
  return playTrack(state.tracks[i], i)
}

async function playTrack(t, i) {
  if (!t) return
  state.cur = i
  pushRecent(t)

  stopPreview()
  audio.src = toFileUrl(t.path)
  audio.play().catch((e) => console.warn('播放失败', e))
  $$('.track-row').forEach((el) => el.classList.toggle('active', +el.dataset.i === i))
  $('#pbFav')?.classList.toggle('on', isFav(t.path))

  const title = cleanTitle(t.title)
  $('#pbTitle').textContent = title
  $('#pbArtist').textContent = (t.artist || '未知艺人') + (t.bitrate ? ` · ${t.bitrate}k` : '')
  $('#lpTitle').textContent = title
  $('#lpArtist').textContent = t.artist || '未知艺人'

  setCover($('#pbCover'), '')
  setCover($('#lpCover'), '')
  loadCover(t.path, (url) => {
    setCover($('#pbCover'), url)
    setCover($('#lpCover'), url)
  })

  $$('.track-row').forEach((el) => el.classList.toggle('active', +el.dataset.i === i))

  let lyr = await window.api.lyrics(t.path)
  if (!lyr.lines || !lyr.lines.length) {
    // 没有旁挂/内嵌歌词 → 自动去网易云找一份，并存成 .lrc
    $('#lpSrc').textContent = '正在搜索歌词…'
    const auto = await window.api.autoLyric({
      title: cleanTitle(t.title), artist: t.artist, filePath: t.path,
    })
    if (auto && auto.ok) {
      lyr = { source: 'netease', lines: auto.lines }
      t.hasLrc = true
    }
  }
  state.lines = lyr.lines || []
  // 歌词偏移：有记录用记录；没有就测一次开头静音（等效裁掉多余前奏）
  const savedOff = getOffset(t.path)
  state.offsetMs = savedOff == null ? 0 : savedOff
  if (savedOff == null && state.lines.length) {
    measureLeadSilence(t.path).then((lead) => {
      if (lead == null) return
      if (lead < 150) { setOffset(t.path, 0); return }
      state.offsetMs = Math.round(lead)
      setOffset(t.path, state.offsetMs)
      updateOffsetChip()
      syncLyrics(true)
    }).catch(() => {})
  }
  state.lastUserScrollAt = 0
  state.activeIdx = -2
  $('#lpResume')?.classList.add('hidden')
  $('#lpSrc').textContent =
    lyr.source === 'lrc' ? '旁挂 LRC'
    : lyr.source === 'embedded' ? '内嵌歌词'
    : lyr.source === 'netease' ? '网易云（已存盘）'
    : '无歌词'
  renderLyrics()
}

function renderLyrics() {
  const box = $('#lpLyrics')
  box.innerHTML = ''
  state.activeIdx = -1
  $('#lpEmpty').classList.toggle('hidden', state.lines.length > 0)
  state.lines.forEach((l) => {
    const d = document.createElement('div')
    d.className = 'ly-line'
    if (l.pair && l.pair.length > 1) {
      d.innerHTML = '<div class="en"></div><div class="zh"></div>'
      d.querySelector('.en').textContent = l.pair[0]
      d.querySelector('.zh').textContent = l.pair[1]
    } else {
      d.innerHTML = '<div class="one"></div>'
      d.querySelector('.one').textContent = l.text
    }
    box.appendChild(d)
  })
  state.activeIdx = -2
  syncLyrics(true)
  pushFloat()
}

function syncLyrics(force) {
  if (!state.lines.length) return
  const pane = document.querySelector('.lp-right')
  const box = $('#lpLyrics')
  if (!pane || !box) return

  const ms = audio.currentTime * 1000
  let idx = -1
  for (let i = 0; i < state.lines.length; i++) {
    if (lineTime(state.lines[i]) <= ms + 60) idx = i
    else break
  }

  const kids = box.children
  if (idx !== state.activeIdx) {
    for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('cur', i === idx)
    state.activeIdx = idx
    pushFloat()
  }

  const following = Date.now() - (state.lastUserScrollAt || 0) > 3000
  if (!force && !following) return          // 用户刚滑动过，先不抢

  // 首句（或还没到第一句）→ 顶部对齐；其余居中
  if (idx <= 0) {
    pane.scrollTo({ top: 0, behavior: force ? 'auto' : 'smooth' })
  } else {
    const el = kids[idx]
    if (!el) return
    const top = el.offsetTop - pane.clientHeight / 2 + el.offsetHeight / 2
    pane.scrollTo({ top: Math.max(0, top), behavior: force ? 'auto' : 'smooth' })
  }
  if (force) { $('#lpResume')?.classList.add('hidden'); state.lastUserScrollAt = 0 }
}

/* ---------------- 开头静音测量 + 歌词偏移 ---------------- */
const OFFSET_KEY = (path) => 'lyrOff:' + path

function getOffset(path) {
  const v = parseFloat(localStorage.getItem(OFFSET_KEY(path)) || '')
  return Number.isFinite(v) ? v : null
}
function setOffset(path, ms) {
  localStorage.setItem(OFFSET_KEY(path), String(Math.round(ms)))
}

/**
 * 用 Web Audio 解码音频，测开头静音多长（毫秒）。
 * 取左右声道平均能量，前 30 秒内第一次超过阈值的位置。
 */
async function measureLeadSilence(path) {
  try {
    const res = await fetch(toFileUrl(path))
    const buf = await res.arrayBuffer()
    const AC = window.AudioContext || window.webkitAudioContext
    const ctx = new AC()
    const audio = await ctx.decodeAudioData(buf)
    const sr = audio.sampleRate
    const ch0 = audio.getChannelData(0)
    const ch1 = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null
    const limit = Math.min(ch0.length, Math.floor(sr * 30))
    const TH = 0.012          // 幅度阈值（约 -38dB）
    let i = 0
    for (; i < limit; i++) {
      const v = Math.abs(ch0[i]) + (ch1 ? Math.abs(ch1[i]) : 0)
      if (v > TH) break
    }
    ctx.close()
    return Math.round((i / sr) * 1000)
  } catch (e) {
    return null
  }
}

/* ---------------- 视口偏移应用 ---------------- */
function lineTime(l) {
  return l.t + (state.offsetMs || 0)
}
/* ---------------- 歌词区交互 ---------------- */
function applyLyricPadding() {
  const pane = document.querySelector('.lp-right')
  const box = $('#lpLyrics')
  if (!pane || !box) return
  const pad = Math.max(80, Math.round(pane.clientHeight / 2 - 30))
  box.style.paddingTop = pad + 'px'
  box.style.paddingBottom = pad + 'px'
}
function markUserScroll() {
  state.lastUserScrollAt = Date.now()
  $('#lpResume')?.classList.remove('hidden')
}
function resumeFollow() {
  state.lastUserScrollAt = 0
  $('#lpResume')?.classList.add('hidden')
  syncLyrics(true)
}
function bindLyricsInteraction() {
  const pane = document.querySelector('.lp-right')
  if (!pane) return
  if (!pane.dataset.bound) {
    pane.dataset.bound = '1'
    pane.addEventListener('wheel', markUserScroll, { passive: true })
    pane.addEventListener('touchmove', markUserScroll, { passive: true })
    pane.addEventListener('click', (e) => {
      const el = e.target.closest('.ly-line')
      if (!el) return
      const box = $('#lpLyrics')
      const i = Array.prototype.indexOf.call(box.children, el)
      const line = state.lines[i]
      if (!line) return
      audio.currentTime = line.t / 1000
      if (audio.paused) audio.play().catch(() => {})
      state.lastUserScrollAt = 0
      $('#lpResume')?.classList.add('hidden')
      syncLyrics(true)
    })
    window.addEventListener('resize', () => { applyLyricPadding(); syncLyrics(true) })
  }
  const btn = $('#lpResume')
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1'
    btn.addEventListener('click', resumeFollow)
  }
}

/* ---------------- 悬浮歌词 ---------------- */
function currentLine() {
  const l = state.lines[state.activeIdx]
  if (!l) {
    // 还没到第一句歌词：留空（只显示曲名），避免出现「…」
    return { en: '', zh: state.lines.length ? '' : (state.cur >= 0 ? '无歌词' : '等待播放…') }
  }
  if (l.pair && l.pair.length > 1) return { en: l.pair[0], zh: l.pair[1] }
  return { en: '', zh: l.text }
}
function pushFloat() {
  if (!state.floatOn) return
  const t = state.tracks[state.cur]
  window.api.floatPush({
    title: t ? cleanTitle(t.title) : '',
    artist: t ? (t.artist || '') : '',
    ...currentLine(),
  })
}

/* ---------------- 歌词页 ---------------- */
function updateOffsetChip() {
  const el = $('#lpOff')
  if (!el) return
  const ms = Math.round(state.offsetMs || 0)
  el.textContent = '偏移 ' + (ms > 0 ? '+' : '') + (ms / 1000).toFixed(1) + 's'
  el.style.color = ms ? 'var(--red)' : ''
  el.style.borderColor = ms ? 'var(--red)' : ''
}

function nudgeOffset(deltaMs) {
  const t = state.tracks[state.cur]
  if (!t) return
  state.offsetMs = Math.round((state.offsetMs || 0) + deltaMs)
  setOffset(t.path, state.offsetMs)
  updateOffsetChip()
  syncLyrics(true)
}
function openLyrics() {
  if (state.cur < 0) return
  $('#lyricsPage').classList.remove('hidden')
  bindLyricsInteraction()
  applyLyricPadding()
  state.lastUserScrollAt = 0
  state.activeIdx = -2
  $('#lpResume')?.classList.add('hidden')
  syncLyrics(true)
}
function closeLyrics() {
  $('#lyricsPage').classList.add('hidden')
}

/* ---------------- 事件 ---------------- */
function setPlayIcon(playing) {
  $('#pbPlay').innerHTML = playing ? ICON_PAUSE : ICON_PLAY
}

function bindGlobal() {
  $$('.tb-btns button').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.win
    if (act === 'min') window.api.winMin()
    else if (act === 'max') window.api.winMax()
    else if (act === 'close') window.api.winClose()
  }))

  $$('.nav-item').forEach((el) => el.addEventListener('click', () => { location.hash = el.dataset.route }))
  $('#btnNewPlaylist')?.addEventListener('click', () => { location.hash = '#/playlist/1' })
  $('#btnPickFolder')?.addEventListener('click', async () => {
    const dir = await window.api.pickFolder()
    if (!dir) return
    const lib = await window.api.scan(dir)
    state.tracks = lib.tracks
    state.root = lib.root
    location.hash = '#/local'
    render()
  })

  $('#pbPlay').addEventListener('click', () => {
    if (state.cur < 0 && state.tracks.length) return play(0)
    audio.paused ? audio.play() : audio.pause()
  })
  $('#pbPrev').addEventListener('click', () => play(Math.max(state.cur - 1, 0)))
  $('#pbNext').addEventListener('click', () => play(Math.min(state.cur + 1, state.tracks.length - 1)))
  $('#pbSeek').addEventListener('input', (e) => {
    if (!audio.duration) return
    audio.currentTime = (e.target.value / 1000) * audio.duration
  })
  $('#pbFav').addEventListener('click', () => {
    const t = state.tracks[state.cur]
    if (t) toggleFav(t); else alert('先播一首歌')
  })
  $('#pbAdd').addEventListener('click', (e) => {
    const t = state.tracks[state.cur]
    if (!t) { alert('先播一首歌'); return }
    openAddMenu(t, e.currentTarget)
  })
  $('#pbInfo').addEventListener('click', openLyrics)
  $('#pbLyrics').addEventListener('click', openLyrics)
  $('#pbFloat').addEventListener('contextmenu', (e) => {
    e.preventDefault()
    window.api.floatMenu?.()
  })
  $('#pbFloat').addEventListener('click', async () => {
    const on = await window.api.floatToggle()
    state.floatOn = on
    $('#pbFloat').classList.toggle('active', on)
    if (on) setTimeout(pushFloat, 400)   // 等悬浮窗加载完再推
  })
  $('#lpBack').addEventListener('click', closeLyrics)
  $('#offDown')?.addEventListener('click', () => nudgeOffset(-100))
  $('#offUp')?.addEventListener('click', () => nudgeOffset(100))
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLyrics()
    if (e.key === ' ' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault()
      $('#pbPlay').click()
    }
  })

  audio.addEventListener('timeupdate', () => {
    const dur = audio.duration || 0
    $('#pbCur').textContent = fmt(audio.currentTime)
    $('#pbDur').textContent = fmt(dur)
    if (dur > 0) $('#pbSeek').value = String(Math.round((audio.currentTime / dur) * 1000))
    syncLyrics(false)
  })
  audio.addEventListener('play', () => setPlayIcon(true))
  audio.addEventListener('pause', () => setPlayIcon(false))
  audio.addEventListener('ended', () => {
    if (state.cur + 1 < state.tracks.length) play(state.cur + 1)
  })

  // 悬浮歌词窗发来的 上一曲/下一曲
  window.api.onPlayerCmd?.((cmd) => {
    if (cmd === 'prev') play(Math.max(state.cur - 1, 0))
    else if (cmd === 'next') play(Math.min(state.cur + 1, state.tracks.length - 1))
  })

  setPlayIcon(false)
}

/* ---------------- 启动 ---------------- */
;(async function init() {
  bindGlobal()
  if (!location.hash) location.hash = '#/home'
  window.addEventListener('hashchange', render)

  try {
    const info = await window.api.info()
    state.root = info.root
    $('#pbVer').textContent = `Electron ${info.electron} · Chromium ${String(info.chrome).split('.')[0]}`
    const lib = await window.api.scan(info.root)
    state.tracks = lib.tracks
    state.root = lib.root
  } catch (e) {
    console.warn('扫描失败', e)
  }
  renderSidebar()
  render()
})()
