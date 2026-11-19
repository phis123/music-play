/* music-play · 渲染进程：路由 / 视图 / 播放条 / 歌词页 */
const $ = (s) => document.querySelector(s)
const $$ = (s) => Array.from(document.querySelectorAll(s))
const audio = $('#audio')

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a.9.9 0 0 0 1.38.77l10-6.4a.9.9 0 0 0 0-1.54l-10-6.4A.9.9 0 0 0 8 5.6z"/></svg>'
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.2" y="5" width="3.4" height="14" rx="1.4"/><rect x="13.4" y="5" width="3.4" height="14" rx="1.4"/></svg>'

const MODE_ICONS = {
  loop: '<path d="M17 2l4 4-4 4V7H7a3 3 0 0 0-3 3v2H2v-2a5 5 0 0 1 5-5h10V2zM7 22l-4-4 4-4v3h10a3 3 0 0 0 3-3v-2h2v2a5 5 0 0 1-5 5H7v3z"/>',
  shuffle: '<path d="M17 3.6l3.4 3.4-3.4 3.4V8.3h-1.7c-1.2 0-2 .5-2.8 1.6l-.9 1.2-1.2-1.6.7-1C12.3 6.7 13.6 6 15.3 6H17V3.6zM3 6h2.3c1.7 0 3 .7 4.2 2.2l5.1 6.9c.8 1.1 1.6 1.6 2.8 1.6H20v-2.1l3.4 3.4L20 21.4v-2.7h-2.6c-1.7 0-3-.7-4.2-2.2L8.1 9.6C7.3 8.5 6.5 8 5.3 8H3V6zm0 10h2.3c.5 0 .9-.1 1.3-.3l1.3 1.7c-.8.4-1.7.6-2.6.6H3v-2z"/>',
  one: '<path d="M17 2l4 4-4 4V7H7a3 3 0 0 0-3 3v2H2v-2a5 5 0 0 1 5-5h10V2zM7 22l-4-4 4-4v3h10a3 3 0 0 0 3-3v-2h2v2a5 5 0 0 1-5 5H7v3zm4.2-13h1.8v6h-1.6v-4.3l-1.2.8-.7-1.1 1.7-1.4z"/>',
}

const state = {
  tracks: [],
  cur: -1,
  queuePaths: [],
  qPos: -1,
  hist: [],
  mode: (function () { try { return localStorage.getItem('desk:mode') || 'loop' } catch { return 'loop' } })(),
  vol: (function () { try { const v = parseFloat(localStorage.getItem('desk:vol')); return Number.isFinite(v) ? v : 1 } catch { return 1 } })(),
  muted: false,
  lines: [],
  activeIdx: -1,
  lastUserScrollAt: 0,
  floatOn: false,
  offsetMs: 0,
  searchTab: 'local',
  root: '',
  sheetKind: '',
  srcSwitch: { track: null, kw: '', loading: false, cands: [], err: '', prevId: '', busyId: '', savedTime: 0, wasPlaying: false },
  theme: (function () { try { return localStorage.getItem('desk:theme') || 'auto' } catch { return 'auto' } })(),
  listFilter: '',
  listSort: 'default',
  healthTab: 'dup',
  task: { active: false, kind: '', title: '', sub: '', done: 0, total: 0, ok: 0, fail: 0, errors: [], indet: false, stopLabel: '' },
  // 0.4.4：主设置（音量平衡 / 随机策略 / 歌词字号与配色）+ 悬浮歌词样式 + 单曲设置
  normEnabled: (function () { try { const v = localStorage.getItem('desk:normEnabled'); return v == null ? true : v === '1' } catch { return true } })(),
  normPreset: (function () { try { return localStorage.getItem('desk:normPreset') || 'standard' } catch { return 'standard' } })(),
  randomStrategy: (function () { try { return localStorage.getItem('desk:randomStrategy') || 'no-repeat' } catch { return 'no-repeat' } })(),
  shufflePlayed: new Set(),
  lrcSize: (function () { try { return Math.min(28, Math.max(14, +(localStorage.getItem('desk:lrcSize') || 18))) } catch { return 18 } })(),
  lrcColor: (function () { try { return localStorage.getItem('desk:lrcColor') || '#ec4141' } catch { return '#ec4141' } })(),
  floatColor: (function () { try { return localStorage.getItem('lyColor') || '#ffffff' } catch { return '#ffffff' } })(),
  floatSize: (function () { try { return Math.min(40, Math.max(14, +(localStorage.getItem('lySize') || 22))) } catch { return 22 } })(),
  floatBgOpacity: (function () { try { return Math.min(80, Math.max(0, +(localStorage.getItem('lyBgOpacity') || 0))) } catch { return 0 } })(),
  floatLocked: false,
  lpMiniOpen: false,
}

/* ---------------- 音量平衡 WebAudio 管线 + 单曲增益/播放计数/歌词外观 ---------------- */
let _audioCtx = null
let _gainNode = null
let _compNode = null

function ensureWebAudioGraph() {
  if (_audioCtx && _gainNode) return true
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC || !audio) return false
    _audioCtx = new AC()
    const src = _audioCtx.createMediaElementSource(audio)
    _gainNode = _audioCtx.createGain()
    _compNode = _audioCtx.createDynamicsCompressor()
    // 透明防破音软限幅器参数（仅在放大偏小音源遇到瞬态鼓点峰值时防削波）
    _compNode.threshold.value = -2.5
    _compNode.knee.value = 6.0
    _compNode.ratio.value = 12.0
    _compNode.attack.value = 0.003
    _compNode.release.value = 0.16
    src.connect(_gainNode)
    _gainNode.connect(_compNode)
    _compNode.connect(_audioCtx.destination)
    return true
  } catch (e) {
    console.warn('WebAudio 管线初始化失败:', e)
    return false
  }
}

function getTrackGainMap() {
  try { return JSON.parse(localStorage.getItem('desk:trackGainMap') || '{}') } catch { return {} }
}
function getUserTrackGain(path) {
  if (!path) return 0
  const m = getTrackGainMap()
  const v = Number(m[path])
  return Number.isFinite(v) ? Math.max(-12, Math.min(12, Math.round(v * 10) / 10)) : 0
}
function setUserTrackGain(path, db) {
  if (!path) return
  const m = getTrackGainMap()
  const val = Math.max(-12, Math.min(12, Math.round((+db || 0) * 10) / 10))
  if (Math.abs(val) < 0.05) delete m[path]
  else m[path] = val
  try { localStorage.setItem('desk:trackGainMap', JSON.stringify(m)) } catch { }
}
function clearAllUserTrackGains() {
  try { localStorage.removeItem('desk:trackGainMap') } catch { }
}

function getPlayCounts() {
  try { return JSON.parse(localStorage.getItem('desk:playCounts') || '{}') } catch { return {} }
}
function getPlayCount(path) {
  if (!path) return 0
  return +(getPlayCounts()[path] || 0)
}
function incPlayCount(path) {
  if (!path) return
  const m = getPlayCounts()
  m[path] = (m[path] || 0) + 1
  try { localStorage.setItem('desk:playCounts', JSON.stringify(m)) } catch { }
}

function getCurrentTrackEffectiveGain() {
  const t = state.tracks[state.cur]
  if (!t) return { autoDb: 0, manualDb: 0, totalDb: 0 }
  const autoDb = Number.isFinite(Number(t.gainDb)) ? Number(t.gainDb) : 0
  const manualDb = getUserTrackGain(t.path)
  if (!state.normEnabled) {
    const tot = Math.max(-15, Math.min(15, Math.round(manualDb * 10) / 10))
    return { autoDb, manualDb, totalDb: tot }
  }
  const presetOff = state.normPreset === 'night' ? -2.5 : state.normPreset === 'boost' ? 2.0 : 0
  const tot = Math.max(-15, Math.min(15, Math.round((autoDb + presetOff + manualDb) * 10) / 10))
  return { autoDb, manualDb, totalDb: tot }
}

function applyCurrentTrackGain() {
  const { autoDb, manualDb, totalDb } = getCurrentTrackEffectiveGain()
  const linear = Math.pow(10, totalDb / 20)
  if (ensureWebAudioGraph() && _gainNode) {
    if (_audioCtx && _audioCtx.state === 'suspended' && !audio.paused) {
      _audioCtx.resume().catch(() => {})
    }
    try {
      _gainNode.gain.setTargetAtTime(linear, _audioCtx.currentTime, 0.03)
    } catch {
      _gainNode.gain.value = linear
    }
  }
  const badge = $('#lpGainBadge')
  if (badge) {
    const sign = totalDb > 0 ? '+' : ''
    badge.textContent = (state.normEnabled || manualDb !== 0)
      ? `均衡 ${sign}${totalDb.toFixed(1)}dB`
      : '均衡 关闭'
    badge.style.color = manualDb !== 0 ? 'var(--red)' : ''
  }
  const t = state.tracks[state.cur]
  if (t && $('#pbArtist')) {
    const eqTxt = (state.normEnabled && Math.abs(totalDb) >= 0.1) || manualDb !== 0
      ? ` · 均衡 ${totalDb > 0 ? '+' : ''}${totalDb.toFixed(1)}dB`
      : ''
    $('#pbArtist').textContent = (t.artist || '未知艺人') + (t.bitrate ? ` · ${t.bitrate}k` : '') + eqTxt
  }
  return { autoDb, manualDb, totalDb }
}

function applyLyricsStyle() {
  document.documentElement.style.setProperty('--lrc-size', (state.lrcSize || 18) + 'px')
  document.documentElement.style.setProperty('--lrc-accent', state.lrcColor || '#ec4141')
  try {
    localStorage.setItem('desk:lrcSize', String(state.lrcSize || 18))
    localStorage.setItem('desk:lrcColor', state.lrcColor || '#ec4141')
  } catch { }
}

function pushFloatStyle() {
  try {
    localStorage.setItem('lyColor', state.floatColor)
    localStorage.setItem('lySize', String(state.floatSize))
    localStorage.setItem('lyBgOpacity', String(state.floatBgOpacity))
  } catch { }
  window.api?.floatStyle?.({
    color: state.floatColor,
    size: state.floatSize,
    bgOpacity: state.floatBgOpacity,
  })
}

/* ---------------- 换页主线程让出 + 全局任务进度与报错中心 (0.4.3) ---------------- */
let _navYieldUntil = 0
let _impChunkRaf = 0
function markNavTransition() {
  _navYieldUntil = Date.now() + 240
  if (_impChunkRaf) { cancelAnimationFrame(_impChunkRaf); _impChunkRaf = 0 }
}
async function waitNavYield() {
  const rem = _navYieldUntil - Date.now()
  if (rem > 0) await new Promise((r) => setTimeout(r, rem))
}

let _taskAutoHideTimer = null
function startTask(kind, title, sub, total, indet, stopLabel) {
  clearTimeout(_taskAutoHideTimer)
  state.task = {
    active: true,
    kind: kind || '',
    title: title || '正在处理…',
    sub: sub || '',
    done: 0,
    total: total || 0,
    ok: 0,
    fail: 0,
    errors: [],
    indet: !!indet,
    stopLabel: stopLabel || '',
  }
  updateTaskBanner()
}

function stepTask(done, sub) {
  const tk = state.task
  if (done != null) tk.done = done
  if (sub != null) tk.sub = sub
  updateTaskBanner()
}

function recordTaskError(name, reason) {
  const tk = state.task
  tk.fail = (tk.fail || 0) + 1
  tk.errors.push({ name: String(name || '未知项'), reason: String(reason || '未知错误') })
  updateTaskBanner()
}

function finishTask(title, sub, autoHideMs) {
  const tk = state.task
  tk.active = false
  tk.indet = false
  tk.done = tk.total || 1
  tk.total = tk.total || 1
  if (title) tk.title = title
  if (sub != null) tk.sub = sub
  updateTaskBanner()
  clearTimeout(_taskAutoHideTimer)
  if (!tk.errors.length && autoHideMs !== 0) {
    _taskAutoHideTimer = setTimeout(() => {
      if (!state.task.active && !state.task.errors.length) dismissTask()
    }, autoHideMs || 4200)
  }
}

function dismissTask() {
  clearTimeout(_taskAutoHideTimer)
  state.task = { active: false, kind: '', title: '', sub: '', done: 0, total: 0, ok: 0, fail: 0, errors: [], indet: false, stopLabel: '' }
  const box = document.getElementById('taskBanner')
  if (box) { box.classList.add('hidden'); box.innerHTML = '' }
}

function updateTaskBanner() {
  const box = document.getElementById('taskBanner')
  if (!box) return
  const tk = state.task
  if (!tk.active && !tk.title) {
    box.classList.add('hidden')
    return
  }
  box.classList.remove('hidden')
  box.classList.toggle('has-err', tk.errors.length > 0 && !tk.active)
  const pct = tk.total > 0 ? Math.min(100, Math.round((tk.done * 100) / tk.total)) : (tk.active ? 35 : 100)
  const errBtn = tk.errors.length
    ? `<button class="task-btn warn" data-task-err="1">报错详情 (${tk.errors.length})</button>`
    : ''
  const stopBtn = tk.active && tk.stopLabel
    ? `<button class="task-btn" data-task-stop="1">${esc(tk.stopLabel)}</button>`
    : ''
  const closeBtn = !tk.active
    ? `<button class="task-btn" data-task-dismiss="1">关闭</button>`
    : ''

  if (!box.querySelector('.task-top')) {
    box.innerHTML = `
      <div class="task-top">
        <div style="flex:1;min-width:0">
          <div class="task-title" id="tbTitle"></div>
          <div class="task-sub" id="tbSub"></div>
        </div>
        <div class="task-acts" id="tbActs"></div>
      </div>
      <div class="task-track"><div class="task-bar" id="tbBar"></div></div>`
  }
  const tEl = document.getElementById('tbTitle')
  const sEl = document.getElementById('tbSub')
  const aEl = document.getElementById('tbActs')
  const bEl = document.getElementById('tbBar')
  if (tEl) tEl.textContent = tk.title + (tk.total > 0 && tk.active ? ` (${tk.done}/${tk.total})` : '')
  if (sEl) sEl.textContent = tk.sub || ''
  if (aEl) aEl.innerHTML = errBtn + stopBtn + closeBtn
  if (bEl) {
    bEl.classList.toggle('indet', !!tk.indet && tk.active)
    bEl.style.width = pct + '%'
  }
}

function openTaskErrorDialog() {
  state.sheetKind = 'taskerr'
  renderSheetDialog()
}

/* ---------------- 主题与封面氛围色引擎 (Phase 2) ---------------- */
function resolveTheme(mode) {
  if (mode === 'dark' || mode === 'light') return mode
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch { return 'light' }
}
function applyTheme(mode) {
  if (mode) state.theme = mode
  try { localStorage.setItem('desk:theme', state.theme) } catch { }
  const eff = resolveTheme(state.theme)
  document.documentElement.dataset.theme = eff
  const lbl = $('#themeLabel')
  if (lbl) {
    lbl.textContent = '外观：' + (state.theme === 'dark' ? '深色' : state.theme === 'light' ? '浅色' : '跟随系统')
  }
}
function cycleTheme() {
  const next = state.theme === 'auto' ? 'dark' : state.theme === 'dark' ? 'light' : 'auto'
  applyTheme(next)
  toast('已切换外观：' + (next === 'dark' ? '深色模式' : next === 'light' ? '浅色模式' : '跟随系统'))
}

const _ambientCache = new Map()
function extractAmbientColor(url) {
  if (!url) {
    document.documentElement.style.setProperty('--ambient-rgb', '236, 65, 65')
    return
  }
  if (_ambientCache.has(url)) {
    document.documentElement.style.setProperty('--ambient-rgb', _ambientCache.get(url))
    return
  }
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = function () {
      try {
        const c = document.createElement('canvas')
        c.width = 16; c.height = 16
        const ctx = c.getContext('2d')
        ctx.drawImage(img, 0, 0, 16, 16)
        const data = ctx.getImageData(0, 0, 16, 16).data
        let rSum = 0, gSum = 0, bSum = 0, wSum = 0
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
          if (a < 128) continue
          const max = Math.max(r, g, b), min = Math.min(r, g, b)
          const lum = (max + min) / 2
          if (lum < 20 || lum > 238) continue
          const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255))
          const w = 1 + sat * 3
          rSum += r * w; gSum += g * w; bSum += b * w; wSum += w
        }
        let rgb = '236, 65, 65'
        if (wSum > 0) {
          rgb = `${Math.round(rSum / wSum)}, ${Math.round(gSum / wSum)}, ${Math.round(bSum / wSum)}`
        }
        _ambientCache.set(url, rgb)
        document.documentElement.style.setProperty('--ambient-rgb', rgb)
      } catch { }
    }
    img.src = url
  } catch { }
}

/* ---------------- 工具 ---------------- */
const fmt = (s) => {
  if (!isFinite(s) || s < 0) s = 0
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
const cleanTitle = (t) => String(t || '').replace(/^\d{1,3}\s*[-_.、)\]]\s*/, '').trim() || String(t || '')
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const toFileUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/').split('/')
  .map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg))).join('/')

/* ---------------- 最近播放 ---------------- */
const RECENT_KEY = 'recentTracks'

/* ---------------- 轻提示（替代 alert：不阻塞、自动消失） ---------------- */
let __toastHost = null
function toast(msg, ms) {
  if (!__toastHost) {
    __toastHost = document.createElement('div')
    __toastHost.id = 'toastHost'
    document.body.appendChild(__toastHost)
  }
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = String(msg == null ? '' : msg)
  __toastHost.appendChild(el)
  setTimeout(() => {
    el.classList.add('out')
    setTimeout(() => el.remove(), 240)
  }, ms || 2600)
}
/* ---------------- 通用对话框（Electron 不支持 window.prompt，必须自己实现） ---------------- */
function askDialog(opt) {
  return new Promise((resolve) => {
    const dlg = $('#askDlg')
    if (!dlg) { resolve(opt.input ? null : false); return }
    dlg.querySelector('.ask-title').textContent = opt.title || ''
    const msg = dlg.querySelector('.ask-msg')
    msg.textContent = opt.message || ''
    msg.style.display = opt.message ? '' : 'none'
    const inp = dlg.querySelector('.ask-input')
    inp.value = opt.value || ''
    inp.style.display = opt.input ? '' : 'none'
    dlg.querySelector('.ask-btn:not(.ghost)').textContent = opt.okText || '确定'
    const onClose = () => {
      dlg.removeEventListener('close', onClose)
      const ok = dlg.returnValue === 'ok'
      resolve(ok ? (opt.input ? inp.value.trim() : true) : (opt.input ? null : false))
    }
    dlg.returnValue = ''
    dlg.addEventListener('close', onClose)
    if (dlg.open) dlg.close()
    dlg.showModal()
    if (opt.input) setTimeout(() => { inp.focus(); inp.select() }, 30)
  })
}
const askText = (title, value) => askDialog({ title, input: true, value })
const askConfirm = (text) => {
  // confirm 的文案一般带换行：首行当标题，其余当说明，排版更像原生确认框
  const parts = String(text || '').split('\n')
  const title = parts.shift() || ''
  return askDialog({ title, message: parts.join('\n'), okText: '确定' })
}
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
const COVER_CACHE_MAX = 240
/** 写入封面缓存并做 LRU 淘汰，避免几千首曲库把渲染进程内存吃满 */
function cacheCover(path, url) {
  if (!path) return url
  if (coverCache.has(path)) coverCache.delete(path)
  coverCache.set(path, url)
  if (coverCache.size > COVER_CACHE_MAX) {
    const first = coverCache.keys().next().value
    if (first !== undefined) coverCache.delete(first)
  }
  return url
}

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
      cacheCover(job.path, url)
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

function getSearchHist() {
  try { return JSON.parse(localStorage.getItem('desk:searchHist') || '[]') } catch { return [] }
}
function pushSearchHist(kw) {
  kw = String(kw || '').trim()
  if (!kw) return
  const list = getSearchHist().filter((x) => x !== kw)
  list.unshift(kw)
  try { localStorage.setItem('desk:searchHist', JSON.stringify(list.slice(0, 10))) } catch { }
}
function clearSearchHist() {
  try { localStorage.removeItem('desk:searchHist') } catch { }
}
function matchLocalTrack(t, kw) {
  const k = normKey(kw)
  if (!k) return true
  const hay = normKey([t.title, t.artist, t.album, String(t.path || '').split(/[\\/]/).pop()].join(' '))
  return hay.includes(k)
}

function viewSearchBody() {
  const kw = String(search.kw || '').trim()
  const localHits = kw ? state.tracks.filter((t) => matchLocalTrack(t, kw)) : []
  const localSec = kw
    ? `<div class="result-head" style="margin-top:10px">
         <span class="result-title">本地曲库匹配 (${localHits.length})</span>
       </div>
       ${localHits.length
         ? `<div class="tracklist" style="margin-bottom:16px">${localHits.slice(0, 12).map((t, i) => trackRowHtml(t, state.tracks.indexOf(t), i + 1)).join('')}</div>`
         : `<div class="search-hint" style="padding:12px 0">本地曲库无匹配</div>`}`
    : ''

  if (search.loading) return localSec + `<div class="search-hint">正在搜索网易云曲库…</div>`
  if (search.err) return localSec + `<div class="search-hint" style="color:var(--red)">${esc(search.err)}</div>`

  // 播客 Tab：直接列声音
  if (search.tab === 'voice') {
    if (!search.voices.length) return localSec + `<div class="search-hint">按回车或点「搜索」，查找网易云播客里的声音</div>`
    return localSec + voiceListHtml()
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

  if (!search.songs.length) return localSec + `<div class="search-hint">输入关键词实时过滤本地曲库，按回车搜网易云在线歌曲</div>`

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
  return localSec + `<div class="result-head"><span class="result-title">在线搜索结果 (${search.songs.length})</span></div><div class="songlist">${rows}</div>`
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
  const hist = getSearchHist()
  const histHtml = hist.length
    ? `<div class="search-hist" id="searchHistBar">
        <span style="font-size:11.5px;color:var(--dim)">最近搜索：</span>
        ${hist.map((h) => `<button class="search-pill" data-qhist="${esc(h)}">${esc(h)}</button>`).join('')}
        <button class="btn-ghost" data-qhist-clear="1" style="font-size:11.5px;margin-left:auto">清空</button>
      </div>`
    : '<div id="searchHistBar"></div>'

  return `
    <div class="home">
      <div class="search-wrap">
        <label class="search-box">
          <span>🔍</span>
          <input id="searchInput" type="search" placeholder="搜索本地曲库 / 网易云歌曲与播客声音"
                 value="${esc(search.kw)}">
          <button id="btnSearch">搜在线</button>
        </label>
      </div>
      ${histHtml}
      <div class="search-tabs">${tabs}</div>
      <div id="homeSearchBody">${viewSearchBody()}</div>
    </div>`
}

function updateHomeSearchBody() {
  const box = $('#homeSearchBody')
  if (!box) { render(); return }
  box.innerHTML = viewSearchBody()
  bindHomeBodyEvents()
  $$('#homeSearchBody [data-rowcov]').forEach((el) => {
    const t = state.tracks[+el.dataset.rowcov]
    if (t) loadCover(t.path, (url) => setCover(el, url))
  })
}

function bindHomeBodyEvents() {
  $$('#homeSearchBody [data-pick]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation()
    pickSong(+el.dataset.pick)
  }))
  $$('#homeSearchBody .song-row').forEach((el) => el.addEventListener('click', () => pickSong(+el.dataset.song)))
  $$('#homeSearchBody [data-preview]').forEach((el) => el.addEventListener('click', () => togglePreview(+el.dataset.preview)))
  $$('#homeSearchBody [data-download]').forEach((el) => el.addEventListener('click', () => doDownload(+el.dataset.download)))
  $$('#homeSearchBody .track-row').forEach((el) => el.addEventListener('click', () => play(+el.dataset.i)))
  $('#btnBackSongs')?.addEventListener('click', () => { search.song = null; search.voices = []; updateHomeSearchBody() })
}

async function doSearch(explicitKw) {
  const kw = String(explicitKw != null ? explicitKw : ($('#searchInput')?.value || search.kw || '')).trim()
  if (!kw) return
  search.kw = kw
  pushSearchHist(kw)
  search.err = ''
  search.songs = []
  search.voices = []
  search.song = null
  search.playingVoiceId = null
  search.loading = true
  updateHomeSearchBody()
  try {
    if (search.tab === 'song') search.songs = await window.api.searchSongs(kw)
    else search.voices = await window.api.searchVoices(kw)
  } catch (e) {
    search.err = '搜索失败：' + (e.message || e)
  }
  search.loading = false
  updateHomeSearchBody()
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

/* ---------------- 批量导入（防卡顿分片渲染 + 匹配进度条 + 错误收集 + 节流持久化） ---------------- */
const imp = {
  link: '', loading: false, matching: false, matchDone: 0, matchTotal: 0,
  name: '', items: [], err: '', busy: false, done: 0, total: 0,
  open: -1, prevId: '', filter: 'all',
}

let _impSaveTimer = null
function scheduleSaveImpState(immediate) {
  clearTimeout(_impSaveTimer)
  if (immediate) {
    saveImpState()
    return
  }
  _impSaveTimer = setTimeout(saveImpState, 2200)
}

function saveImpState() {
  clearTimeout(_impSaveTimer)
  try {
    if (!imp.items.length && !imp.link) {
      localStorage.removeItem('desk:imp')
      return
    }
    const slim = imp.items.slice(0, 1000).map((it, idx) => ({
      _idx: idx,
      song: it.song,
      voices: (it.voices || []).slice(0, 12),
      pick: it.pick != null ? it.pick : 0,
      skip: !!it.skip,
      done: !!it.done,
      manual: !!it.manual,
      suspect: !!it.suspect,
      suspectWhy: it.suspectWhy || '',
      customKw: it.customKw || '',
      err: it.err || '',
    }))
    localStorage.setItem('desk:imp', JSON.stringify({ link: imp.link, name: imp.name, items: slim }))
  } catch { }
}

function restoreImpState() {
  try {
    const raw = JSON.parse(localStorage.getItem('desk:imp') || 'null')
    if (!raw || !Array.isArray(raw.items)) return
    imp.link = raw.link || ''
    imp.name = raw.name || ''
    imp.items = raw.items.map((it, idx) => {
      const row = { ...it, _idx: idx, running: false, searching: false }
      if (row.voices && row.voices.length && !row.manual) {
        evaluateImpItem(row)
      }
      return row
    })
  } catch { }
}

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

function evaluateImpItem(it) {
  if (!it.voices || !it.voices.length) {
    it.pick = -1
    it.suspect = false
    it.suspectWhy = ''
    return
  }
  const scored = it.voices.map((v, idx) => ({ ...scoreVoiceCand(it.song, v), idx })).sort((a, b) => b.score - a.score)
  const best = scored.find((x) => !x.bad)
  if (best) {
    it.pick = best.idx
    it.suspect = false
    it.suspectWhy = ''
  } else {
    it.pick = scored[0].idx
    it.suspect = true
    it.suspectWhy = scored[0].why || '时长不符·待确认'
  }
}

function firstArtistClean(a) {
  const raw = String(a || '').split(/[\/、,&]|feat\.?\s*/i).map((x) => x.trim()).filter(Boolean)[0] || ''
  return raw.replace(/\s*[（(【\[].*?[）)】\]]\s*/g, ' ').trim() || raw
}

function candStripHtml(it, i) {
  const list = it.voices || []
  const fa = firstArtistClean(it.song.artist)
  const defKw = it.customKw || [it.song.name, fa].filter(Boolean).join(' ').trim()
  const rowsHtml = it.searching
    ? '<div class="search-hint" style="padding:14px">正在网易云播客中搜索匹配声音…</div>'
    : !list.length
      ? '<div class="search-hint" style="padding:14px">暂无候选声音，可在上方输入框修改关键词或点击右侧快捷按钮搜索</div>'
      : list.map((v, k) => {
          const sc = scoreVoiceCand(it.song, v)
          const sel = it.pick === k && !it.suspect && !it.skip
          const isPv = imp.prevId && String(imp.prevId) === String(v.mainTrackId)
          const gapAbs = sc.gap == null ? null : Math.abs(sc.gap)
          const gapBadge = gapAbs == null
            ? ''
            : gapAbs <= 3
              ? '<span class="imp-cand-badge ok">时长一致</span>'
              : gapAbs <= 15
                ? `<span class="imp-cand-badge">差 ${fmt(gapAbs)}</span>`
                : `<span class="imp-cand-badge warn">差 ${fmt(gapAbs)}</span>`
          const authorTxt = [v.dj ? `by ${v.dj}` : '', v.radio || ''].filter(Boolean).join(' · ') || '未知来源'
          const playsTxt = v.plays ? ` · ${fmtPlays(v.plays)}播放` : ''
          return `<div class="imp-cand-row${sel ? ' sel' : ''}" data-imp-pick="${i}:${k}">
            <div class="imp-cand-cov" style="background-image:url('${esc(v.cover || '')}')">
              <button class="imp-cand-play${isPv ? ' on' : ''}" data-imp-pv="${i}:${k}" title="试听声源">${isPv ? '❚❚' : '▶'}</button>
            </div>
            <div class="imp-cand-body">
              <div class="imp-cand-t">${esc(String(v.title || '未命名').replace(/^声音[:：]?\s*/, ''))}</div>
              <div class="imp-cand-s">${esc(authorTxt)}${esc(playsTxt)}</div>
            </div>
            <div class="imp-cand-meta">
              <span class="imp-cand-dur">${fmt(v.duration)}</span>
              ${gapBadge}
              <button class="btn-sm${sel ? ' primary' : ''}" data-imp-pick="${i}:${k}">${sel ? '已选用' : '选用'}</button>
            </div>
          </div>`
        }).join('')

  return `<div class="imp-swap-panel" data-panel="${i}">
    <div class="imp-swap-head">
      <div class="imp-swap-search">
        <input type="search" class="imp-kw-in" id="impkw-${i}" data-imp-kwin="${i}" value="${esc(defKw)}" placeholder="输入歌名 / 歌手 / 别名搜索网易云声音（回车直达）…">
        <button class="btn-sm primary" data-imp-kwgo="${i}" ${it.searching ? 'disabled' : ''}>${it.searching ? '搜索中…' : '搜索声音'}</button>
      </div>
      <div class="imp-swap-chips">
        <button class="imp-kw-chip" data-imp-kwpreset="${i}:name" title="仅按歌名搜索">仅搜歌名</button>
        ${fa ? `<button class="imp-kw-chip" data-imp-kwpreset="${i}:both" title="按「歌名 + 精简歌手名」搜索">歌名+歌手</button>` : ''}
        ${fa ? `<button class="imp-kw-chip" data-imp-kwpreset="${i}:artist" title="仅按歌手名搜索">仅搜歌手</button>` : ''}
        <button class="imp-kw-chip" data-imp-kwpreset="${i}:smart" title="多关键词组合智能搜索">智能重搜</button>
        <span class="imp-swap-ref">原曲 ${fmt(it.song.duration)} · 候选 ${list.length} 条</span>
      </div>
    </div>
    <div class="imp-swap-list">${rowsHtml}</div>
  </div>`
}

function impRowStatusHtml(it) {
  const v = it.pick >= 0 && it.voices ? it.voices[it.pick] : null
  if (it.skip && it.err) return `<span class="imp-st warn" title="${esc(it.err)}">失败·${esc(it.err.slice(0, 12))}</span>`
  if (it.skip) return '<span class="imp-st skip">已跳过</span>'
  if (it.done) return '<span class="imp-st ok">已下载</span>'
  if (it.running) return '<span class="imp-st">下载中…</span>'
  if (it.matching) return '<span class="imp-st">匹配中…</span>'
  if (it.suspect) return `<span class="imp-st warn">${esc(it.suspectWhy || '待确认')}</span>`
  if (v) return '<span class="imp-st">已匹配</span>'
  if (it.err) return `<span class="imp-st warn">${esc(it.err)}</span>`
  return `<span class="imp-st warn">${imp.matching ? '待匹配' : '未找到'}</span>`
}

function impRowSubHtml(it) {
  const v = it.pick >= 0 && it.voices ? it.voices[it.pick] : null
  if (v) {
    const cleanVt = String(v.title || '').replace(/^声音[:：]?\s*/, '')
    const subMeta = [v.dj ? `by ${v.dj}` : '', v.radio || '', fmt(v.duration), `原曲 ${fmt(it.song.duration)}`].filter(Boolean).join(' · ')
    return `<div class="imp-v">${esc(cleanVt)}<span class="imp-v-sub">${esc(subMeta)}</span></div>`
  }
  if (it.err) return `<div class="imp-v muted" style="color:var(--red)">错误：${esc(it.err)}</div>`
  return `<div class="imp-v muted">${imp.matching && !it._matchedOnce ? '等待搜索匹配播客声源…' : '没有可用候选项（点右侧「换源」手动搜索匹配）'}</div>`
}

function importRowHtml(it, i) {
  if (i == null) i = it._idx != null ? it._idx : imp.items.indexOf(it)
  const row = `<div class="imp-row" id="improw-${i}">
    <div class="imp-main">
      <div class="imp-name">${i + 1}. ${esc(it.song.name)}<span class="imp-artist">${esc(it.song.artist || '')}</span></div>
      <div id="impsub-${i}">${impRowSubHtml(it)}</div>
    </div>
    <div class="imp-right"><span id="impst-${i}">${impRowStatusHtml(it)}</span>
      <button class="btn-sm" id="impswap-${i}" data-imp-swap="${i}" ${it.running || it.done ? 'disabled' : ''}>${imp.open === i ? '收起' : '换源'}</button>
      <button class="btn-sm" id="impskip-${i}" data-imp-skip="${i}" ${it.done ? 'disabled' : ''}>${it.skip ? '恢复' : '跳过'}</button>
    </div>
  </div>`
  return imp.open === i ? row + candStripHtml(it, i) : row
}

function isImpItemPending(x) {
  return !x.done && (x.skip || x.suspect || x.pick < 0 || !x.voices || !x.voices.length)
}

function updateSingleImpRow(i) {
  if (location.hash !== '#/import') return
  const it = imp.items[i]
  if (!it) return
  const stEl = document.getElementById('impst-' + i)
  if (stEl) stEl.innerHTML = impRowStatusHtml(it)
  const subEl = document.getElementById('impsub-' + i)
  if (subEl) subEl.innerHTML = impRowSubHtml(it)
  const swBtn = document.getElementById('impswap-' + i)
  if (swBtn) swBtn.disabled = !!(it.running || it.done)
  const skBtn = document.getElementById('impskip-' + i)
  if (skBtn) {
    skBtn.disabled = !!it.done
    skBtn.textContent = it.skip ? '恢复' : '跳过'
  }
  updateImpHeaderInPlace()
}

function updateImpHeaderInPlace() {
  if (location.hash !== '#/import') return
  const total = imp.items.length
  const usable = imp.items.filter((x) => !x.skip && !x.done && !x.suspect && x.pick >= 0 && x.voices && x.voices[x.pick]).length
  const suspectCnt = imp.items.filter(isImpItemPending).length
  const doneCnt = imp.items.filter((x) => x.done).length
  const subEl = document.getElementById('impPageSub')
  if (subEl && imp.name) {
    subEl.textContent = `${imp.name} · 共 ${total} 首 · 可直接下载 ${usable} 首${suspectCnt ? ` · 待确认/未匹配 ${suspectCnt} 首（点「换源」搜索或挑选）` : ''}`
  }
  const allBtn = document.getElementById('impAll')
  if (allBtn) {
    allBtn.textContent = `下载全部（${usable}）`
    allBtn.style.display = (usable && !imp.busy) ? '' : 'none'
  }
  const fAll = document.querySelector('[data-imp-filter="all"]')
  if (fAll) fAll.textContent = `全部 (${total})`
  const fSus = document.querySelector('[data-imp-filter="suspect"]')
  if (fSus) fSus.textContent = `待确认 (${suspectCnt})`
  const fRdy = document.querySelector('[data-imp-filter="ready"]')
  if (fRdy) fRdy.textContent = `可下载 (${usable})`
  const fDone = document.querySelector('[data-imp-filter="done"]')
  if (fDone) fDone.textContent = `已下载 (${doneCnt})`
  const mBar = document.getElementById('impMatchBar')
  const mTxt = document.getElementById('impMatchTxt')
  if (mBar && imp.matchTotal > 0) mBar.style.width = Math.round((imp.matchDone * 100) / imp.matchTotal) + '%'
  if (mTxt) mTxt.textContent = `正在匹配播客声源 ${imp.matchDone} / ${imp.matchTotal}…`
  const dBar = document.getElementById('impDlBar')
  const dTxt = document.getElementById('impDlTxt')
  if (dBar && imp.total > 0) dBar.style.width = Math.round((imp.done * 100) / imp.total) + '%'
  if (dTxt) dTxt.textContent = `正在批量下载音频 ${imp.done} / ${imp.total}…`
}

function filteredDeskImportItems() {
  const f = imp.filter || 'all'
  if (f === 'suspect') return imp.items.filter(isImpItemPending)
  if (f === 'ready') return imp.items.filter((x) => !x.skip && !x.done && !x.suspect && x.pick >= 0 && x.voices && x.voices[x.pick])
  if (f === 'done') return imp.items.filter((x) => x.done)
  if (f === 'err') return imp.items.filter((x) => x.err)
  return imp.items
}

const DESK_IMP_FIRST_CHUNK = 35
const DESK_IMP_NEXT_CHUNK = 45

function viewImport() {
  const total = imp.items.length
  const usable = imp.items.filter((x) => !x.skip && !x.done && !x.suspect && x.pick >= 0 && x.voices && x.voices[x.pick]).length
  const suspectCnt = imp.items.filter(isImpItemPending).length
  const doneCnt = imp.items.filter((x) => x.done).length
  const errCnt = imp.items.filter((x) => x.err).length
  const list = filteredDeskImportItems()
  const firstSlice = list.slice(0, DESK_IMP_FIRST_CHUNK)
  const body = imp.loading
    ? '<div class="imp-q"><div class="imp-q-track"><div class="imp-q-bar" style="width:45%"></div></div><div class="imp-q-text">正在解析分享链接与歌单曲目…</div></div>'
    : imp.err ? `<div class="search-hint" style="color:var(--red)">${esc(imp.err)}</div>`
    : total ? `<div class="imp-list" id="impListBox">${firstSlice.map((it) => importRowHtml(it, it._idx)).join('')}</div>`
    : '<div class="search-hint">粘贴网易云歌单/歌曲分享链接，自动匹配播客声音</div>'
  const subTxt = imp.name
    ? `${imp.name} · 共 ${total} 首 · 可直接下载 ${usable} 首${suspectCnt ? ` · 待确认/未匹配 ${suspectCnt} 首（点「换源」挑选）` : ''}`
    : '粘贴分享链接（歌单或单曲），自动比对标题与时长并过滤翻唱/片段'
  const matchProg = imp.matching
    ? `<div class="imp-q" id="impMatchWrap">
        <div class="imp-q-track"><div class="imp-q-bar" id="impMatchBar" style="width:${imp.matchTotal ? Math.round((imp.matchDone * 100) / imp.matchTotal) : 0}%"></div></div>
        <div class="imp-q-text" id="impMatchTxt">正在匹配播客声源 ${imp.matchDone} / ${imp.matchTotal}…</div>
      </div>`
    : ''
  const dlProg = imp.busy
    ? `<div class="imp-q" id="impDlWrap">
        <div class="imp-q-track"><div class="imp-q-bar" id="impDlBar" style="width:${imp.total ? Math.round((imp.done * 100) / imp.total) : 0}%"></div></div>
        <div class="imp-q-text" id="impDlTxt">正在批量下载音频 ${imp.done} / ${imp.total}…</div>
      </div>`
    : ''
  const filters = total ? `<div class="imp-filter-bar">
      <button class="sort-pill${imp.filter === 'all' ? ' on' : ''}" data-imp-filter="all">全部 (${total})</button>
      <button class="sort-pill${imp.filter === 'suspect' ? ' on' : ''}" data-imp-filter="suspect">待确认 (${suspectCnt})</button>
      <button class="sort-pill${imp.filter === 'ready' ? ' on' : ''}" data-imp-filter="ready">可下载 (${usable})</button>
      <button class="sort-pill${imp.filter === 'done' ? ' on' : ''}" data-imp-filter="done">已下载 (${doneCnt})</button>
      ${errCnt ? `<button class="sort-pill${imp.filter === 'err' ? ' on' : ''}" data-imp-filter="err">异常 (${errCnt})</button>` : ''}
    </div>` : ''
  return `<div class="page-head">
      <div>
        <div class="page-title">批量导入</div>
        <div class="page-sub" id="impPageSub">${esc(subTxt)}</div>
      </div>
    </div>
    <div class="imp-bar">
      <input id="impLink" value="${esc(imp.link)}" placeholder="https://music.163.com/playlist?id=...">
      <button id="impParse" class="btn-sm primary" ${imp.loading ? 'disabled' : ''}>${total ? '重新解析' : '解析'}</button>
      <button id="impAll" class="btn-sm primary" style="${usable && !imp.busy ? '' : 'display:none'}">下载全部（${usable}）</button>
      ${imp.matching ? `<button id="impMatchStop" class="btn-sm">暂停匹配</button>` : ''}
      ${!imp.matching && suspectCnt > 0 && !imp.busy ? `<button id="impMatchResume" class="btn-sm" title="使用优化后的匹配引擎重新匹配所有待确认/未找到/已跳过的歌曲">重匹待确认 (${suspectCnt})</button>` : ''}
      ${imp.busy ? `<button id="impStop" class="btn-sm">停止下载 (${imp.done}/${imp.total})</button>` : ''}
      ${total && !imp.busy && !imp.matching ? `<button id="impClear" class="btn-sm">清空列表</button>` : ''}
    </div>
    ${matchProg}
    ${dlProg}
    ${filters}
    ${body}`
}

function mountImportRowsChunked() {
  if (_impChunkRaf) { cancelAnimationFrame(_impChunkRaf); _impChunkRaf = 0 }
  const box = document.getElementById('impListBox')
  if (!box) return
  const list = filteredDeskImportItems()
  if (list.length <= DESK_IMP_FIRST_CHUNK) return
  let offset = DESK_IMP_FIRST_CHUNK
  const step = () => {
    if (location.hash !== '#/import') { _impChunkRaf = 0; return }
    const b = document.getElementById('impListBox')
    if (!b) { _impChunkRaf = 0; return }
    const slice = list.slice(offset, offset + DESK_IMP_NEXT_CHUNK)
    if (!slice.length) { _impChunkRaf = 0; return }
    b.insertAdjacentHTML('beforeend', slice.map((it) => importRowHtml(it, it._idx)).join(''))
    offset += slice.length
    if (offset < list.length) {
      _impChunkRaf = requestAnimationFrame(step)
    } else {
      _impChunkRaf = 0
    }
  }
  _impChunkRaf = requestAnimationFrame(step)
}

async function doImportParse() {
  const link = ($('#impLink')?.value || imp.link || '').trim()
  const parsed = parseShareLink(link)
  window.__deskImpMatchStop = true
  imp.link = link
  imp.items = []
  imp.err = ''
  imp.open = -1
  imp.filter = 'all'
  if (!parsed) {
    imp.err = '没识别出歌单/歌曲 ID，请检查链接格式'
    startTask('impparse', '解析链接失败', imp.err, 1, false)
    recordTaskError(link || '空链接', imp.err)
    finishTask('解析链接失败', imp.err)
    render()
    return
  }
  imp.loading = true
  startTask('impparse', '正在解析分享链接…', `正在拉取 ${parsed.type === 'playlist' ? '歌单' : '单曲'} (${parsed.id}) 详情`, 0, true)
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
    if (!songs.length) {
      imp.err = '这个链接里没有歌曲（可能为空或私有歌单）'
      recordTaskError(parsed.id, imp.err)
      finishTask('歌单解析异常', imp.err)
    } else {
      imp.items = songs.map((sg, idx) => ({
        _idx: idx, song: sg, voices: [], pick: 0,
        skip: false, done: false, suspect: false, suspectWhy: '', err: '',
      }))
      scheduleSaveImpState(true)
    }
  } catch (e) {
    imp.err = '解析失败：' + (e.message || e)
    recordTaskError(parsed.id, imp.err)
    finishTask('歌单解析失败', imp.err)
  }
  imp.loading = false
  render()
  if (imp.items.length) matchAllImport()
}

async function matchAllImport(rematchPending = false) {
  if (imp.matching) return
  const total = imp.items.length
  if (!total) return
  imp.matching = true
  window.__deskImpMatchStop = false
  if (rematchPending) {
    imp.items.forEach((x) => {
      if (!x.done && !x.manual && (x.skip || x.suspect || x.pick < 0 || !x.voices || !x.voices.length)) {
        x.voices = []
        x._matchedOnce = false
      }
    })
  }
  imp.matchTotal = total
  imp.matchDone = imp.items.filter((x) => x._matchedOnce || (x.voices && x.voices.length)).length
  startTask('impmatch', '正在匹配播客声源', `共 ${total} 首 · 已匹配 ${imp.matchDone} 首`, total, false, '暂停')
  if (location.hash === '#/import') render()

  for (let i = 0; i < imp.items.length; i++) {
    if (window.__deskImpMatchStop) break
    const it = imp.items[i]
    if (!it || it.done || (it.voices && it.voices.length)) continue
    await waitNavYield()
    it.matching = true
    it.err = ''
    updateSingleImpRow(i)
    try {
      it.voices = await window.api.searchVoices({ name: it.song.name, artist: it.song.artist, duration: it.song.duration })
      evaluateImpItem(it)
      if (it.pick >= 0 && !it.suspect) {
        it.skip = false
      }
    } catch (e) {
      it.voices = []
      it.pick = -1
      it.err = '匹配接口异常：' + (e.message || e)
    }
    it.matching = false
    it._matchedOnce = true
    imp.matchDone = imp.items.filter((x) => x._matchedOnce || (x.voices && x.voices.length)).length
    if (it.pick >= 0 && !it.suspect) {
      // matched cleanly
    } else if (it.suspect) {
      recordTaskError(it.song.name, `候选需人工确认（${it.suspectWhy || '时长或标题不符'}）`)
    } else {
      recordTaskError(it.song.name, it.err || '网易云未搜到可用播客声源')
    }
    stepTask(imp.matchDone, `正在匹配 (${imp.matchDone}/${total})：${it.song.name}`)
    updateSingleImpRow(i)
    scheduleSaveImpState(false)
  }
  imp.matching = false
  scheduleSaveImpState(true)
  const usable = imp.items.filter((x) => !x.skip && !x.done && !x.suspect && x.pick >= 0 && x.voices && x.voices[x.pick]).length
  const suspectCnt = imp.items.filter(isImpItemPending).length
  finishTask(
    window.__deskImpMatchStop ? '声源匹配已暂停' : '播客声源匹配完成',
    `可直接下载 ${usable} 首${suspectCnt ? ` · 待确认/未找到 ${suspectCnt} 首` : ''}`,
    5000
  )
  if (location.hash === '#/import') render()
}

function refreshOpenImpPanel(i) {
  const it = imp.items[i]
  if (!it) return
  const pEl = document.querySelector(`[data-panel="${i}"]`)
  if (pEl) pEl.outerHTML = candStripHtml(it, i)
}

async function importInlineSearch(i, kw, useSmart = false) {
  const it = imp.items[i]
  if (!it || it.searching) return
  const cleanKw = String(kw || '').trim()
  if (cleanKw) it.customKw = cleanKw
  it.searching = true
  it.err = ''
  refreshOpenImpPanel(i)
  try {
    let list = []
    if (useSmart || !cleanKw) {
      list = await window.api.searchVoices({ name: it.song.name, artist: it.song.artist, duration: it.song.duration })
    } else {
      list = await window.api.searchVoices(cleanKw)
    }
    it.voices = list || []
    evaluateImpItem(it)
    if (it.pick >= 0 && !it.suspect) {
      it.skip = false
    }
    scheduleSaveImpState(false)
  } catch (e) {
    it.err = '搜索失败：' + (e.message || e)
  }
  it.searching = false
  updateSingleImpRow(i)
  refreshOpenImpPanel(i)
}

async function importSwap(i) {
  const prevOpen = imp.open
  imp.open = imp.open === i ? -1 : i
  if (prevOpen >= 0) {
    document.querySelector(`[data-panel="${prevOpen}"]`)?.remove()
    const oldBtn = document.getElementById('impswap-' + prevOpen)
    if (oldBtn) oldBtn.textContent = '换源'
  }
  if (imp.open === i && imp.items[i]) {
    const it = imp.items[i]
    const curRow = document.getElementById('improw-' + i)
    const curBtn = document.getElementById('impswap-' + i)
    if (curBtn) curBtn.textContent = '收起'
    if (curRow) {
      curRow.insertAdjacentHTML('afterend', candStripHtml(it, i))
      if (!it.voices || !it.voices.length) {
        importInlineSearch(i, '', true)
      }
      return
    }
  }
  render()
}

async function importRekw(i) {
  const it = imp.items[i]
  if (!it) return
  const inEl = document.getElementById('impkw-' + i)
  if (inEl) {
    await importInlineSearch(i, inEl.value, false)
    return
  }
  const kw = await askText('换个关键词重新搜声音', it.song.name)
  if (!kw) return
  await importInlineSearch(i, kw, false)
}

async function importAll() {
  const byNorm = new Map()
  state.tracks.forEach((t) => byNorm.set(normKey(cleanTitle(t.title)), t))
  for (const it of imp.items) {
    if (it.done || it.skip) continue
    const exist = byNorm.get(normKey(it.song.name))
    if (exist && Math.abs((exist.duration || 0) - (it.song.duration || 0)) <= 25) {
      it.done = true
    }
  }
  const todo = imp.items.filter((x) => !x.skip && !x.done && !x.suspect && x.pick >= 0 && x.voices && x.voices[x.pick])
  if (!todo.length) { scheduleSaveImpState(true); render(); toast('没有待下载的曲目'); return }
  imp.busy = true
  imp.done = 0
  imp.total = todo.length
  window.__deskImpStop = false
  startTask('impdl', '正在批量下载音频…', `共 ${todo.length} 首待下载`, todo.length, false, '停止')
  if (location.hash === '#/import') render()
  for (const it of todo) {
    if (window.__deskImpStop) break
    await waitNavYield()
    const v = it.voices[it.pick]
    if (!v) continue
    it.running = true
    it.err = ''
    updateSingleImpRow(it._idx)
    stepTask(imp.done, `正在下载 (${imp.done + 1}/${imp.total})：${it.song.name}`)
    try {
      await window.api.downloadVoice({ voice: v, song: it.song })
      it.done = true
      imp.done++
    } catch (e) {
      it.skip = true
      it.err = e.message || String(e)
      recordTaskError(it.song.name, '下载失败：' + it.err)
    }
    it.running = false
    updateSingleImpRow(it._idx)
    scheduleSaveImpState(false)
  }
  imp.busy = false
  scheduleSaveImpState(true)
  await rescan()
  finishTask(
    window.__deskImpStop ? '批量下载已停止' : '批量下载完成',
    `成功下载 ${imp.done} / ${imp.total} 首${state.task.errors.length ? ` · 失败 ${state.task.errors.length} 首` : ''}`,
    5500
  )
  if (location.hash === '#/import') render()
  toast(window.__deskImpStop ? '已停止批量下载' : '批量下载完成')
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
function totalDurStr(list) {
  const sec = (list || []).reduce((acc, t) => acc + (+(t && t.duration) || 0), 0)
  const mins = Math.round(sec / 60)
  return mins > 0 ? ` · 约 ${mins} 分钟` : ''
}

function filterAndSortTracks(list) {
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

function heroCardHtml({ title, sub, firstTrack, actsHtml }) {
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

function listToolbarHtml() {
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

function currentListBaseTracks() {
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

function renderCurrentListRowsHtml() {
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

function updateListBody() {
  const box = $('#listBody')
  if (!box) { render(); return }
  box.innerHTML = renderCurrentListRowsHtml()
  $$('.sort-pill[data-sort]').forEach((el) => el.classList.toggle('on', el.dataset.sort === state.listSort))
  bindListBodyEvents()
}

function bindListBodyEvents() {
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

function viewPlaylist(id) {
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
  if (!r || !r.ok) { toast('操作失败：' + ((r && r.reason) || '未知错误')); return }
  if (on) set.add(t.path); else set.delete(t.path)
  localStorage.setItem(FAV_KEY, JSON.stringify([...set]))
  await rescan()
  render()
}

// 扫描进度只订阅一次：主进程经 'library:scan-progress' 推送已处理数/总数，
// 这里据此更新任务条的真实进度（总数在 walk 完成后才知道，之前为不确定进度）。
let _scanProgressBound = false
function bindScanProgress() {
  if (_scanProgressBound || !window.api || !window.api.onScanProgress) return
  _scanProgressBound = true
  window.api.onScanProgress((p) => {
    const tk = state.task
    if (!p || tk.kind !== 'scan' || !tk.active) return
    if (p.total) { tk.total = p.total; tk.indet = false }
    stepTask(p.done || 0, `正在读取音频文件与 ID3 标签 (${p.done || 0}/${p.total || '?'})…`)
  })
}

async function rescan(showFeedback) {
  const prevCount = state.tracks.length
  if (showFeedback) {
    bindScanProgress()
    // 总数未知（walk 尚未完成），先用不确定进度 + “取消”按钮；收到第一条
    // library:scan-progress 后总数与进度条由 bindScanProgress 接管。
    startTask('scan', '正在扫描本地音乐目录…', `正在遍历 ${state.root || '默认音乐目录'}`, 0, true, '取消')
    stepTask(0, `正在读取音频文件与 ID3 标签 (${state.root || ''})…`)
  }
  try {
    const lib = await window.api.scan(state.root)
    state.tracks = lib.tracks || []
    state.root = lib.root || state.root
    if (showFeedback) {
      const diff = state.tracks.length - prevCount
      const diffTxt = diff > 0 ? `新增 ${diff} 首` : diff < 0 ? `减少 ${Math.abs(diff)} 首` : '曲目数量无变化'
      const truncTxt = lib.truncated
        ? ` · 曲库共 ${lib.total} 首，仅显示前 ${state.tracks.length} 首`
        : ''
      if (lib.cancelled) {
        finishTask(`本地音乐扫描已取消（已载入 ${state.tracks.length} 首）`, `${diffTxt} · 目录：${state.root}`, 4200)
      } else if (!state.tracks.length) {
        recordTaskError(state.root || '音乐目录', '该目录下未扫描到支持的音频文件 (.mp3/.flac/.m4a/.wav/.ogg)')
        finishTask('本地音乐扫描完成（共 0 首）', `${diffTxt} · 目录：${state.root}`, 4200)
      } else {
        finishTask(`本地音乐扫描完成（共 ${state.tracks.length} 首${lib.total != null && lib.total !== state.tracks.length ? ` / 全部 ${lib.total} 首` : ''}）`, `${diffTxt}${truncTxt} · 目录：${state.root}`, 4200)
        if (lib.truncated) toast(`曲库共 ${lib.total} 首，仅显示前 ${state.tracks.length} 首`)
      }
    }
  } catch (e) {
    if (showFeedback) {
      recordTaskError(state.root || '音乐目录', '目录扫描失败：' + (e.message || e))
      finishTask('本地音乐扫描失败', e.message || String(e))
    }
  }
}

async function deleteTrack(t) {
  if (!t || !t.path) return
  if (!(await askConfirm(`删除《${cleanTitle(t.title)}》？\n文件会移到回收站（含歌词/封面）`))) return
  const r = await window.api.remove(t.path)
  if (!r || !r.ok) { toast('删除失败：' + ((r && r.reason) || '未知错误')); return }
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
  if (!(await askConfirm(`删除歌单「${pl.name}」？\n（只删歌单，不动音乐文件）`))) return
  const v = getPlaylists().filter((p) => p.id !== id)
  savePlaylists(v)
  renderSidebar()
  location.hash = '#/local'
  render()
}

async function fixCovers() {
  const btn = $('#btnFixCover')
  if (btn) { btn.disabled = true; btn.textContent = '处理中…' }
  const total = state.tracks.length
  if (!total) {
    toast('当前曲库为空')
    if (btn) { btn.disabled = false; btn.textContent = '补高清封面' }
    return
  }
  window.__deskCoverStop = false
  startTask('cover', '正在匹配高清封面…', `准备检查 ${total} 首本地曲目`, total, false, '停止')
  let done = 0, step = 0
  for (const t of state.tracks) {
    if (window.__deskCoverStop) break
    await waitNavYield()
    step++
    stepTask(step, `正在匹配封面 (${step}/${total})：${cleanTitle(t.title)}`)
    try {
      const r = await window.api.coverFix([t])
      if (r && r.done > 0) {
        done += r.done
        coverCache.delete(t.path)
      } else if (r && Array.isArray(r.errors) && r.errors.length) {
        r.errors.forEach((er) => recordTaskError(er.name, er.reason))
      }
    } catch (e) {
      recordTaskError(cleanTitle(t.title), '封面下载失败：' + (e.message || e))
    }
  }
  await rescan(false)
  finishTask(
    window.__deskCoverStop ? '高清封面补齐已停止' : '高清封面匹配完成',
    `新补齐 ${done} 张封面（检查 ${step} 首）${state.task.errors.length ? ` · 失败 ${state.task.errors.length} 首` : ''}`,
    5000
  )
  render()
}

async function pickRoot() {
  const dir = await window.api.pickFolder()
  if (!dir) return
  state.root = dir
  await rescan(true)
  render()
}

/* ---------------- 我喜欢的音乐视图 ---------------- */
function favTracks() {
  return state.tracks.filter((t) => t.path.includes('\\' + FAV_DIR + '\\'))
}
function viewLiked() {
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
function trackRowHtml(t, idx, no) {
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

function viewRecent() {
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

function viewLocal() {
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

/* ---------------- 独立主设置界面 (#/settings) ---------------- */
function viewSettings() {
  const gainMapCount = Object.keys(getTrackGainMap()).length
  const playCountsCount = Object.keys(getPlayCounts()).length
  const lrcColors = [
    ['#ec4141', '网易珊瑚红'],
    ['#4da3ff', '极光冰蓝'],
    ['#10b981', '翡翠森林'],
    ['#f59e0b', '流光琥珀'],
    ['#a855f7', '霓虹紫晶'],
    ['#ffffff', '纯净高对比'],
  ]
  return `<div class="set-wrap">
    <div class="page-head">
      <div>
        <div class="page-title">设置</div>
        <div class="page-sub">统一管理曲库与下载目录、音量平衡、随机播放算法、歌词外观与低频维护工具</div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <div>
          <div class="set-card-title">📁 曲库与下载目录</div>
          <div class="set-card-desc">在线下载与批量导入的歌曲、旁挂双语歌词 (.lrc) 与封面将自动保存在此目录</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">当前音乐目录（共 ${state.tracks.length} 首）</div>
          <div class="set-row-sub">${esc(state.root || '默认系统音乐目录')}</div>
        </div>
        <div class="set-row-ctrl">
          <button class="btn-sm primary" id="setPickRootBtn">📁 更改目录</button>
          <button class="btn-sm" id="setRescanBtn">🔄 重新扫描</button>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <div>
          <div class="set-card-title">♪ 音量平衡（Loudness Normalization）</div>
          <div class="set-card-desc">基于 MP3 帧增益分析 + WebAudio 增益与软限幅器，自动消除不同播客音源声音忽大忽小的问题</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">自动音量平衡</div>
          <div class="set-row-sub">开启后将过响曲目平滑衰减、过轻音源自动放大并防破音（可在播放页「⚙ 播放设置」对单首歌独立微调）</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-norm="1" class="${state.normEnabled ? 'on' : ''}">开启</button>
            <button data-set-norm="0" class="${!state.normEnabled ? 'on' : ''}">关闭</button>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">目标响度基准</div>
          <div class="set-row-sub">标准模式对齐主流流媒体（-14 LUFS）；夜间模式更柔和护耳；增强模式适合偏轻音源</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-preset="standard" class="${state.normPreset === 'standard' ? 'on' : ''}">标准 (-14 LUFS)</button>
            <button data-set-preset="night" class="${state.normPreset === 'night' ? 'on' : ''}">轻柔夜间 (-17 LUFS)</button>
            <button data-set-preset="boost" class="${state.normPreset === 'boost' ? 'on' : ''}">人声增强 (-12 LUFS)</button>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">单曲独立增益微调记录</div>
          <div class="set-row-sub">已为 ${gainMapCount} 首歌曲单独保存了音量微调偏好</div>
        </div>
        <div class="set-row-ctrl">
          <button class="btn-sm" id="setClearTrackGains" ${gainMapCount ? '' : 'disabled'}>清空单曲微调</button>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <div>
          <div class="set-card-title">🔀 随机播放策略</div>
          <div class="set-card-desc">控制切换至「随机播放」模式时的下一首抽取算法</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">随机抽选模式</div>
          <div class="set-row-sub">
            ${state.randomStrategy === 'no-repeat'
              ? '不重复随机：当前队列所有歌曲全部听完一遍前绝不重复抽中同一首（推荐）'
              : state.randomStrategy === 'rare-first'
                ? '不常听优先：结合本地播放次数统计，优先随机抽选平时少听或未听过的歌曲'
                : '真随机：每次切歌完全独立随机抽取（像掷骰子一样，可能短时间内再次抽中）'}
          </div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-rand="no-repeat" class="${state.randomStrategy === 'no-repeat' ? 'on' : ''}">不重复随机</button>
            <button data-set-rand="rare-first" class="${state.randomStrategy === 'rare-first' ? 'on' : ''}">不常听随机</button>
            <button data-set-rand="true-random" class="${state.randomStrategy === 'true-random' ? 'on' : ''}">真随机</button>
          </div>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <div>
          <div class="set-card-title">🎨 歌词外观（字体大小与高亮颜色）</div>
          <div class="set-card-desc">调整歌曲播放页双语歌词的字号与当前句高亮色彩</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">歌词字号大小</div>
          <div class="set-row-sub">支持预设档位或滑块无级调节（14px ~ 28px）</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-lrcsz="15" class="${state.lrcSize === 15 ? 'on' : ''}">小</button>
            <button data-set-lrcsz="18" class="${state.lrcSize === 18 ? 'on' : ''}">标准</button>
            <button data-set-lrcsz="21" class="${state.lrcSize === 21 ? 'on' : ''}">大</button>
            <button data-set-lrcsz="25" class="${state.lrcSize === 25 ? 'on' : ''}">特大</button>
          </div>
          <div class="set-range-wrap">
            <input type="range" id="setLrcSizeRange" min="14" max="28" step="1" value="${state.lrcSize}">
            <span class="set-val-badge" id="setLrcSizeVal">${state.lrcSize}px</span>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">当前句高亮配色</div>
          <div class="set-row-sub">点击预设色圆点或右侧取色器自定义颜色</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-swatches">
            ${lrcColors.map(([c, name]) => `<span class="set-swatch${state.lrcColor.toLowerCase() === c ? ' on' : ''}" data-set-lrccolor="${c}" title="${name}" style="background:${c}"></span>`).join('')}
            <input type="color" id="setLrcColorPicker" value="${esc(state.lrcColor)}" title="自定义颜色" style="width:28px;height:28px;border:0;background:transparent;cursor:pointer">
          </div>
        </div>
      </div>
      <div class="set-preview-box">
        <div id="setLrcPreviewEn" style="font-size:${state.lrcSize + 2}px;color:${esc(state.lrcColor)};font-weight:700">Can we pretend we're not angels through a cable?</div>
        <div id="setLrcPreviewZh" style="font-size:${state.lrcSize}px;color:${esc(state.lrcColor)};font-weight:700;margin-top:4px">我们能否假装自己不是隔着网线相望的天使？</div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <div>
          <div class="set-card-title">🛠 界面外观与非常用维护工具</div>
          <div class="set-card-desc">将低频工具集中收纳，保持日常听歌界面干净清爽</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">界面外观主题</div>
          <div class="set-row-sub">切换浅色、深色或跟随系统深浅色</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-theme="auto" class="${state.theme === 'auto' ? 'on' : ''}">跟随系统</button>
            <button data-set-theme="light" class="${state.theme === 'light' ? 'on' : ''}">浅色模式</button>
            <button data-set-theme="dark" class="${state.theme === 'dark' ? 'on' : ''}">深色模式</button>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">曲库维护与整理</div>
          <div class="set-row-sub">检测疑似重复歌曲、缺失歌词、缺封面或异常短音频（已累计记录 ${playCountsCount} 首歌播放频次）</div>
        </div>
        <div class="set-row-ctrl">
          <button class="btn-sm primary" id="setOpenHealthBtn">🩺 打开曲库体检</button>
          <button class="btn-sm" id="setFixCoversBtn">✦ 批量补高清封面</button>
          <button class="btn-sm" id="setClearStatsBtn">🧹 清空搜索与播放统计</button>
        </div>
      </div>
    </div>
  </div>`
}

/* ---------------- 曲库体检视图 (Phase 3) ---------------- */
function analyzeLibraryHealth() {
  const byKey = new Map()
  const dupSet = new Set()
  const noLrc = []
  const noMeta = []
  const shortClips = []
  for (const t of state.tracks) {
    const k = normKey(cleanTitle(t.title))
    if (k) {
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(t)
    }
    if (!t.hasLrc) noLrc.push(t)
    if (!t.artist || (t.bitrate && t.bitrate < 128)) noMeta.push(t)
    const d = +(t.duration || 0)
    if (d > 0 && d < 25) shortClips.push(t)
  }
  const dups = []
  for (const [, group] of byKey) {
    if (group.length > 1) {
      group.forEach((x) => { if (!dupSet.has(x.path)) { dupSet.add(x.path); dups.push(x) } })
    }
  }
  return { dups, noLrc, noMeta, shortClips }
}

function viewHealth() {
  const h = analyzeLibraryHealth()
  const tab = state.healthTab || 'dup'
  const cards = [
    ['dup', '疑似重复', h.dups.length],
    ['lrc', '缺少歌词', h.noLrc.length],
    ['meta', '缺歌手/低码率', h.noMeta.length],
    ['short', '异常短音频(<25s)', h.shortClips.length],
  ]
  const curList = tab === 'dup' ? h.dups : tab === 'lrc' ? h.noLrc : tab === 'meta' ? h.noMeta : h.shortClips
  const descMap = {
    dup: '同名或高度相似的本地音频文件，可对比时长/码率后清理多余副本',
    lrc: '尚未匹配到旁挂 .lrc 歌词的曲目，可点右上角「一键补齐缺失歌词与封面」',
    meta: '缺少歌手标签或码率低于 128kbps 的曲目，可播放后点「换源」替换为高音质版本',
    short: '时长不足 25 秒的音频（可能是试听片段或损坏文件），可播放后点「换源」重下',
  }
  return `<div class="health-wrap">
    <div class="page-head">
      <div>
        <div class="page-title">曲库体检</div>
        <div class="page-sub">共扫描 ${state.tracks.length} 首本地音频 · ${esc(state.root)}</div>
      </div>
      <div class="page-actions">
        <button id="btnHealthFixAll" class="btn-sm primary">一键补齐缺失歌词与封面</button>
      </div>
    </div>
    <div class="health-grid">
      ${cards.map(([k, lbl, cnt]) => `
        <div class="health-stat${tab === k ? ' on' : ''}" data-health-tab="${k}">
          <div class="health-stat-num">${cnt}</div>
          <div class="health-stat-label">${lbl}</div>
        </div>`).join('')}
    </div>
    <div class="page-sub" style="margin-bottom:10px">${descMap[tab] || ''}</div>
    ${curList.length
      ? `<div class="tracklist">${curList.map((t, i) => trackRowHtml(t, state.tracks.indexOf(t), i + 1)).join('')}</div>`
      : `<div class="empty-note" style="padding:56px 0"><div class="big">太棒了，这一项没有发现问题</div><div>曲库状态非常健康</div></div>`}
  </div>`
}

async function healthFixAll() {
  const btn = $('#btnHealthFixAll')
  if (btn) { btn.disabled = true; btn.textContent = '正在补齐…' }
  const total = state.tracks.length
  if (!total) return
  window.__deskHealthStop = false
  startTask('healthfix', '正在补齐缺失歌词与高清封面…', `共扫描 ${total} 首曲目`, total, false, '停止')
  let lrcDone = 0, covDone = 0, step = 0
  for (const t of state.tracks) {
    if (window.__deskHealthStop) break
    await waitNavYield()
    step++
    stepTask(step, `正在处理 (${step}/${total})：${cleanTitle(t.title)}`)
    if (!t.hasLrc) {
      try {
        const r = await window.api.autoLyric({ title: cleanTitle(t.title), artist: t.artist, filePath: t.path })
        if (r && r.ok) {
          t.hasLrc = true
          lrcDone++
        } else {
          recordTaskError(cleanTitle(t.title), '歌词补齐失败：' + ((r && r.reason) || '未搜到匹配歌词'))
        }
      } catch (e) {
        recordTaskError(cleanTitle(t.title), '歌词接口错误：' + (e.message || e))
      }
    }
    try {
      const cr = await window.api.coverFix([t])
      if (cr && cr.done > 0) {
        covDone += cr.done
        coverCache.delete(t.path)
      } else if (cr && Array.isArray(cr.errors) && cr.errors.length) {
        cr.errors.forEach((er) => recordTaskError(er.name, er.reason))
      }
    } catch (e) {
      recordTaskError(cleanTitle(t.title), '封面补齐错误：' + (e.message || e))
    }
  }
  await rescan(false)
  finishTask(
    window.__deskHealthStop ? '曲库修复已停止' : '曲库体检修复完成',
    `新补齐歌词 ${lrcDone} 首，高清封面 ${covDone} 张${state.task.errors.length ? ` · 异常/未匹配 ${state.task.errors.length} 项` : ''}`,
    5500
  )
  render()
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
  '#/health': viewHealth,
  '#/settings': viewSettings,
}

let __actsBound = false
function bindRowActions() {
  if (__actsBound) return
  __actsBound = true
  const view = document.getElementById('view')
  view.addEventListener('click', (e) => {
    const qn = e.target.closest('[data-qnext]')
    if (qn) {
      e.stopPropagation()
      const t = state.tracks[+qn.dataset.qnext]
      if (t) playNextInsert(t)
      return
    }
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
      return
    }
    const sortBtn = e.target.closest('[data-sort]')
    if (sortBtn) {
      e.stopPropagation()
      state.listSort = sortBtn.dataset.sort || 'default'
      updateListBody()
      return
    }
    if (e.target.closest('[data-list-playall]')) {
      e.stopPropagation()
      const list = filterAndSortTracks(currentListBaseTracks())
      if (!list.length) { toast('列表为空'); return }
      state.queuePaths = list.map((x) => x.path)
      state.qPos = 0
      const first = list[0]
      playTrack(first, state.tracks.indexOf(first), { keepQueue: true })
      return
    }
    if (e.target.closest('[data-list-shuffle]')) {
      e.stopPropagation()
      const list = filterAndSortTracks(currentListBaseTracks())
      if (!list.length) { toast('列表为空'); return }
      setPlayMode('shuffle')
      const rIdx = Math.floor(Math.random() * list.length)
      state.queuePaths = list.map((x) => x.path)
      state.qPos = rIdx
      const chosen = list[rIdx]
      playTrack(chosen, state.tracks.indexOf(chosen), { keepQueue: true })
      toast('随机播放 ' + list.length + ' 首')
      return
    }
    const qHist = e.target.closest('[data-qhist]')
    if (qHist) {
      e.stopPropagation()
      search.kw = qHist.dataset.qhist || ''
      const inp = $('#searchInput')
      if (inp) inp.value = search.kw
      doSearch(search.kw)
      return
    }
    if (e.target.closest('[data-qhist-clear]')) {
      e.stopPropagation()
      clearSearchHist()
      render()
      return
    }
    const hTab = e.target.closest('[data-health-tab]')
    if (hTab) {
      e.stopPropagation()
      state.healthTab = hTab.dataset.healthTab || 'dup'
      render()
      return
    }
    if (e.target.closest('#btnHealthFixAll')) {
      e.stopPropagation()
      healthFixAll()
      return
    }
    // 主设置页 (#/settings) 事件委托
    const normBtn = e.target.closest('[data-set-norm]')
    if (normBtn) {
      state.normEnabled = normBtn.dataset.setNorm === '1'
      try { localStorage.setItem('desk:normEnabled', state.normEnabled ? '1' : '0') } catch { }
      applyCurrentTrackGain()
      render()
      toast(state.normEnabled ? '已开启全局音量平衡' : '已关闭全局音量平衡')
      return
    }
    const presetBtn = e.target.closest('[data-set-preset]')
    if (presetBtn) {
      state.normPreset = presetBtn.dataset.setPreset || 'standard'
      try { localStorage.setItem('desk:normPreset', state.normPreset) } catch { }
      applyCurrentTrackGain()
      render()
      return
    }
    const randBtn = e.target.closest('[data-set-rand]')
    if (randBtn) {
      state.randomStrategy = randBtn.dataset.setRand || 'no-repeat'
      state.shufflePlayed.clear()
      try { localStorage.setItem('desk:randomStrategy', state.randomStrategy) } catch { }
      paintPlayMode()
      render()
      const rNames = { 'no-repeat': '不重复随机', 'rare-first': '不常听优先随机', 'true-random': '真随机' }
      toast('随机策略已切换为：' + (rNames[state.randomStrategy] || '不重复随机'))
      return
    }
    const lrcSzBtn = e.target.closest('[data-set-lrcsz]')
    if (lrcSzBtn) {
      state.lrcSize = +lrcSzBtn.dataset.setLrcsz || 18
      applyLyricsStyle()
      render()
      return
    }
    const lrcColBtn = e.target.closest('[data-set-lrccolor]')
    if (lrcColBtn) {
      state.lrcColor = lrcColBtn.dataset.setLrccolor || '#ec4141'
      applyLyricsStyle()
      render()
      return
    }
    const themeBtn = e.target.closest('[data-set-theme]')
    if (themeBtn) {
      applyTheme(themeBtn.dataset.setTheme || 'auto')
      render()
      return
    }
    if (e.target.closest('#setPickRootBtn')) {
      pickRoot()
      return
    }
    if (e.target.closest('#setRescanBtn')) {
      rescan(true).then(() => render())
      return
    }
    if (e.target.closest('#setClearTrackGains')) {
      clearAllUserTrackGains()
      applyCurrentTrackGain()
      render()
      toast('已清空全部单曲音量微调记录')
      return
    }
    if (e.target.closest('#setOpenHealthBtn')) {
      location.hash = '#/health'
      return
    }
    if (e.target.closest('#setFixCoversBtn')) {
      fixCovers()
      return
    }
    if (e.target.closest('#setClearStatsBtn')) {
      clearSearchHist()
      try { localStorage.removeItem('desk:playCounts') } catch { }
      render()
      toast('已清空搜索历史与播放次数统计')
      return
    }
  })
  view.addEventListener('input', (e) => {
    if (e.target.id === 'listFilterInput') {
      state.listFilter = e.target.value
      updateListBody()
    } else if (e.target.id === 'searchInput') {
      search.kw = e.target.value
      updateHomeSearchBody()
    } else if (e.target.id === 'setLrcSizeRange') {
      state.lrcSize = +e.target.value || 18
      applyLyricsStyle()
      const badge = $('#setLrcSizeVal')
      if (badge) badge.textContent = state.lrcSize + 'px'
      const pEn = $('#setLrcPreviewEn')
      const pZh = $('#setLrcPreviewZh')
      if (pEn) pEn.style.fontSize = (state.lrcSize + 2) + 'px'
      if (pZh) pZh.style.fontSize = state.lrcSize + 'px'
    } else if (e.target.id === 'setLrcColorPicker') {
      state.lrcColor = e.target.value || '#ec4141'
      applyLyricsStyle()
      const pEn = $('#setLrcPreviewEn')
      const pZh = $('#setLrcPreviewZh')
      if (pEn) pEn.style.color = state.lrcColor
      if (pZh) pZh.style.color = state.lrcColor
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
  if (hash === '#/import') mountImportRowsChunked()
  bindRowActions()
  renderSidebar()
  $$('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.route === hash))

  if (hash === '#/home') {
    const input = $('#searchInput')
    input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch() })
    $('#btnSearch')?.addEventListener('click', () => doSearch())
    $$('.tab').forEach((el) => el.addEventListener('click', () => {
      search.tab = el.dataset.tab
      search.song = null
      search.songs = []
      search.voices = []
      render()
      if (search.kw) doSearch()
    }))
    bindHomeBodyEvents()
  }
  if (hash.startsWith('#/playlist/') || hash === '#/recent' || hash === '#/liked' || hash === '#/local') {
    bindListBodyEvents()
  }
  if (hash.startsWith('#/playlist/')) {
    const plId = hash.split('/').pop()
    $('#plDel')?.addEventListener('click', () => deletePlaylist(plId))
    $('#plRename')?.addEventListener('click', async () => {
      const v = getPlaylists()
      const pl = v.find((p) => p.id === plId)
      if (!pl) return
      const name = await askText('重命名歌单', pl.name)
      if (!name) return
      pl.name = name
      savePlaylists(v)
      renderSidebar()
      render()
    })
  }
  if (hash === '#/import') {
    $('#impParse')?.addEventListener('click', doImportParse)
    $('#impLink')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doImportParse() })
    $('#impAll')?.addEventListener('click', importAll)
    $('#impStop')?.addEventListener('click', () => { window.__deskImpStop = true })
    $('#impMatchStop')?.addEventListener('click', () => { window.__deskImpMatchStop = true; toast('正在暂停匹配…') })
    $('#impMatchResume')?.addEventListener('click', () => { matchAllImport(true) })
    $('#impClear')?.addEventListener('click', () => {
      window.__deskImpMatchStop = true
      imp.link = ''; imp.name = ''; imp.items = []; imp.err = ''; imp.open = -1; imp.matching = false
      scheduleSaveImpState(true)
      dismissTask()
      render()
      toast('已清空导入列表')
    })
    // 使用事件委托绑定导入列表动作（保证分片追加的后续行同样响应）
    const viewEl = $('#view')
    if (viewEl && !viewEl.dataset.impDelegated) {
      viewEl.dataset.impDelegated = '1'
      viewEl.addEventListener('keydown', (e) => {
        if (location.hash !== '#/import') return
        const kwIn = e.target.closest('[data-imp-kwin]')
        if (kwIn && e.key === 'Enter') {
          e.preventDefault()
          const idx = +kwIn.dataset.impKwin
          importInlineSearch(idx, kwIn.value, false)
        }
      })
      viewEl.addEventListener('click', async (e) => {
        if (location.hash !== '#/import') return
        const fBtn = e.target.closest('[data-imp-filter]')
        if (fBtn) {
          imp.filter = fBtn.dataset.impFilter || 'all'
          render()
          return
        }
        const sw = e.target.closest('[data-imp-swap]')
        if (sw) { importSwap(+sw.dataset.impSwap); return }
        const kwGo = e.target.closest('[data-imp-kwgo]')
        if (kwGo) {
          const idx = +kwGo.dataset.impKwgo
          const inEl = document.getElementById('impkw-' + idx)
          importInlineSearch(idx, inEl ? inEl.value : '', false)
          return
        }
        const kwPre = e.target.closest('[data-imp-kwpreset]')
        if (kwPre) {
          const [iStr, kind] = String(kwPre.dataset.impKwpreset).split(':')
          const idx = +iStr
          const it = imp.items[idx]
          if (!it) return
          const fa = firstArtistClean(it.song.artist)
          if (kind === 'smart') {
            it.customKw = [it.song.name, fa].filter(Boolean).join(' ').trim()
            importInlineSearch(idx, '', true)
          } else {
            const q = kind === 'name'
              ? String(it.song.name || '').replace(/^[『「《【]+|[』」》】]+$/g, '').trim()
              : kind === 'artist'
                ? (fa || it.song.artist || '')
                : [String(it.song.name || '').replace(/^[『「《【]+|[』」》】]+$/g, '').trim(), fa].filter(Boolean).join(' ')
            importInlineSearch(idx, q, false)
          }
          return
        }
        const rekw = e.target.closest('[data-imp-rekw]')
        if (rekw) { importRekw(+rekw.dataset.impRekw); return }
        const sk = e.target.closest('[data-imp-skip]')
        if (sk) {
          const idx = +sk.dataset.impSkip
          const it = imp.items[idx]
          if (it) {
            it.skip = !it.skip
            scheduleSaveImpState(false)
            updateSingleImpRow(idx)
            if (imp.open === idx) refreshOpenImpPanel(idx)
          }
          return
        }
        const pv = e.target.closest('[data-imp-pv]')
        if (pv) {
          e.stopPropagation()
          const [iStr, kStr] = String(pv.dataset.impPv).split(':')
          const it = imp.items[+iStr]
          const v = it && it.voices[+kStr]
          if (!v) return
          const id = String(v.mainTrackId)
          if (imp.prevId === id) {
            imp.prevId = ''
            stopPreview()
            refreshOpenImpPanel(+iStr)
            return
          }
          try {
            imp.prevId = id
            refreshOpenImpPanel(+iStr)
            const url = await window.api.preview(v.mainTrackId)
            if (!url) { imp.prevId = ''; refreshOpenImpPanel(+iStr); toast('试听不可用'); return }
            if (!audio.paused) audio.pause()
            const pa = $('#previewAudio')
            pa.src = url
            await pa.play()
          } catch {
            imp.prevId = ''
            refreshOpenImpPanel(+iStr)
          }
          return
        }
        const pk = e.target.closest('[data-imp-pick]')
        if (pk) {
          const [iStr, kStr] = String(pk.dataset.impPick).split(':')
          const idx = +iStr
          const it = imp.items[idx]
          if (it && it.voices[+kStr]) {
            it.pick = +kStr
            it.suspect = false
            it.suspectWhy = ''
            it.skip = false
            it.manual = true
            it.err = ''
            scheduleSaveImpState(false)
            updateSingleImpRow(idx)
            refreshOpenImpPanel(idx)
            toast('已选用：' + String(it.voices[+kStr].title || '').replace(/^声音[:：]?\s*/, ''))
          }
        }
      })
    }
  }
  $$('[data-rowcov]').forEach((el) => {
    const t = state.tracks[+el.dataset.rowcov]
    if (t) loadCover(t.path, (url) => setCover(el, url))
  })
  if (hash === '#/local') {
    $('#btnRescan')?.addEventListener('click', async () => { await rescan(true); render() })
    $('#btnPickRoot')?.addEventListener('click', pickRoot)
    $('#btnFixCover')?.addEventListener('click', fixCovers)
    $('#btnImport')?.addEventListener('click', () => { location.hash = '#/import' })
    $('#btnGoSettings')?.addEventListener('click', () => { location.hash = '#/settings' })
  }
  if (hash === '#/health') {
    $$('#view .track-row').forEach((el) => el.addEventListener('click', () => play(+el.dataset.i)))
  }
}

/* ---------------- 播放模式 / 队列 / 换声源 / 会话持久化 ---------------- */
const trackByPath = (p) => state.tracks.find((t) => t.path === p)

function paintPlayMode() {
  const btn = $('#pbMode')
  const ic = $('#pbModeIcon')
  const mName = state.mode === 'shuffle' ? '随机播放' : state.mode === 'one' ? '单曲循环' : '顺序循环'
  if (btn) {
    btn.classList.toggle('on', state.mode !== 'loop')
    btn.title = '播放模式：' + mName
  }
  if (ic) ic.innerHTML = MODE_ICONS[state.mode] || MODE_ICONS.loop
  const qc = $('#pbQueueCount')
  if (qc) qc.textContent = state.queuePaths.length ? String(state.queuePaths.length) : ''
  const sub = $('#lpHeadSub')
  if (sub) {
    sub.textContent = state.queuePaths.length && state.qPos >= 0
      ? `${mName} · ${state.qPos + 1} / ${state.queuePaths.length}`
      : '正在播放'
  }
}

function setPlayMode(mode) {
  state.mode = mode
  state.hist = []
  try { localStorage.setItem('desk:mode', mode) } catch { }
  paintPlayMode()
  savePlayerSession()
  if (state.sheetKind === 'queue') renderSheetDialog()
}

function cyclePlayMode() {
  const next = state.mode === 'loop' ? 'shuffle' : state.mode === 'shuffle' ? 'one' : 'loop'
  setPlayMode(next)
  toast(next === 'shuffle' ? '随机播放' : next === 'one' ? '单曲循环' : '顺序循环')
}

function applyVolume(v, muted) {
  if (typeof v === 'number') state.vol = Math.max(0, Math.min(1, v))
  if (typeof muted === 'boolean') state.muted = muted
  audio.volume = state.vol
  audio.muted = state.muted
  try { localStorage.setItem('desk:vol', String(state.vol)) } catch { }
  const pct = state.muted ? 0 : Math.round(state.vol * 100)
  const r = $('#volRange')
  if (r) r.value = String(pct)
  const p = $('#volPct')
  if (p) p.textContent = pct + '%'
  const b = $('#pbVol')
  if (b) b.textContent = (state.muted || pct === 0) ? '🔇' : pct < 45 ? '🔉' : '🔊'
}

let _posSaveAt = 0
function savePlayerSession(posOnly) {
  try {
    const curTrack = state.tracks[state.cur]
    const curPath = curTrack ? curTrack.path : (state.queuePaths[state.qPos] || '')
    if (!curPath) return
    if (!posOnly) {
      localStorage.setItem('desk:session', JSON.stringify({
        queue: state.queuePaths.slice(0, 500),
        qPos: state.qPos,
        path: curPath,
        mode: state.mode,
      }))
    }
    localStorage.setItem('desk:pos', JSON.stringify({
      path: curPath,
      pos: Math.floor(audio.currentTime || 0),
    }))
  } catch { }
}

async function restorePlayerSession() {
  if (!state.tracks.length || state.cur >= 0) return
  try {
    const sess = JSON.parse(localStorage.getItem('desk:session') || 'null')
    if (!sess || !sess.path) return
    const validQ = (sess.queue || []).filter((p) => trackByPath(p))
    if (!validQ.length) return
    let qi = validQ.indexOf(sess.path)
    if (qi < 0) qi = Math.min(Math.max(0, sess.qPos || 0), validQ.length - 1)
    const t = trackByPath(validQ[qi])
    if (!t) return
    state.queuePaths = validQ
    state.qPos = qi
    if (sess.mode) state.mode = sess.mode
    const posObj = JSON.parse(localStorage.getItem('desk:pos') || 'null')
    const savedSec = (posObj && posObj.path === t.path && posObj.pos > 0) ? posObj.pos : 0
    await playTrack(t, state.tracks.indexOf(t), { autoPlay: false, restoreSec: savedSec })
    paintPlayMode()
  } catch { }
}

function captureVisibleQueue(targetPath) {
  const rows = $$('#view .track-row')
  const paths = rows.map((el) => {
    if (el.dataset.path) return el.dataset.path
    if (el.dataset.i != null && state.tracks[+el.dataset.i]) return state.tracks[+el.dataset.i].path
    return ''
  }).filter(Boolean)
  if (paths.length && paths.includes(targetPath)) {
    state.queuePaths = paths
    state.qPos = paths.indexOf(targetPath)
  } else if (!state.queuePaths.includes(targetPath)) {
    state.queuePaths = state.tracks.map((t) => t.path)
    state.qPos = state.queuePaths.indexOf(targetPath)
  } else {
    state.qPos = state.queuePaths.indexOf(targetPath)
  }
}

function playNextInsert(t) {
  if (!t || !t.path) return
  if (!state.queuePaths.length || state.qPos < 0) {
    state.queuePaths = [t.path]
    state.qPos = 0
    playTrack(t, state.tracks.indexOf(t))
    toast('开始播放：' + cleanTitle(t.title))
    return
  }
  const curPath = state.queuePaths[state.qPos]
  if (curPath === t.path) {
    toast('当前正在播放这首歌')
    return
  }
  const exist = state.queuePaths.indexOf(t.path)
  if (exist >= 0) {
    state.queuePaths.splice(exist, 1)
    state.qPos = state.queuePaths.indexOf(curPath)
  }
  state.queuePaths.splice(state.qPos + 1, 0, t.path)
  paintPlayMode()
  savePlayerSession()
  toast('已设为下一首播放：' + cleanTitle(t.title))
}

// 三策略算法已下沉到 lib/random.js（纯函数，可被单测直接覆盖）；
// 这里只做「渲染层状态 → 纯函数入参」的适配，避免测试里重抄一份实现。
function pickNextShuffleIndex() {
  // 兜底：若 lib/random.js 未加载（旧安装包缺文件），退化为真随机，绝不让「切随机」直接抛错
  if (typeof MusicPlayRandom === 'undefined' || !MusicPlayRandom.pickNextShuffleIndex) {
    return Math.floor(Math.random() * Math.max(1, state.queuePaths.length))
  }
  return MusicPlayRandom.pickNextShuffleIndex({
    queuePaths: state.queuePaths,
    qPos: state.qPos,
    strategy: state.randomStrategy || 'no-repeat',
    playedSet: state.shufflePlayed,
    playCountOf: getPlayCount,
  })
}

function stepQueue(delta, autoEnded) {
  if (!state.queuePaths.length && state.tracks.length) {
    state.queuePaths = state.tracks.map((t) => t.path)
    state.qPos = Math.max(0, state.cur)
  }
  if (!state.queuePaths.length) return
  let nextPos = state.qPos
  if (autoEnded && state.mode === 'one' && state.qPos >= 0) {
    audio.currentTime = 0
    audio.play().catch(() => {})
    return
  } else if (state.mode === 'shuffle' && delta > 0) {
    nextPos = pickNextShuffleIndex()
    state.hist.push(state.qPos)
    if (state.hist.length > 200) state.hist.shift()
  } else if (state.mode === 'shuffle' && delta < 0 && state.hist.length) {
    nextPos = state.hist.pop()
  } else {
    nextPos = state.qPos + delta
    if (nextPos < 0) nextPos = state.queuePaths.length - 1
    if (nextPos >= state.queuePaths.length) nextPos = 0
  }
  state.qPos = nextPos
  const p = state.queuePaths[nextPos]
  const t = trackByPath(p)
  if (t) playTrack(t, state.tracks.indexOf(t), { keepQueue: true })
}

function play(i) {
  if (i < 0 || i >= state.tracks.length) return
  const t = state.tracks[i]
  captureVisibleQueue(t.path)
  return playTrack(t, i, { keepQueue: true })
}

async function playTrack(t, i, opts = {}) {
  if (!t) return
  state.cur = i
  if (!opts.keepQueue) captureVisibleQueue(t.path)
  pushRecent(t)

  stopPreview()
  if (opts.autoPlay !== false) incPlayCount(t.path)
  if (typeof t.gainDb !== 'number' && window.api && window.api.trackGain) {
    window.api.trackGain(t.path).then((g) => {
      t.gainDb = Number(g) || 0
      if (state.tracks[state.cur] === t) {
        applyCurrentTrackGain()
        if (state.lpMiniOpen) renderLpMiniPanel()
      }
    }).catch(() => {})
  }
  audio.src = toFileUrl(t.path) + (opts.bustCache ? `?t=${Date.now()}` : '')
  applyVolume(state.vol, state.muted)
  applyCurrentTrackGain()
  if (opts.restoreSec && opts.restoreSec > 0) {
    audio.addEventListener('loadedmetadata', function onMeta() {
      audio.removeEventListener('loadedmetadata', onMeta)
      try { audio.currentTime = opts.restoreSec } catch { }
      $('#pbCur').textContent = fmt(opts.restoreSec)
      const dur = audio.duration || t.duration || 0
      $('#pbDur').textContent = fmt(dur)
      if (dur > 0) {
        const pct = Math.min(100, (opts.restoreSec / dur) * 100)
        $('#pbSeek').value = String(Math.round(pct * 10))
        $('#pbSeek').style.setProperty('--seek-pct', pct.toFixed(1) + '%')
      }
    })
  }
  if (opts.autoPlay !== false) {
    audio.play().catch((e) => console.warn('播放失败', e))
  }
  const favOn = isFav(t.path)
  $('#pbFav')?.classList.toggle('on', favOn)
  $('#lpFav')?.classList.toggle('on', favOn)

  const title = cleanTitle(t.title)
  $('#pbTitle').textContent = title
  $('#pbArtist').textContent = (t.artist || '未知艺人') + (t.bitrate ? ` · ${t.bitrate}k` : '')
  $('#lpTitle').textContent = title
  $('#lpArtist').textContent = t.artist || '未知艺人'
  $('#pbDur').textContent = fmt(t.duration || 0)
  paintPlayMode()
  savePlayerSession()

  setCover($('#pbCover'), '')
  setCover($('#lpCover'), '')
  loadCover(t.path, (url) => {
    setCover($('#pbCover'), url)
    setCover($('#lpCover'), url)
    if (typeof extractAmbientColor === 'function') extractAmbientColor(url)
  })

  if (state.sheetKind === 'queue') renderSheetDialog()
  renderActiveRowInView()

  let lyr = await window.api.lyrics(t.path)
  if (!lyr.lines || !lyr.lines.length) {
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
  const savedOff = getOffset(t.path)
  state.offsetMs = savedOff == null ? 0 : savedOff
  updateOffsetChip()
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

function renderActiveRowInView() {
  const curTrack = state.tracks[state.cur]
  const curPath = curTrack ? curTrack.path : ''
  const paused = !audio || audio.paused
  $$('#view .track-row').forEach((el) => {
    const p = el.dataset.path || (el.dataset.i != null && state.tracks[+el.dataset.i] ? state.tracks[+el.dataset.i].path : '')
    const act = !!(curPath && p === curPath)
    el.classList.toggle('active', act)
    const tt = el.querySelector('.tt')
    if (tt) {
      const oldEq = tt.querySelector('.eq-bars')
      if (act && !oldEq) {
        tt.insertAdjacentHTML('afterbegin', `<span class="eq-bars${paused ? ' paused' : ''}"><i></i><i></i><i></i></span>`)
      } else if (!act && oldEq) {
        oldEq.remove()
      } else if (act && oldEq) {
        oldEq.classList.toggle('paused', paused)
      }
    }
  })
}

/* ---------------- 播放队列抽屉 & 播放页「更换声源」模态框 ---------------- */
function normKeyRaw(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^声音[:：]?\s*/, '')
    .replace(/^\d{1,3}\s*[-._、)\]]\s*/, '')
    .replace(/^\d{2}\s+(?=[a-z\u4e00-\u9fa5])/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}
function normKey(s) {
  const stripped = String(s || '')
    .replace(/^声音[:：]?\s*/, '')
    .replace(/^\d{1,3}\s*[-._、)\]]\s*/, '')
    .replace(/^\d{2}\s+(?=[a-z\u4e00-\u9fa5])/i, '')
    .replace(/\s+[【\[（(][^】\]）)]*[】\]）)]/g, ' ')
    .replace(/^[【\[（(][^】\]）)]*[】\]）)]\s*/g, ' ')
    .replace(/[（(][^）)]*(?:feat\.?|ver\.?|version|edit|mix|ost|op|ed|inst|off\s*vocal)[^）)]*[）)]/gi, ' ')
  const k = normKeyRaw(stripped)
  return k.length >= 2 ? k : normKeyRaw(s)
}
function isVariantTitle(vt, sn) {
  const re = /伴奏|纯音乐|inst(rumental)?\b|off\s*vocal|karaoke|钢琴版|吉他版|八音盒|铃声|片段|试听|[×x]\s*0\.\d+|0\.\d+\s*[×x]|slowed|nightcore|倍速/i
  return re.test(String(vt || '')) && !re.test(String(sn || ''))
}
function scoreVoiceCand(song, v) {
  const sName = String((song && song.name) || '')
  const vTitle = String((v && v.title) || '').replace(/^声音[:：]?\s*/, '').trim()
  const nsRaw = normKeyRaw(sName)
  const nsLoose = normKey(sName)
  const nvRaw = normKeyRaw(vTitle)
  const nvLoose = normKey(vTitle)
  const fa = normKeyRaw(firstArtistClean((song && song.artist) || ''))

  let tScore = 0
  if (!nsRaw && sName.trim()) {
    const sym = sName.trim()
    if (vTitle.includes(sym) || vTitle.includes('_') || vTitle.includes('-')) {
      tScore = (fa && nvRaw.includes(fa)) ? 60 : 40
    }
  } else {
    const candsS = [nsRaw, nsLoose]
    if (song && Array.isArray(song.alias)) {
      song.alias.forEach((al) => { const k = normKeyRaw(al); if (k) candsS.push(k) })
    }
    const candsV = [nvRaw, nvLoose]
    for (const ks of candsS) {
      for (const kv of candsV) {
        if (!ks || !kv) continue
        if (kv === ks) tScore = Math.max(tScore, 60)
        else if (kv.includes(ks)) tScore = Math.max(tScore, 48)
        else if (ks.includes(kv) && kv.length >= Math.max(2, Math.floor(ks.length * 0.45))) tScore = Math.max(tScore, 40)
      }
    }
  }
  if (fa && fa.length >= 2 && (nvRaw.includes(fa) || normKeyRaw(v.dj || '').includes(fa) || normKeyRaw(v.radio || '').includes(fa))) {
    tScore += 8
  }

  const a = +((song && song.duration) || 0), b = +((v && v.duration) || 0)
  const gap = (a && b) ? (b - a) : null
  let dScore = 0
  if (gap != null) {
    const ad = Math.abs(gap)
    if (ad <= 3) dScore = 50
    else if (ad <= 6) dScore = 38
    else if (ad <= 15) dScore = 15
    else if (ad > 28) dScore = -30
  }
  const isVar = isVariantTitle(vTitle, sName)
  if (isVar) dScore -= 30

  const bad = tScore < 30 || isVar || (gap != null && Math.abs(gap) > 28)
  const why = tScore < 30 ? '标题可能不符' : isVar ? '疑似非原曲版本' : (gap != null && Math.abs(gap) > 28 ? `时长差 ${fmt(Math.abs(gap))}` : '')
  return { v, score: tScore + dScore, gap, bad, why }
}

function sheetDialogHtml() {
  if (state.sheetKind === 'queue') {
    const modeLabel = state.mode === 'shuffle' ? '🔀 随机播放' : state.mode === 'one' ? '🔂 单曲循环' : '🔁 顺序循环'
    const paused = !audio || audio.paused
    const items = state.queuePaths.map((p, i) => {
      const t = trackByPath(p)
      if (!t) return ''
      const isCur = i === state.qPos
      const eq = isCur ? `<span class="eq-bars${paused ? ' paused' : ''}"><i></i><i></i><i></i></span>` : ''
      return `<div class="q-item${isCur ? ' cur' : ''}" data-q-jump="${i}">
        <div class="q-item-main">
          <div class="q-item-title">${eq}${i + 1}. ${esc(cleanTitle(t.title))}</div>
          <div class="q-item-sub">${esc(t.artist || '未知艺人')} · ${fmt(t.duration || 0)}</div>
        </div>
        <button class="q-item-rm" data-q-rm="${i}" title="从队列移除">✕</button>
      </div>`
    }).join('')
    return `<div class="sheet-panel">
      <div class="sheet-head-row">
        <div class="sheet-title">播放队列 (${state.queuePaths.length})</div>
        <div style="display:flex;gap:8px">
          <button class="sheet-sub-btn" data-q-mode="1">${modeLabel}</button>
          <button class="sheet-sub-btn danger" data-q-clear="1">清空</button>
        </div>
      </div>
      <div class="q-list" id="qListBox">
        ${items || '<div class="search-hint">播放队列为空</div>'}
      </div>
      <div style="display:flex;justify-content:flex-end">
        <button class="ask-btn ghost" data-sheet-close="1">关闭</button>
      </div>
    </div>`
  }
  if (state.sheetKind === 'source') {
    const sw = state.srcSwitch
    const t = sw.track || {}
    const curDur = fmt(t.duration || 0)
    const listHtml = sw.loading
      ? '<div class="search-hint">正在搜索匹配播客声源…</div>'
      : sw.err
        ? `<div class="search-hint" style="color:var(--red)">${esc(sw.err)}</div>`
        : !sw.cands.length
          ? '<div class="search-hint">未找到可用声源，可修改上方关键词重试</div>'
          : sw.cands.map((c, i) => {
              const v = c.v
              const isPv = sw.prevId && String(sw.prevId) === String(v.mainTrackId)
              const busy = sw.busyId && String(sw.busyId) === String(v.mainTrackId)
              const gapAbs = c.gap == null ? 999 : Math.abs(c.gap)
              const tagHtml = c.bad
                ? `<span class="src-tag warn">${esc(c.why || '时长不符')}</span>`
                : gapAbs <= 3
                  ? '<span class="src-tag">时长一致 · 推荐</span>'
                  : `<span class="src-tag">差 ${fmt(gapAbs)}</span>`
              return `<div class="src-item${i === 0 && !c.bad ? ' best' : ''}">
                <div class="src-cover" style="background-image:url('${esc(v.cover || '')}')"></div>
                <div class="src-main">
                  <div class="src-title">${esc(String(v.title || '未命名声源').replace(/^声音[:：]?\s*/, ''))}</div>
                  <div class="src-sub">
                    <span>${esc([v.dj ? 'by ' + v.dj : '', v.radio || '未知电台'].filter(Boolean).join(' · '))}</span>
                    <span>· ${fmt(v.duration)}</span>
                    <span>· ${fmtPlays(v.plays)}播放</span>
                    ${tagHtml}
                  </div>
                </div>
                <div class="src-acts">
                  <button class="src-pv${isPv ? ' on' : ''}" data-src-pv="${i}">${isPv ? '❚❚ 停止' : '▶ 试听'}</button>
                  <button class="src-use" data-src-use="${i}" ${busy ? 'disabled' : ''}>${busy ? '替换中…' : '选用替换'}</button>
                </div>
              </div>`
            }).join('')
    return `<div class="sheet-panel">
      <div class="sheet-head-row">
        <div>
          <div class="sheet-title">更换声源</div>
          <div class="sheet-sub" style="margin-top:2px">${esc(cleanTitle(t.title || '未知歌曲'))} — ${esc(t.artist || '未知艺人')}（当前时长 ${curDur}）</div>
        </div>
        ${sw.prevId ? '<button class="sheet-sub-btn" data-src-restore="1">恢复原曲</button>' : ''}
      </div>
      <div class="src-search">
        <input id="srcKwInput" type="search" value="${esc(sw.kw || '')}" placeholder="输入歌名 / 歌手重新搜索声源">
        <button class="ask-btn" id="srcKwGo">搜索</button>
      </div>
      <div id="srcDlBox" class="imp-q" style="${sw.busyId || sw.dlErr ? 'margin:0 0 8px' : 'display:none'}">
        <div class="imp-q-track"><div class="imp-q-bar" id="srcDlBar" style="width:${sw.dlPct || 40}%"></div></div>
        <div class="imp-q-text" id="srcDlText" style="${sw.dlErr ? 'color:var(--red)' : ''}">${esc(sw.dlErr || sw.dlText || '正在下载高音质声源并替换本地音频…')}</div>
      </div>
      <div class="src-list">${listHtml}</div>
      <div style="display:flex;justify-content:flex-end">
        <button class="ask-btn ghost" data-sheet-close="1">关闭</button>
      </div>
    </div>`
  }
  if (state.sheetKind === 'taskerr') {
    const errs = (state.task && state.task.errors) || []
    const rows = errs.map((er, i) => `
      <div class="err-item">
        <div class="err-item-t">${i + 1}. ${esc(er.name)}</div>
        <div class="err-item-s">${esc(er.reason)}</div>
      </div>`).join('')
    return `<div class="sheet-panel">
      <div class="sheet-head-row">
        <div>
          <div class="sheet-title">任务报错与异常详情 (${errs.length})</div>
          <div class="sheet-sub" style="margin-top:2px">${esc(state.task.title || '')}</div>
        </div>
      </div>
      <div class="err-list">${rows || '<div class="search-hint">暂无报错记录</div>'}</div>
      <div style="display:flex;justify-content:flex-end">
        <button class="ask-btn ghost" data-sheet-close="1">关闭</button>
      </div>
    </div>`
  }
  return ''
}

function renderSheetDialog() {
  const dlg = $('#sheetDlg')
  if (!dlg || !state.sheetKind) return
  dlg.innerHTML = sheetDialogHtml()
  if (!dlg.open) dlg.showModal()
}

function closeSheetDialog() {
  const dlg = $('#sheetDlg')
  if (state.sheetKind === 'source' && state.srcSwitch.prevId) {
    restoreSourceOriginal()
  }
  state.sheetKind = ''
  if (dlg && dlg.open) dlg.close()
}

function openQueueDialog() {
  state.sheetKind = 'queue'
  renderSheetDialog()
  setTimeout(() => {
    const curEl = document.querySelector('#qListBox .q-item.cur')
    if (curEl && curEl.scrollIntoView) curEl.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, 50)
}

async function openSourceDialog() {
  const t = state.tracks[state.cur]
  if (!t) { toast('请先播放一首本地歌曲'); return }
  const kw = [cleanTitle(t.title), t.artist].filter(Boolean).join(' ').trim()
  state.srcSwitch = {
    track: t,
    kw,
    loading: true,
    cands: [],
    err: '',
    prevId: '',
    busyId: '',
    savedTime: audio.currentTime || 0,
    wasPlaying: !audio.paused,
  }
  state.sheetKind = 'source'
  renderSheetDialog()
  await searchSourceDialogCands(kw, true)
}

async function searchSourceDialogCands(kw, initialSmart) {
  const sw = state.srcSwitch
  const t = sw.track
  if (!t) return
  kw = String(kw || '').trim()
  sw.kw = kw
  sw.loading = true
  sw.err = ''
  renderSheetDialog()
  try {
    let raw = []
    if (initialSmart) {
      raw = await window.api.searchVoices({ name: cleanTitle(t.title), artist: t.artist, duration: t.duration })
    } else {
      raw = await window.api.searchVoices(kw || cleanTitle(t.title))
    }
    const songObj = { name: cleanTitle(t.title) || kw, duration: t.duration || 0 }
    sw.cands = (raw || []).map((v) => scoreVoiceCand(songObj, v)).sort((a, b) => b.score - a.score)
    sw.loading = false
  } catch (e) {
    sw.loading = false
    sw.err = '搜索声源失败：' + (e.message || e)
  }
  renderSheetDialog()
}

async function previewSourceDialogCand(idx) {
  const sw = state.srcSwitch
  const item = sw.cands[idx]
  if (!item || !item.v) return
  const v = item.v
  const id = String(v.mainTrackId)
  if (sw.prevId === id) {
    restoreSourceOriginal()
    return
  }
  try {
    sw.prevId = id
    renderSheetDialog()
    toast('正在获取试听：' + (v.title || ''))
    const url = await window.api.preview(v.mainTrackId)
    if (!url) {
      sw.prevId = ''
      renderSheetDialog()
      toast('该声源暂不可试听')
      return
    }
    if (!audio.paused) audio.pause()
    const pa = $('#previewAudio')
    pa.src = url
    await pa.play()
    renderSheetDialog()
  } catch (e) {
    sw.prevId = ''
    renderSheetDialog()
    toast('试听失败：' + (e.message || e))
  }
}

function restoreSourceOriginal() {
  const sw = state.srcSwitch
  sw.prevId = ''
  stopPreview()
  if (sw.wasPlaying) audio.play().catch(() => {})
  if (state.sheetKind === 'source') renderSheetDialog()
}

async function applySourceDialogCand(idx) {
  const sw = state.srcSwitch
  const item = sw.cands[idx]
  const t = sw.track
  if (!item || !item.v || !t) return
  const v = item.v
  sw.busyId = String(v.mainTrackId)
  sw.dlPct = 45
  sw.dlText = `正在下载声源《${v.title || ''}》并替换本地音频…`
  sw.dlErr = ''
  renderSheetDialog()
  try {
    stopPreview()
    audio.pause()
    const r = await window.api.replaceSource({
      targetPath: t.path,
      voice: v,
      song: { name: cleanTitle(t.title), artist: t.artist, album: t.album, cover: '' },
    })
    t.duration = v.duration || t.duration
    if (r && r.br) t.bitrate = Math.round(r.br / 1000)
    coverCache.delete(t.path)
    sw.busyId = ''
    sw.prevId = ''
    sw.dlErr = ''
    state.sheetKind = ''
    $('#sheetDlg')?.close()
    await playTrack(t, state.cur, { keepQueue: true, bustCache: true, restoreSec: sw.savedTime })
    toast('已更换声源：' + (v.title || ''))
  } catch (e) {
    sw.busyId = ''
    sw.dlErr = '更换声源失败：' + (e.message || e)
    renderSheetDialog()
    toast(sw.dlErr)
  }
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
    for (let i = 0; i < kids.length; i++) {
      const dist = Math.abs(i - idx)
      kids[i].classList.toggle('cur', i === idx)
      kids[i].classList.toggle('near', dist === 1)
      kids[i].classList.toggle('far', dist >= 3)
    }
    state.activeIdx = idx
    pushFloat()
  }

  const following = Date.now() - (state.lastUserScrollAt || 0) > 3000
  if (!force && !following) return          // 用户刚滑动过，先不抢

  // 首句（或还没到第一句）→ 顶部对齐；其余居中
  if (idx <= 0) {
    scrollLyricsTo(0, !force)
  } else {
    const el = kids[idx]
    if (!el) return
    const top = el.offsetTop - pane.clientHeight / 2 + el.offsetHeight / 2
    scrollLyricsTo(top, !force)
  }
  // 自动跟随恢复（无论 force 还是 3 秒静默后自动恢复）都要收起「回到当前句」胶囊，
  // 否则用户滚过一次、3 秒后自动恢复了，胶囊还会一直挂在那里。
  if (force) state.lastUserScrollAt = 0
  $('#lpResume')?.classList.add('hidden')
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
/** 最近一次「程序自动滚动」的时刻；用于把自动跟随产生的 scroll 事件与用户滚动区分开 */
let lyricsAutoScrollAt = 0

/** 歌词区唯一的程序滚动入口（禁止直接调 pane.scrollTo，否则会被当成用户滚动） */
function scrollLyricsTo(top, smooth) {
  const pane = document.querySelector('.lp-right')
  if (!pane) return
  lyricsAutoScrollAt = Date.now()
  try {
    pane.scrollTo({ top: Math.max(0, Math.round(top)), behavior: smooth ? 'smooth' : 'auto' })
  } catch (e) {
    pane.scrollTop = Math.max(0, Math.round(top))
  }
}

function bindLyricsInteraction() {
  const pane = document.querySelector('.lp-right')
  if (!pane) return
  if (!pane.dataset.bound) {
    pane.dataset.bound = '1'
    pane.addEventListener('wheel', markUserScroll, { passive: true })
    pane.addEventListener('touchmove', markUserScroll, { passive: true })
    // 滚动条拖动 / 触控板两指滚动不会触发 wheel，靠 scroll 事件兜底。
    // 必须能区分「自动跟随滚动」与「用户滚动」，否则自动跟随会被自己触发而永久失效：
    //   - 平滑滚动是异步的（Chromium 约 200~400ms），期间 scrollTop 还会经过中间值，
    //     所以不能用「位置是否等于目标」判断，也不能用一个很短的定时器清理标志；
    //   - 用「最近一次程序滚动调用时刻」的时间窗判定，并用 scrollend 提前收尾。
    pane.addEventListener('scroll', () => {
      if (Date.now() - lyricsAutoScrollAt < 800) return   // 程序滚动窗口内，忽略
      markUserScroll()
    }, { passive: true })
    // Chromium 114+ 支持 scrollend：平滑滚动结束时立刻关闭窗口，避免误吞用户滚动
    pane.addEventListener('scrollend', () => { lyricsAutoScrollAt = 0 }, { passive: true })
    // 键盘翻页/方向键滚动
    pane.addEventListener('keydown', (e) => {
      if (e.key === 'PageUp' || e.key === 'PageDown' || e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') {
        markUserScroll()
      }
    })
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
  if (el) {
    const ms = Math.round(state.offsetMs || 0)
    el.textContent = '偏移 ' + (ms > 0 ? '+' : '') + (ms / 1000).toFixed(1) + 's'
    el.style.color = ms ? 'var(--red)' : ''
    el.style.borderColor = ms ? 'var(--red)' : ''
  }
  if (state.lpMiniOpen) renderLpMiniPanel()
}

function nudgeOffset(deltaMs) {
  const t = state.tracks[state.cur]
  if (!t) return
  state.offsetMs = Math.round((state.offsetMs || 0) + deltaMs)
  setOffset(t.path, state.offsetMs)
  updateOffsetChip()
  syncLyrics(true)
}

/* ---------------- 歌曲播放页小设置浮层（单曲声音平衡 / 歌词延迟 / 悬浮歌词设计） ---------------- */
function renderLpMiniPanel() {
  const box = $('#lpMiniPanel')
  if (!box) return
  box.classList.toggle('hidden', !state.lpMiniOpen)
  $('#lpGearBtn')?.classList.toggle('on', !!state.lpMiniOpen)
  $('#lpMiniBtn2')?.classList.toggle('on', !!state.lpMiniOpen)
  if (!state.lpMiniOpen) return

  const t = state.tracks[state.cur]
  const { autoDb, manualDb, totalDb } = getCurrentTrackEffectiveGain()
  const offSec = ((state.offsetMs || 0) / 1000).toFixed(1)
  const floatSwatches = ['#ffffff', '#ec4141', '#4da3ff', '#ffd54a', '#4ade80', '#ff8ad4', '#c084fc', '#111114']

  box.innerHTML = `
    <div class="lp-mini-sec">
      <div class="lp-mini-head">
        <span class="lp-mini-title">♪ 本曲声音平衡（单歌独立调整）</span>
        <span class="lp-mini-sub" id="lpMiniGainInfo">自动 ${autoDb >= 0 ? '+' : ''}${autoDb.toFixed(1)}dB · 合成 ${totalDb >= 0 ? '+' : ''}${totalDb.toFixed(1)}dB</span>
      </div>
      <div class="lp-mini-row">
        <span style="font-size:12px;color:var(--dim)">本曲微调</span>
        <input type="range" id="lpMiniGainRange" min="-12" max="12" step="0.5" value="${manualDb}">
        <span class="set-val-badge" id="lpMiniGainVal">${manualDb > 0 ? '+' : ''}${manualDb.toFixed(1)}dB</span>
      </div>
      <div class="lp-mini-chips">
        <button class="lp-mini-chip" data-mini-gain="-1.5">-1.5dB</button>
        <button class="lp-mini-chip" data-mini-gain="-0.5">-0.5dB</button>
        <button class="lp-mini-chip${manualDb === 0 ? ' on' : ''}" data-mini-gain="reset">重置 0dB</button>
        <button class="lp-mini-chip" data-mini-gain="0.5">+0.5dB</button>
        <button class="lp-mini-chip" data-mini-gain="1.5">+1.5dB</button>
        <button class="lp-mini-chip${state.normEnabled ? ' on' : ''}" data-mini-normtoggle="1" style="margin-left:auto">${state.normEnabled ? '全局均衡:开' : '全局均衡:关'}</button>
      </div>
    </div>

    <div class="lp-mini-sec">
      <div class="lp-mini-head">
        <span class="lp-mini-title">⏱ 本曲歌词延迟微调</span>
        <span class="lp-mini-sub" id="lpMiniOffVal">当前偏移 ${state.offsetMs > 0 ? '+' : ''}${offSec}s</span>
      </div>
      <div class="lp-mini-row">
        <span style="font-size:12px;color:var(--dim)">时间轴</span>
        <input type="range" id="lpMiniOffRange" min="-5000" max="5000" step="100" value="${Math.max(-5000, Math.min(5000, state.offsetMs || 0))}">
      </div>
      <div class="lp-mini-chips">
        <button class="lp-mini-chip" data-mini-off="-500">-0.5s</button>
        <button class="lp-mini-chip" data-mini-off="-100">提前 0.1s</button>
        <button class="lp-mini-chip${!state.offsetMs ? ' on' : ''}" data-mini-off="reset">重置 0.0s</button>
        <button class="lp-mini-chip" data-mini-off="100">延后 0.1s</button>
        <button class="lp-mini-chip" data-mini-off="500">+0.5s</button>
      </div>
    </div>

    <div class="lp-mini-sec">
      <div class="lp-mini-head">
        <span class="lp-mini-title">💬 悬浮歌词设计</span>
        <div style="display:flex;gap:6px">
          <button class="lp-mini-chip${state.floatOn ? ' on' : ''}" data-mini-float="toggle">${state.floatOn ? '悬浮窗:已开' : '开启悬浮窗'}</button>
          <button class="lp-mini-chip${state.floatLocked ? ' on' : ''}" data-mini-float="lock">${state.floatLocked ? '🔓 解锁穿透' : '🔒 锁定穿透'}</button>
        </div>
      </div>
      <div class="lp-mini-row">
        <span style="font-size:12px;color:var(--dim);min-width:48px">字号</span>
        <input type="range" id="lpMiniFloatSz" min="14" max="40" step="1" value="${state.floatSize}">
        <span class="set-val-badge" id="lpMiniFloatSzVal">${state.floatSize}px</span>
      </div>
      <div class="lp-mini-row">
        <span style="font-size:12px;color:var(--dim);min-width:48px">底色度</span>
        <input type="range" id="lpMiniFloatBg" min="0" max="80" step="5" value="${state.floatBgOpacity}">
        <span class="set-val-badge" id="lpMiniFloatBgVal">${state.floatBgOpacity}%</span>
      </div>
      <div class="lp-mini-row">
        <span style="font-size:12px;color:var(--dim);min-width:48px">配色</span>
        <div class="set-swatches">
          ${floatSwatches.map((c) => `<span class="set-swatch${state.floatColor.toLowerCase() === c ? ' on' : ''}" data-mini-floatcol="${c}" style="width:20px;height:20px;background:${c}"></span>`).join('')}
        </div>
      </div>
    </div>`
}

function toggleLpMiniPanel(forceState) {
  state.lpMiniOpen = typeof forceState === 'boolean' ? forceState : !state.lpMiniOpen
  renderLpMiniPanel()
}

async function openLyrics() {
  if (state.cur < 0 && state.tracks.length) {
    await playTrack(state.tracks[0], 0, { autoPlay: false })
  }
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
  state.lpMiniOpen = false
  renderLpMiniPanel()
  $('#lyricsPage').classList.add('hidden')
}

/* ---------------- 事件 ---------------- */
function setPlayIcon(playing) {
  $('#pbPlay').innerHTML = playing ? ICON_PAUSE : ICON_PLAY
  $$('.eq-bars').forEach((el) => el.classList.toggle('paused', !playing))
}

function bindGlobal() {
  $$('.tb-btns button').forEach((b) => b.addEventListener('click', () => {
    const act = b.dataset.win
    if (act === 'min') window.api.winMin()
    else if (act === 'max') window.api.winMax()
    else if (act === 'close') window.api.winClose()
  }))

  $$('.nav-item').forEach((el) => el.addEventListener('click', () => { location.hash = el.dataset.route }))
  $('#btnNewPlaylist')?.addEventListener('click', async () => {
    const name = await askText('新建歌单', '我的新歌单')
    if (!name) return
    const v = getPlaylists()
    const id = String(Date.now())
    v.push({ id, name, tracks: [] })
    savePlaylists(v)
    renderSidebar()
    location.hash = `#/playlist/${id}`
  })
  $('#btnPickFolder')?.addEventListener('click', async () => {
    const dir = await window.api.pickFolder()
    if (!dir) return
    const lib = await window.api.scan(dir)
    state.tracks = lib.tracks
    state.root = lib.root
    location.hash = '#/local'
    render()
  })

  $('#taskBanner')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-task-err]')) {
      openTaskErrorDialog()
    } else if (e.target.closest('[data-task-dismiss]')) {
      dismissTask()
    } else if (e.target.closest('[data-task-stop]')) {
      const k = state.task.kind
      if (k === 'scan') { if (window.api && window.api.cancelScan) window.api.cancelScan() }
      else if (k === 'cover') window.__deskCoverStop = true
      else if (k === 'healthfix') window.__deskHealthStop = true
      else if (k === 'impmatch') window.__deskImpMatchStop = true
      else if (k === 'impdl') window.__deskImpStop = true
      toast('正在停止当前任务…')
    }
  })
  $('#btnTheme')?.addEventListener('click', cycleTheme)
  $('#pbMode')?.addEventListener('click', cyclePlayMode)
  $('#pbQueue')?.addEventListener('click', openQueueDialog)
  $('#pbSource')?.addEventListener('click', openSourceDialog)
  $('#lpSwitchSource')?.addEventListener('click', openSourceDialog)
  $('#lpSourceBtn')?.addEventListener('click', openSourceDialog)

  $('#pbPlay').addEventListener('click', () => {
    if (state.cur < 0 && state.tracks.length) return play(0)
    audio.paused ? audio.play() : audio.pause()
  })
  $('#pbPrev').addEventListener('click', () => stepQueue(-1, false))
  $('#pbNext').addEventListener('click', () => stepQueue(1, false))
  $('#pbSeek').addEventListener('input', (e) => {
    if (!audio.duration) return
    const pct = (+e.target.value / 10)
    e.target.style.setProperty('--seek-pct', pct.toFixed(1) + '%')
    audio.currentTime = (+e.target.value / 1000) * audio.duration
  })
  $('#pbFav').addEventListener('click', () => {
    const t = state.tracks[state.cur]
    if (t) toggleFav(t); else toast('先播一首歌')
  })
  $('#lpFav')?.addEventListener('click', () => {
    const t = state.tracks[state.cur]
    if (t) toggleFav(t); else toast('先播一首歌')
  })
  $('#pbAdd').addEventListener('click', (e) => {
    const t = state.tracks[state.cur]
    if (!t) { toast('先播一首歌'); return }
    openAddMenu(t, e.currentTarget)
  })
  $('#lpAddPl')?.addEventListener('click', (e) => {
    const t = state.tracks[state.cur]
    if (!t) { toast('先播一首歌'); return }
    openAddMenu(t, e.currentTarget)
  })

  // 音量浮层与滚轮调节
  const volWrap = $('#volWrap')
  const volPop = $('#volPop')
  let volHideTimer = null
  if (volWrap && volPop) {
    volWrap.addEventListener('mouseenter', () => {
      clearTimeout(volHideTimer)
      volPop.classList.remove('hidden')
    })
    volWrap.addEventListener('mouseleave', () => {
      volHideTimer = setTimeout(() => volPop.classList.add('hidden'), 260)
    })
    volWrap.addEventListener('wheel', (e) => {
      e.preventDefault()
      const delta = e.deltaY < 0 ? 0.05 : -0.05
      applyVolume(state.vol + delta, false)
    }, { passive: false })
  }
  $('#pbVol')?.addEventListener('click', () => {
    applyVolume(state.vol, !state.muted)
    toast(state.muted ? '已静音' : `音量 ${Math.round(state.vol * 100)}%`)
  })
  $('#volRange')?.addEventListener('input', (e) => {
    applyVolume(+e.target.value / 100, false)
  })

  // 播放队列 & 换声源对话框事件委托
  const sheetDlg = $('#sheetDlg')
  if (sheetDlg) {
    sheetDlg.addEventListener('click', (e) => {
      if (e.target === sheetDlg || e.target.closest('[data-sheet-close]')) {
        closeSheetDialog()
        return
      }
      const qJump = e.target.closest('[data-q-jump]')
      if (qJump && !e.target.closest('[data-q-rm]')) {
        const jIdx = +qJump.dataset.qJump
        const p = state.queuePaths[jIdx]
        const jt = trackByPath(p)
        if (jt) {
          state.qPos = jIdx
          playTrack(jt, state.tracks.indexOf(jt), { keepQueue: true })
          renderSheetDialog()
        }
        return
      }
      const qRm = e.target.closest('[data-q-rm]')
      if (qRm) {
        e.stopPropagation()
        const rmIdx = +qRm.dataset.qRm
        if (rmIdx >= 0 && rmIdx < state.queuePaths.length) {
          const wasCur = rmIdx === state.qPos
          state.queuePaths.splice(rmIdx, 1)
          if (!state.queuePaths.length) {
            state.qPos = -1
            state.cur = -1
            audio.pause()
          } else if (wasCur) {
            state.qPos = Math.min(rmIdx, state.queuePaths.length - 1)
            const nt = trackByPath(state.queuePaths[state.qPos])
            if (nt) playTrack(nt, state.tracks.indexOf(nt), { keepQueue: true })
          } else if (rmIdx < state.qPos) {
            state.qPos--
          }
          paintPlayMode()
          savePlayerSession()
          renderSheetDialog()
        }
        return
      }
      if (e.target.closest('[data-q-mode]')) {
        cyclePlayMode()
        return
      }
      if (e.target.closest('[data-q-clear]')) {
        state.queuePaths = []
        state.qPos = -1
        state.cur = -1
        audio.pause()
        paintPlayMode()
        savePlayerSession()
        closeSheetDialog()
        toast('已清空播放队列')
        return
      }
      const srcPv = e.target.closest('[data-src-pv]')
      if (srcPv) {
        previewSourceDialogCand(+srcPv.dataset.srcPv)
        return
      }
      const srcUse = e.target.closest('[data-src-use]')
      if (srcUse) {
        applySourceDialogCand(+srcUse.dataset.srcUse)
        return
      }
      if (e.target.closest('[data-src-restore]')) {
        restoreSourceOriginal()
        toast('已恢复原曲播放')
        return
      }
      if (e.target.closest('#srcKwGo')) {
        const inp = $('#srcKwInput')
        searchSourceDialogCands(inp ? inp.value : state.srcSwitch.kw, false)
        return
      }
    })
    sheetDlg.addEventListener('keydown', (e) => {
      if (e.target.id === 'srcKwInput' && e.key === 'Enter') {
        e.preventDefault()
        searchSourceDialogCands(e.target.value, false)
      }
    })
    sheetDlg.addEventListener('cancel', (e) => {
      e.preventDefault()
      closeSheetDialog()
    })
  }

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
  $('#lpGearBtn')?.addEventListener('click', (e) => { e.stopPropagation(); toggleLpMiniPanel() })
  $('#lpMiniBtn2')?.addEventListener('click', (e) => { e.stopPropagation(); toggleLpMiniPanel() })
  $('#lpGainBadge')?.addEventListener('click', (e) => { e.stopPropagation(); toggleLpMiniPanel(true) })

  const miniPanel = $('#lpMiniPanel')
  if (miniPanel) {
    miniPanel.addEventListener('click', async (e) => {
      e.stopPropagation()
      const t = state.tracks[state.cur]
      const gBtn = e.target.closest('[data-mini-gain]')
      if (gBtn && t) {
        const raw = gBtn.dataset.miniGain
        const curM = getUserTrackGain(t.path)
        const nextM = raw === 'reset' ? 0 : Math.max(-12, Math.min(12, curM + (+raw || 0)))
        setUserTrackGain(t.path, nextM)
        applyCurrentTrackGain()
        renderLpMiniPanel()
        return
      }
      if (e.target.closest('[data-mini-normtoggle]')) {
        state.normEnabled = !state.normEnabled
        try { localStorage.setItem('desk:normEnabled', state.normEnabled ? '1' : '0') } catch { }
        applyCurrentTrackGain()
        renderLpMiniPanel()
        if (location.hash === '#/settings') render()
        return
      }
      const oBtn = e.target.closest('[data-mini-off]')
      if (oBtn && t) {
        const raw = oBtn.dataset.miniOff
        if (raw === 'reset') {
          state.offsetMs = 0
          setOffset(t.path, 0)
          updateOffsetChip()
          syncLyrics(true)
        } else {
          nudgeOffset(+raw || 0)
        }
        return
      }
      const fBtn = e.target.closest('[data-mini-float]')
      if (fBtn) {
        const act = fBtn.dataset.miniFloat
        if (act === 'toggle') {
          const on = await window.api.floatToggle()
          state.floatOn = on
          $('#pbFloat')?.classList.toggle('active', on)
          if (on) setTimeout(() => { pushFloat(); pushFloatStyle() }, 350)
          renderLpMiniPanel()
        } else if (act === 'lock') {
          state.floatLocked = !state.floatLocked
          window.api.floatLock?.(state.floatLocked)
          renderLpMiniPanel()
        }
        return
      }
      const fcBtn = e.target.closest('[data-mini-floatcol]')
      if (fcBtn) {
        state.floatColor = fcBtn.dataset.miniFloatcol || '#ffffff'
        pushFloatStyle()
        renderLpMiniPanel()
      }
    })
    miniPanel.addEventListener('input', (e) => {
      const t = state.tracks[state.cur]
      if (e.target.id === 'lpMiniGainRange' && t) {
        const v = +e.target.value || 0
        setUserTrackGain(t.path, v)
        const { autoDb, manualDb, totalDb } = applyCurrentTrackGain()
        const vEl = $('#lpMiniGainVal')
        if (vEl) vEl.textContent = `${manualDb > 0 ? '+' : ''}${manualDb.toFixed(1)}dB`
        const infoEl = $('#lpMiniGainInfo')
        if (infoEl) infoEl.textContent = `自动 ${autoDb >= 0 ? '+' : ''}${autoDb.toFixed(1)}dB · 合成 ${totalDb >= 0 ? '+' : ''}${totalDb.toFixed(1)}dB`
      } else if (e.target.id === 'lpMiniOffRange' && t) {
        state.offsetMs = Math.round(+e.target.value || 0)
        setOffset(t.path, state.offsetMs)
        const vEl = $('#lpMiniOffVal')
        if (vEl) vEl.textContent = `当前偏移 ${state.offsetMs > 0 ? '+' : ''}${(state.offsetMs / 1000).toFixed(1)}s`
        syncLyrics(true)
      } else if (e.target.id === 'lpMiniFloatSz') {
        state.floatSize = +e.target.value || 22
        const vEl = $('#lpMiniFloatSzVal')
        if (vEl) vEl.textContent = state.floatSize + 'px'
        pushFloatStyle()
      } else if (e.target.id === 'lpMiniFloatBg') {
        state.floatBgOpacity = +e.target.value || 0
        const vEl = $('#lpMiniFloatBgVal')
        if (vEl) vEl.textContent = state.floatBgOpacity + '%'
        pushFloatStyle()
      }
    })
  }
  document.addEventListener('click', (e) => {
    if (
      state.lpMiniOpen &&
      !e.target.closest('#lpMiniPanel') &&
      !e.target.closest('#lpGearBtn') &&
      !e.target.closest('#lpMiniBtn2') &&
      !e.target.closest('#lpGainBadge')
    ) {
      toggleLpMiniPanel(false)
    }
  })
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if ($('#sheetDlg')?.open) { closeSheetDialog(); return }
      closeLyrics()
      return
    }
    const inInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
    if (!inInput) {
      if (e.key === ' ') {
        e.preventDefault()
        $('#pbPlay').click()
      } else if (e.key === '[' && state.cur >= 0) {
        nudgeOffset(-100)
      } else if (e.key === ']' && state.cur >= 0) {
        nudgeOffset(100)
      } else if (e.ctrlKey && e.key === 'ArrowRight') {
        e.preventDefault()
        stepQueue(1, false)
      } else if (e.ctrlKey && e.key === 'ArrowLeft') {
        e.preventDefault()
        stepQueue(-1, false)
      }
    }
  })

  audio.addEventListener('timeupdate', () => {
    const dur = audio.duration || 0
    $('#pbCur').textContent = fmt(audio.currentTime)
    $('#pbDur').textContent = fmt(dur)
    if (dur > 0) {
      const pct = Math.min(100, (audio.currentTime / dur) * 100)
      const seek = $('#pbSeek')
      if (seek) {
        seek.value = String(Math.round(pct * 10))
        seek.style.setProperty('--seek-pct', pct.toFixed(1) + '%')
      }
    }
    if (Date.now() - _posSaveAt > 4000) {
      _posSaveAt = Date.now()
      savePlayerSession(true)
    }
    syncLyrics(false)
  })
  audio.addEventListener('play', () => {
    setPlayIcon(true)
    document.body.classList.add('mp-playing')
    applyCurrentTrackGain()
  })
  audio.addEventListener('pause', () => { setPlayIcon(false); document.body.classList.remove('mp-playing') })
  audio.addEventListener('ended', () => {
    stepQueue(1, true)
  })

  // 悬浮歌词窗发来的 上一曲/下一曲
  window.api.onPlayerCmd?.((cmd) => {
    if (cmd === 'prev') stepQueue(-1, false)
    else if (cmd === 'next') stepQueue(1, false)
  })

  applyVolume(state.vol, state.muted)
  paintPlayMode()
  setPlayIcon(false)
}

/* ---------------- 启动 ---------------- */
;(async function init() {
  applyTheme()
  applyLyricsStyle()
  try {
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')
    if (mq && mq.addEventListener) {
      mq.addEventListener('change', () => { if (state.theme === 'auto') applyTheme() })
    }
  } catch { }
  restoreImpState()
  bindGlobal()
  if (!location.hash) location.hash = '#/home'
  window.addEventListener('hashchange', () => {
    markNavTransition()
    state.listFilter = ''
    render()
  })

  // 悬浮窗初始状态以主进程为准（托盘/快捷键开的窗也要能同步到 UI）
  try {
    const on = await window.api.floatIsOpen()
    if (on) {
      state.floatOn = true
      $('#pbFloat')?.classList.add('active')
      setTimeout(pushFloat, 400)
    }
  } catch { }
  // 托盘开窗
  window.api.onFloatOpened?.(() => {
    state.floatOn = true
    $('#pbFloat')?.classList.add('active')
    if (state.lpMiniOpen) renderLpMiniPanel()
    setTimeout(pushFloat, 300)
  })
  // 浮窗被关闭（✕ 或托盘）
  window.api.onFloatClosed?.(() => {
    state.floatOn = false
    state.floatLocked = false
    $('#pbFloat')?.classList.remove('active')
    $('#lpGearBtn')?.classList.remove('on')
    if (state.lpMiniOpen) renderLpMiniPanel()
  })
  // 锁定状态由主进程广播，避免 UI 与实际穿透状态相反
  window.api.onFloatLocked?.((v) => {
    state.floatLocked = !!v
    if (state.lpMiniOpen) renderLpMiniPanel()
  })

  try {
    const info = await window.api.info()
    state.root = info.root
    $('#pbVer').textContent = `Electron ${info.electron} · Chromium ${String(info.chrome).split('.')[0]}`
    const lib = await window.api.scan(info.root)
    state.tracks = lib.tracks
    state.root = lib.root
    await restorePlayerSession()
  } catch (e) {
    console.warn('扫描失败', e)
  }
  renderSidebar()
  render()
})()
