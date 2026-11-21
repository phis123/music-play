/**
 * player/lyrics.js — 双语歌词渲染与自动跟随（scrollLyricsTo 是唯一程序滚动入口）
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { $, audio, cleanTitle, toFileUrl } from '../core/dom.js'
import { state } from '../core/state.js'
import { setOffset } from '../core/store.js'
import { getCurrentTrackEffectiveGain } from './audio.js'
import { playTrack } from './queue.js'


export function applyLyricsStyle() {
  document.documentElement.style.setProperty('--lrc-size', (state.lrcSize || 18) + 'px')
  document.documentElement.style.setProperty('--lrc-accent', state.lrcColor || '#ec4141')
  try {
    localStorage.setItem('desk:lrcSize', String(state.lrcSize || 18))
    localStorage.setItem('desk:lrcColor', state.lrcColor || '#ec4141')
  } catch { }
}


export function pushFloatStyle() {
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


export function renderLyrics() {
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


export function syncLyrics(force) {
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


/**
 * 用 Web Audio 解码音频，测开头静音多长（毫秒）。
 * 取左右声道平均能量，前 30 秒内第一次超过阈值的位置。
 */
export async function measureLeadSilence(path) {
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
export function lineTime(l) {
  return l.t + (state.offsetMs || 0)
}

/* ---------------- 歌词区交互 ---------------- */
export function applyLyricPadding() {
  const pane = document.querySelector('.lp-right')
  const box = $('#lpLyrics')
  if (!pane || !box) return
  const pad = Math.max(80, Math.round(pane.clientHeight / 2 - 30))
  box.style.paddingTop = pad + 'px'
  box.style.paddingBottom = pad + 'px'
}

export function markUserScroll() {
  state.lastUserScrollAt = Date.now()
  $('#lpResume')?.classList.remove('hidden')
}

export function resumeFollow() {
  state.lastUserScrollAt = 0
  $('#lpResume')?.classList.add('hidden')
  syncLyrics(true)
}

/** 最近一次「程序自动滚动」的时刻；用于把自动跟随产生的 scroll 事件与用户滚动区分开 */
export let lyricsAutoScrollAt = 0


/** 歌词区唯一的程序滚动入口（禁止直接调 pane.scrollTo，否则会被当成用户滚动） */
export function scrollLyricsTo(top, smooth) {
  const pane = document.querySelector('.lp-right')
  if (!pane) return
  lyricsAutoScrollAt = Date.now()
  try {
    pane.scrollTo({ top: Math.max(0, Math.round(top)), behavior: smooth ? 'smooth' : 'auto' })
  } catch (e) {
    pane.scrollTop = Math.max(0, Math.round(top))
  }
}


export function bindLyricsInteraction() {
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
export function currentLine() {
  const l = state.lines[state.activeIdx]
  if (!l) {
    // 还没到第一句歌词：留空（只显示曲名），避免出现「…」
    return { en: '', zh: state.lines.length ? '' : (state.cur >= 0 ? '无歌词' : '等待播放…') }
  }
  if (l.pair && l.pair.length > 1) return { en: l.pair[0], zh: l.pair[1] }
  return { en: '', zh: l.text }
}

export function pushFloat() {
  if (!state.floatOn) return
  const t = state.tracks[state.cur]
  window.api.floatPush({
    title: t ? cleanTitle(t.title) : '',
    artist: t ? (t.artist || '') : '',
    ...currentLine(),
  })
}


/* ---------------- 歌词页 ---------------- */
export function updateOffsetChip() {
  const el = $('#lpOff')
  if (el) {
    const ms = Math.round(state.offsetMs || 0)
    el.textContent = '偏移 ' + (ms > 0 ? '+' : '') + (ms / 1000).toFixed(1) + 's'
    el.style.color = ms ? 'var(--red)' : ''
    el.style.borderColor = ms ? 'var(--red)' : ''
  }
  if (state.lpMiniOpen) renderLpMiniPanel()
}


export function nudgeOffset(deltaMs) {
  const t = state.tracks[state.cur]
  if (!t) return
  state.offsetMs = Math.round((state.offsetMs || 0) + deltaMs)
  setOffset(t.path, state.offsetMs)
  updateOffsetChip()
  syncLyrics(true)
}


/* ---------------- 歌曲播放页小设置浮层（单曲声音平衡 / 歌词延迟 / 悬浮歌词设计） ---------------- */
export function renderLpMiniPanel() {
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


export function toggleLpMiniPanel(forceState) {
  state.lpMiniOpen = typeof forceState === 'boolean' ? forceState : !state.lpMiniOpen
  renderLpMiniPanel()
}


export async function openLyrics() {
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

export function closeLyrics() {
  state.lpMiniOpen = false
  renderLpMiniPanel()
  $('#lyricsPage').classList.add('hidden')
}
