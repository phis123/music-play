/**
 * app.js — 渲染进程入口：装配各模块 + 全局事件绑定 + 启动
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { $, $$, audio, fmt } from './core/dom.js'
import { state } from './core/state.js'
import { getPlayCount, getPlaylists, getUserTrackGain, savePlaylists, setOffset, setUserTrackGain } from './core/store.js'
import { askText, toast } from './core/ui.js'
import { dismissTask, openTaskErrorDialog } from './core/task.js'
import { applyTheme, cycleTheme } from './core/theme.js'
import { markNavTransition } from './core/nav.js'
import { restoreImpState } from './library/import.js'
import { applyCurrentTrackGain } from './player/audio.js'
import { applyVolume, cyclePlayMode, paintPlayMode, play, playTrack, maybeAutoSavePosition, restorePlayerSession, savePlayerSession, setPlayIcon, stepQueue, trackByPath } from './player/queue.js'
import { applyLyricsStyle, closeLyrics, nudgeOffset, openLyrics, pushFloat, pushFloatStyle, renderLpMiniPanel, syncLyrics, toggleLpMiniPanel, updateOffsetChip } from './player/lyrics.js'
import { openAddMenu, renderSidebar, toggleFav } from './views/lists.js'
import { applySourceDialogCand, closeSheetDialog, openQueueDialog, openSourceDialog, previewSourceDialogCand, renderSheetDialog, restoreSourceOriginal, searchSourceDialogCands } from './views/sheet.js'
import { render } from './views/router.js'


// 三策略算法已下沉到 lib/random.js（纯函数，可被单测直接覆盖）；
// 这里只做「渲染层状态 → 纯函数入参」的适配，避免测试里重抄一份实现。
export function pickNextShuffleIndex() {
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


export function bindGlobal() {
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
    maybeAutoSavePosition()
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
