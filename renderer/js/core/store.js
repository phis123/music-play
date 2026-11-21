/**
 * core/store.js — 本地持久化：最近播放 / 歌单 / 收藏 / 单曲增益 / 播放次数 / 歌词偏移 / 搜索历史
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */


export function getTrackGainMap() {
  try { return JSON.parse(localStorage.getItem('desk:trackGainMap') || '{}') } catch { return {} }
}

export function getUserTrackGain(path) {
  if (!path) return 0
  const m = getTrackGainMap()
  const v = Number(m[path])
  return Number.isFinite(v) ? Math.max(-12, Math.min(12, Math.round(v * 10) / 10)) : 0
}

export function setUserTrackGain(path, db) {
  if (!path) return
  const m = getTrackGainMap()
  const val = Math.max(-12, Math.min(12, Math.round((+db || 0) * 10) / 10))
  if (Math.abs(val) < 0.05) delete m[path]
  else m[path] = val
  try { localStorage.setItem('desk:trackGainMap', JSON.stringify(m)) } catch { }
}

export function clearAllUserTrackGains() {
  try { localStorage.removeItem('desk:trackGainMap') } catch { }
}


export function getPlayCounts() {
  try { return JSON.parse(localStorage.getItem('desk:playCounts') || '{}') } catch { return {} }
}

export function getPlayCount(path) {
  if (!path) return 0
  return +(getPlayCounts()[path] || 0)
}

export function incPlayCount(path) {
  if (!path) return
  const m = getPlayCounts()
  m[path] = (m[path] || 0) + 1
  try { localStorage.setItem('desk:playCounts', JSON.stringify(m)) } catch { }
}


/* ---------------- 最近播放 ---------------- */
export const RECENT_KEY = 'recentTracks'

export function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] }
}

export function pushRecent(t) {
  if (!t || !t.path) return
  const list = getRecent().filter((x) => x.path !== t.path)
  list.unshift({ path: t.path, title: t.title, artist: t.artist, duration: t.duration, at: Date.now() })
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 30)))
}


export function getSearchHist() {
  try { return JSON.parse(localStorage.getItem('desk:searchHist') || '[]') } catch { return [] }
}

export function pushSearchHist(kw) {
  kw = String(kw || '').trim()
  if (!kw) return
  const list = getSearchHist().filter((x) => x !== kw)
  list.unshift(kw)
  try { localStorage.setItem('desk:searchHist', JSON.stringify(list.slice(0, 10))) } catch { }
}

export function clearSearchHist() {
  try { localStorage.removeItem('desk:searchHist') } catch { }
}


/* ---------------- 歌单 ---------------- */
export const PL_KEY = 'playlists'

export const DEF_PL = [{ id: '1', name: '新建歌单', tracks: [] }, { id: '2', name: '我的歌单', tracks: [] }]


export function getPlaylists() {
  try {
    const v = JSON.parse(localStorage.getItem(PL_KEY) || 'null')
    if (Array.isArray(v) && v.length) return v
  } catch { }
  return DEF_PL.map((x) => ({ ...x, tracks: [] }))
}

export function savePlaylists(v) { localStorage.setItem(PL_KEY, JSON.stringify(v)) }


/* ---------------- 我喜欢的音乐 ---------------- */
export const FAV_KEY = 'favPaths'

export const FAV_DIR = '我喜欢的音乐'


export function favSet() {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')) } catch { return new Set() }
}

export const isFav = (p) => favSet().has(p)


/* ---------------- 开头静音测量 + 歌词偏移 ---------------- */
export const OFFSET_KEY = (path) => 'lyrOff:' + path


export function getOffset(path) {
  const v = parseFloat(localStorage.getItem(OFFSET_KEY(path)) || '')
  return Number.isFinite(v) ? v : null
}

export function setOffset(path, ms) {
  localStorage.setItem(OFFSET_KEY(path), String(Math.round(ms)))
}
