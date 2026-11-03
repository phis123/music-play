/* music-play · 渲染进程：路由 / 视图 / 播放条 / 歌词页 */
const $ = (s) => document.querySelector(s)
const $$ = (s) => Array.from(document.querySelectorAll(s))
const audio = $('#audio')

const state = {
  tracks: [],
  cur: -1,
  lines: [],
  activeIdx: -1,
  searchTab: 'local',
  root: '',
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

/* ---------------- 视图 ---------------- */
function viewHome() {
  return `
    <div class="home">
      <div class="search-wrap">
        <label class="search-box">
          <span>🔍</span>
          <input id="searchInput" type="text" placeholder="搜索歌曲 / 歌手 / 播客">
        </label>
      </div>
      <div class="search-tabs">
        <button class="tab ${state.searchTab === 'local' ? 'active' : ''}" data-tab="local">本地库</button>
        <button class="tab ${state.searchTab === 'podcast' ? 'active' : ''}" data-tab="podcast">播客</button>
      </div>
      <div class="search-hint">
        ${state.searchTab === 'local' ? '输入关键词搜索本地曲库（功能待接入）' : '输入关键词搜索网易云播客声音（功能待接入）'}
      </div>
    </div>`
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
      <div class="cov"></div>
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

  // 侧栏选中态
  $$('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.route === hash))

  // 视图内事件
  if (hash === '#/home') {
    const input = $('#searchInput')
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') console.log('搜索（待接入）:', input.value)
    })
    $$('.tab').forEach((el) => el.addEventListener('click', () => {
      state.searchTab = el.dataset.tab
      render()
    }))
  }
  if (hash === '#/local') {
    $$('.track-row').forEach((el) => el.addEventListener('click', () => play(+el.dataset.i)))
  }
}

/* ---------------- 播放 ---------------- */
async function play(i) {
  if (i < 0 || i >= state.tracks.length) return
  state.cur = i
  const t = state.tracks[i]

  audio.src = toFileUrl(t.path)
  audio.play().catch((e) => console.warn('播放失败', e))

  $('#pbTitle').textContent = cleanTitle(t.title)
  $('#pbArtist').textContent = t.artist || '未知艺人'
  $('#lpTitle').textContent = cleanTitle(t.title)
  $('#lpArtist').textContent = t.artist || '未知艺人'

  if (location.hash === '#/local' || !location.hash) render()
  else $$('.track-row').forEach((el) => el.classList.toggle('active', +el.dataset.i === i))

  const lyr = await window.api.lyrics(t.path)
  state.lines = lyr.lines || []
  const label = lyr.source === 'lrc' ? '旁挂 LRC' : lyr.source === 'embedded' ? '内嵌歌词' : '无歌词'
  $('#lpSrc').textContent = label
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
  syncLyrics(true)
}

function syncLyrics(force) {
  if (!state.lines.length) return
  const ms = audio.currentTime * 1000
  let idx = -1
  for (let i = 0; i < state.lines.length; i++) {
    if (state.lines[i].t <= ms + 60) idx = i
    else break
  }
  if (idx === state.activeIdx && !force) return
  state.activeIdx = idx
  const box = $('#lpLyrics')
  const kids = box.children
  for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('cur', i === idx)
  const el = kids[idx]
  if (el) {
    const top = el.offsetTop - box.clientHeight * 0.38 + el.offsetHeight / 2
    box.parentElement.scrollTo({ top: Math.max(0, top), behavior: force ? 'auto' : 'smooth' })
  }
}

/* ---------------- 歌词页 ---------------- */
function openLyrics() {
  if (state.cur < 0) return
  $('#lyricsPage').classList.remove('hidden')
  syncLyrics(true)
}
function closeLyrics() {
  $('#lyricsPage').classList.add('hidden')
}

/* ---------------- 事件绑定 ---------------- */
function bindGlobal() {
  // 窗口按钮
  $$('.tb-btns button').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.win
    if (act === 'min') window.api.winMin()
    else if (act === 'max') window.api.winMax()
    else if (act === 'close') window.api.winClose()
  }))

  // 侧栏导航
  $$('.nav-item').forEach((el) => el.addEventListener('click', () => { location.hash = el.dataset.route }))
  $('#btnNewPlaylist')?.addEventListener('click', () => { location.hash = '#/playlist/1' })

  // 播放条
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
  $('#lpBack').addEventListener('click', closeLyrics)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLyrics()
    if (e.key === ' ' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault()
      $('#pbPlay').click()
    }
  })

  // 音频事件
  audio.addEventListener('timeupdate', () => {
    const dur = audio.duration || 0
    $('#pbCur').textContent = fmt(audio.currentTime)
    $('#pbDur').textContent = fmt(dur)
    if (dur > 0) $('#pbSeek').value = String(Math.round((audio.currentTime / dur) * 1000))
    syncLyrics(false)
  })
  audio.addEventListener('play', () => { $('#pbPlay').textContent = '⏸' })
  audio.addEventListener('pause', () => { $('#pbPlay').textContent = '▶' })
  audio.addEventListener('ended', () => {
    if (state.cur + 1 < state.tracks.length) play(state.cur + 1)
  })
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
