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
    const kw = [song.name, song.artist].filter(Boolean).join(' ')
    search.voices = await window.api.searchVoices(kw)
  } catch (e) {
    search.err = '声音搜索失败：' + (e.message || e)
  }
  search.loading = false
  render()
}

async function togglePreview(idx) {
  const v = search.voices[idx]
  if (!v) return
  const a = $('#previewAudio')
  if (search.playingVoiceId === v.voiceId) {
    a.pause()
    search.playingVoiceId = null
    render()
    return
  }
  try {
    const url = await window.api.preview(v.mainTrackId)
    if (!url) { search.err = '拿不到试听地址'; render(); return }
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
    search.downloading[v.voiceId] = '已保存'
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

function viewLocal() {
  if (!state.tracks.length) {
    return `<div class="page-title">本地音乐</div>
      <div class="page-sub">${esc(state.root)}</div>
      <div class="empty-note"><div class="big">还没有歌曲</div><div>扫描目录为空，或标签读取失败</div></div>`
  }
  const rows = state.tracks.map((t, i) => `
    <div class="track-row ${i === state.cur ? 'active' : ''}" data-i="${i}">
      <div class="idx">${i + 1}</div>
      <div class="cov" data-cov="${i}"></div>
      <div class="tt">${esc(cleanTitle(t.title))}${t.hasLrc ? '<span class="badge">词</span>' : ''}</div>
      <div class="ar">${esc(t.artist || '未知艺人')}</div>
      <div class="du">${fmt(t.duration)}</div>
    </div>`).join('')
  return `<div class="page-title">本地音乐</div>
    <div class="page-sub">共 ${state.tracks.length} 首 · ${esc(state.root)}</div>
    <div class="tracklist">${rows}</div>`
}

function viewEmpty(title, desc) {
  return `<div class="page-title">${esc(title)}</div>
    <div class="page-sub">${esc(desc)}</div>
    <div class="empty-note"><div class="big">这里还是空的</div><div>功能待接入</div></div>`
}

const routes = {
  '#/home': viewHome,
  '#/liked': () => viewEmpty('我喜欢的音乐', '收藏的歌曲会出现在这里'),
  '#/recent': () => viewEmpty('最近播放', '最近听过的歌会出现在这里'),
  '#/local': viewLocal,
  '#/playlist/1': () => viewEmpty('新建歌单', '这个歌单还没有歌曲'),
  '#/playlist/2': () => viewEmpty('我的歌单', '这个歌单还没有歌曲'),
}

function render() {
  const hash = location.hash || '#/home'
  const fn = routes[hash] || viewHome
  $('#view').innerHTML = fn()
  $('#view').scrollTop = 0
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
  if (hash === '#/local') {
    $$('.track-row').forEach((el) => el.addEventListener('click', () => play(+el.dataset.i)))
    // 懒加载列表封面
    $$('[data-cov]').forEach((el) => {
      const t = state.tracks[+el.dataset.cov]
      if (t) loadCover(t.path, (url) => setCover(el, url))
    })
  }
}

/* ---------------- 播放 ---------------- */
async function play(i) {
  if (i < 0 || i >= state.tracks.length) return
  state.cur = i
  const t = state.tracks[i]

  audio.src = toFileUrl(t.path)
  audio.play().catch((e) => console.warn('播放失败', e))

  const title = cleanTitle(t.title)
  $('#pbTitle').textContent = title
  $('#pbArtist').textContent = t.artist || '未知艺人'
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
    if (state.lines[i].t <= ms + 60) idx = i
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
  render()
})()
