/**
 * player/queue.js — 播放队列、三种播放模式、播放/切歌/会话恢复
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { $, $$, ICON_PAUSE, ICON_PLAY, MODE_ICONS, audio, cleanTitle, fmt, toFileUrl } from '../core/dom.js'
import { state } from '../core/state.js'
import { getOffset, getRecent, incPlayCount, isFav, pushRecent, setOffset } from '../core/store.js'
import { toast } from '../core/ui.js'
import { extractAmbientColor } from '../core/theme.js'
import { loadCover, setCover } from '../library/cover.js'
import { stopPreview } from '../library/search.js'
import { applyCurrentTrackGain } from './audio.js'
import { measureLeadSilence, renderLpMiniPanel, renderLyrics, syncLyrics, updateOffsetChip } from './lyrics.js'
import { renderSheetDialog } from '../views/sheet.js'
import { pickNextShuffleIndex } from '../app.js'

export async function playPath(p) {
  const idx = state.tracks.findIndex((t) => t.path === p)
  if (idx >= 0) return play(idx)
  const rec = getRecent().find((x) => x.path === p)
  const base = String(p).split(/[\\/]/).pop()
  return playTrack(rec ? { ...rec, hasLrc: false } : { path: p, title: base }, -1)
}


/* ---------------- 播放模式 / 队列 / 换声源 / 会话持久化 ---------------- */
export const trackByPath = (p) => state.tracks.find((t) => t.path === p)


export function paintPlayMode() {
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


export function setPlayMode(mode) {
  state.mode = mode
  state.hist = []
  try { localStorage.setItem('desk:mode', mode) } catch { }
  paintPlayMode()
  savePlayerSession()
  if (state.sheetKind === 'queue') renderSheetDialog()
}


export function cyclePlayMode() {
  const next = state.mode === 'loop' ? 'shuffle' : state.mode === 'shuffle' ? 'one' : 'loop'
  setPlayMode(next)
  toast(next === 'shuffle' ? '随机播放' : next === 'one' ? '单曲循环' : '顺序循环')
}


export function applyVolume(v, muted) {
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

/** timeupdate 节流：每 4 秒把播放位置落盘一次（拆分后由 app.js 的 timeupdate 监听调用） */
export function maybeAutoSavePosition() {
  if (Date.now() - _posSaveAt > 4000) {
    _posSaveAt = Date.now()
    savePlayerSession(true)
  }
}

export function savePlayerSession(posOnly) {
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


export async function restorePlayerSession() {
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


export function captureVisibleQueue(targetPath) {
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


export function playNextInsert(t) {
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


export function stepQueue(delta, autoEnded) {
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


export function play(i) {
  if (i < 0 || i >= state.tracks.length) return
  const t = state.tracks[i]
  captureVisibleQueue(t.path)
  return playTrack(t, i, { keepQueue: true })
}


export async function playTrack(t, i, opts = {}) {
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


export function renderActiveRowInView() {
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


/* ---------------- 事件 ---------------- */
export function setPlayIcon(playing) {
  $('#pbPlay').innerHTML = playing ? ICON_PAUSE : ICON_PLAY
  $$('.eq-bars').forEach((el) => el.classList.toggle('paused', !playing))
}
