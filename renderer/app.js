const $ = (s) => document.querySelector(s)
const audio = $('#audio')
const listEl = $('#list')
const lyricsEl = $('#lyrics')

let tracks = []
let cur = -1
let lines = []
let activeIdx = -1

/* ---------- 工具 ---------- */
// 去掉「001-」「01.」这类序号前缀（仅展示用）
const cleanTitle = (t) => String(t || '').replace(/^\d{1,3}\s*[-_.、)\]]\s*/, '').trim() || String(t || '')
const fmt = (s) => {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
function toFileUrl(p) {
  const norm = String(p).replace(/\\/g, '/')
  return 'file:///' + norm.split('/').map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join('/')
}

/* ---------- 曲库 ---------- */
async function scan(dir) {
  $('#status').textContent = '扫描中…'
  try {
    const r = await window.api.scan(dir)
    tracks = r.tracks
    $('#status').textContent = `${tracks.length} 首 · ${r.root}`
    renderList()
  } catch (e) {
    $('#status').textContent = '扫描失败：' + e.message
  }
}

function renderList() {
  listEl.innerHTML = ''
  tracks.forEach((t, i) => {
    const d = document.createElement('div')
    d.className = 'track'
    d.dataset.i = i
    d.innerHTML = `<div class="t"></div><div class="a"></div><div class="d"></div>`
    d.querySelector('.t').textContent = cleanTitle(t.title)
    d.querySelector('.a').textContent = t.artist || '未知艺人'
    d.querySelector('.d').textContent = fmt(t.duration)
    if (t.hasLrc) d.querySelector('.t').classList.add('has-lrc')
    d.addEventListener('click', () => play(i))
    listEl.appendChild(d)
  })
}

/* ---------- 播放 ---------- */
async function play(i) {
  if (i < 0 || i >= tracks.length) return
  cur = i
  const t = tracks[i]
  document.querySelectorAll('.track').forEach((el) => el.classList.toggle('active', +el.dataset.i === i))

  audio.src = toFileUrl(t.path)
  audio.play().catch((e) => { $('#status').textContent = '播放失败：' + e.message })

  $('#title').textContent = cleanTitle(t.title)
  $('#artist').textContent = t.artist || '未知艺人'

  const lyr = await window.api.lyrics(t.path)
  lines = lyr.lines || []
  $('#lyricsSrc').textContent =
    lyr.source === 'lrc' ? '旁挂 LRC' : lyr.source === 'embedded' ? '内嵌歌词' : '无歌词'
  renderLyrics()
}

function renderLyrics() {
  lyricsEl.innerHTML = ''
  activeIdx = -1
  $('#empty').classList.toggle('show', lines.length === 0)
  lines.forEach((l) => {
    const d = document.createElement('div')
    d.className = 'line'
    if (l.pair && l.pair.length > 1) {
      d.innerHTML = '<div class="en"></div><div class="zh"></div>'
      d.querySelector('.en').textContent = l.pair[0]
      d.querySelector('.zh').textContent = l.pair[1]
    } else {
      d.innerHTML = '<div class="one"></div>'
      d.querySelector('.one').textContent = l.text
    }
    lyricsEl.appendChild(d)
  })
  syncLyrics(true)
}

function syncLyrics(force) {
  if (!lines.length) return
  const ms = audio.currentTime * 1000
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= ms + 60) idx = i
    else break
  }
  if (idx === activeIdx && !force) return
  activeIdx = idx
  const kids = lyricsEl.children
  for (let i = 0; i < kids.length; i++) kids[i].classList.toggle('cur', i === idx)
  const el = kids[idx]
  if (el) {
    const top = el.offsetTop - lyricsEl.clientHeight * 0.42 + el.offsetHeight / 2
    lyricsEl.scrollTo({ top: Math.max(0, top), behavior: force ? 'auto' : 'smooth' })
  }
}

/* ---------- 事件 ---------- */
audio.addEventListener('timeupdate', () => {
  const dur = audio.duration || 0
  $('#clock').textContent = `${fmt(audio.currentTime)} / ${fmt(dur)}`
  if (dur > 0) $('#seek').value = String(Math.round((audio.currentTime / dur) * 1000))
  syncLyrics(false)
})
audio.addEventListener('play', () => { $('#btnPlay').textContent = '⏸' })
audio.addEventListener('pause', () => { $('#btnPlay').textContent = '▶' })
audio.addEventListener('ended', () => { if (cur + 1 < tracks.length) play(cur + 1) })

$('#btnPlay').addEventListener('click', () => {
  if (cur < 0 && tracks.length) return play(0)
  audio.paused ? audio.play() : audio.pause()
})
$('#btnPrev').addEventListener('click', () => play(cur > 0 ? cur - 1 : 0))
$('#btnNext').addEventListener('click', () => play(Math.min(cur + 1, tracks.length - 1)))
$('#seek').addEventListener('input', (e) => {
  if (!audio.duration) return
  audio.currentTime = (e.target.value / 1000) * audio.duration
})
$('#btnFolder').addEventListener('click', async () => {
  const dir = await window.api.pickFolder()
  if (dir) scan(dir)
})

/* ---------- 启动 ---------- */
;(async function init() {
  const info = await window.api.info()
  $('#ver').textContent = `Electron ${info.electron} · Chromium ${info.chrome.split('.')[0]}`
  await scan(info.root)
})()
