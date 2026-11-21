/**
 * views/router.js — 路由表与 render()、视图区事件委托
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { $, $$, audio } from '../core/dom.js'
import { state } from '../core/state.js'
import { clearAllUserTrackGains, clearSearchHist, getPlaylists, savePlaylists } from '../core/store.js'
import { askText, toast } from '../core/ui.js'
import { dismissTask } from '../core/task.js'
import { applyTheme } from '../core/theme.js'
import { loadCover, setCover } from '../library/cover.js'
import { deleteTrack, fixCovers, pickRoot, rescan } from '../library/scan.js'
import { bindHomeBodyEvents, doSearch, search, stopPreview, updateHomeSearchBody, viewHome } from '../library/search.js'
import { doImportParse, firstArtistClean, imp, importAll, importInlineSearch, importRekw, importSwap, matchAllImport, mountImportRowsChunked, refreshOpenImpPanel, scheduleSaveImpState, updateSingleImpRow, viewImport } from '../library/import.js'
import { healthFixAll, viewHealth } from '../library/health.js'
import { applyCurrentTrackGain } from '../player/audio.js'
import { paintPlayMode, play, playNextInsert, playTrack, setPlayMode } from '../player/queue.js'
import { applyLyricsStyle } from '../player/lyrics.js'
import { bindListBodyEvents, currentListBaseTracks, deletePlaylist, filterAndSortTracks, openAddMenu, renderSidebar, toggleFav, updateListBody, viewLiked, viewLocal, viewPlaylist, viewRecent } from './lists.js'
import { viewSettings } from './settings.js'


export const routes = {
  '#/home': viewHome,
  '#/liked': viewLiked,
  '#/recent': viewRecent,
  '#/local': viewLocal,
  '#/import': viewImport,
  '#/health': viewHealth,
  '#/settings': viewSettings,
}


export let __actsBound = false

export function bindRowActions() {
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


export function render() {
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
