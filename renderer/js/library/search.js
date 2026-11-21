/**
 * library/search.js — 首页搜索（本地过滤 + 网易云在线歌曲/声音）与试听下载入口
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { $, $$, esc, fmtDur, fmtPlays } from '../core/dom.js'
import { state } from '../core/state.js'
import { getSearchHist, pushSearchHist } from '../core/store.js'
import { loadCover, setCover } from './cover.js'
import { play } from '../player/queue.js'
import { trackRowHtml } from '../views/lists.js'
import { normKey } from '../views/sheet.js'
import { render } from '../views/router.js'


/* ---------------- 视图 ---------------- */
export const search = {
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

export function matchLocalTrack(t, kw) {
  const k = normKey(kw)
  if (!k) return true
  const hay = normKey([t.title, t.artist, t.album, String(t.path || '').split(/[\\/]/).pop()].join(' '))
  return hay.includes(k)
}


export function viewSearchBody() {
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


export function voiceListHtml() {
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


export function viewHome() {
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


export function updateHomeSearchBody() {
  const box = $('#homeSearchBody')
  if (!box) { render(); return }
  box.innerHTML = viewSearchBody()
  bindHomeBodyEvents()
  $$('#homeSearchBody [data-rowcov]').forEach((el) => {
    const t = state.tracks[+el.dataset.rowcov]
    if (t) loadCover(t.path, (url) => setCover(el, url))
  })
}


export function bindHomeBodyEvents() {
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


export async function doSearch(explicitKw) {
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


export async function pickSong(idx) {
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


export function stopPreview() {
  const a = $('#previewAudio')
  if (!a) return
  try { a.pause() } catch { }
  try { a.removeAttribute('src'); a.load() } catch { }
  search.playingVoiceId = null
}


export async function togglePreview(idx) {
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


export async function doDownload(idx) {
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
