/**
 * 内置网易云 API（跑在 Electron 自带 Node 里，不依赖系统 Node / 外部服务）
 * 首次调用时惰性启动，端口自动挑选，临时文件写到应用自己的目录。
 */
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const net = require('net')
const http = require('http')
const https = require('https')
const { app } = require('electron')

let ncmPort = 0
let bootPromise = null

// 诊断日志（应用自带目录，不写系统 TEMP）
function log(msg) {
  try {
    const f = path.join(app.getPath('userData'), 'netease.log')
    fs.appendFileSync(f, `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* 忽略 */ }
}

function findFreePort(start) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(findFreePort(start + 1)))
    srv.once('listening', () => {
      const p = srv.address().port
      srv.close(() => resolve(p))
    })
    srv.listen(start, '127.0.0.1')
  })
}

async function ensureServer() {
  if (ncmPort) return ncmPort
  if (bootPromise) return bootPromise
  bootPromise = (async () => {
   try {
    // 关键：把临时目录指到应用自己的目录，不写系统 TEMP
    const tmp = path.join(app.getPath('userData'), 'ncm-tmp')
    fs.mkdirSync(tmp, { recursive: true })
    process.env.TEMP = tmp
    process.env.TMP = tmp

    // 内置引导文件（api-enhanced 在 require 时就会读这两个文件）
    const assets = path.join(__dirname, 'assets')
    for (const f of ['anonymous_token', 'xeapi_public_key']) {
      const dst = path.join(tmp, f)
      if (fs.existsSync(dst)) continue
      const srcFile = path.join(assets, f)
      if (fs.existsSync(srcFile)) fs.copyFileSync(srcFile, dst)
      else fs.writeFileSync(dst, '')
    }

    const port = await findFreePort(3300)
    log(`booting on port ${port}, tmp=${tmp}`)
    const { serveNcmApi } = require('@neteasecloudmusicapienhanced/api/server.js')
    await serveNcmApi({ port, host: '127.0.0.1', checkVersion: false })
    ncmPort = port
    log(`ready on ${port}`)
    return port
   } catch (e) {
     log('BOOT FAILED: ' + (e && e.stack || e))
     throw e
   }
  })()
  return bootPromise
}

function get(apiPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: ncmPort, path: apiPath, timeout: 25000 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (e) { reject(e) }
      })
    })
    req.on('timeout', () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
  })
}

const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')

/* ---------------- 归一化 ---------------- */
function normSong(s) {
  const ar = (s.ar || s.artists || []).map((a) => a && a.name).filter(Boolean).join(' / ')
  const al = s.al || s.album || {}
  return {
    id: s.id,
    name: s.name || '',
    artist: ar || (al.artist && al.artist.name) || '',
    album: al.name || '',
    duration: Math.round((s.dt || s.duration || 0) / 1000),
    cover: al.picUrl || al.blurPicUrl || '',
    fee: s.fee == null ? 0 : s.fee,
  }
}

function normVoice(r) {
  const bi = r.baseInfo || {}
  const ui = r.uiElement || {}
  const radio = bi.radio || {}
  return {
    cover: thumb(bi.coverUrl || (radio && radio.picUrl) || (ui.image && ui.image.imageUrl) || ''),
    voiceId: r.resourceId,
    title: (ui.mainTitle && ui.mainTitle.title) || '',
    sub: ui.subTitle || '',
    radio: radio.name || '',
    duration: Math.round((bi.duration || 0) / 1000),
    plays: bi.listenerCount || bi.adjustedPlayCount || 0,
    mainTrackId: bi.mainTrackId || 0,
  }
}

/* ---------------- 补封面（搜索接口不返回 picUrl） ---------------- */
function thumb(url, size = 140) {
  if (!url) return ''
  return url.includes('?') ? url : `${url}?param=${size}y${size}`
}

async function fillCovers(songs) {
  const need = songs.filter((s) => !s.cover && s.id).map((s) => s.id)
  if (!need.length) return songs
  try {
    const d = await get(`/song/detail?${qs({ ids: need.slice(0, 100).join(',') })}`)
    const bag = d.data || d
    const list = bag.songs || []
    const map = new Map()
    for (const raw of list) {
      const al = raw.al || raw.album || {}
      map.set(raw.id, al.picUrl || al.blurPicUrl || '')
    }
    for (const s of songs) {
      if (!s.cover) s.cover = thumb(map.get(s.id) || '')
    }
  } catch { /* 补封面失败不影响搜索 */ }
  return songs
}

/* ---------------- 搜索 ---------------- */
async function searchSongs(keywords, limit = 30) {
  await ensureServer()
  const d = await get(`/search?${qs({ keywords, type: 1, limit })}`)
  const bag = d.data || d
  const songs = (bag.result && bag.result.songs) || bag.songs || []
  return fillCovers(songs.map(normSong))
}

async function searchVoices(keywords, limit = 30) {
  await ensureServer()
  const d = await get(`/search?${qs({ keywords, type: 2000, limit })}`)
  const bag = d.data || d
  const res = (bag.result && bag.result.resources) || bag.resources || []
  return res.map(normVoice).filter((v) => v.voiceId && v.mainTrackId)
}

/* ---------------- 试听 / 下载 ---------------- */
async function trackInfo(trackId) {
  await ensureServer()
  const d = await get(`/song/url?${qs({ id: trackId })}`)
  const arr = (d.data || d) || []
  const first = Array.isArray(arr) ? arr[0] : null
  return { url: (first && first.url) || '', br: (first && first.br) || 0, size: (first && first.size) || 0 }
}

async function trackUrl(trackId) {
  await ensureServer()
  const d = await get(`/song/url?${qs({ id: trackId })}`)
  const arr = (d.data || d) || []
  const first = Array.isArray(arr) ? arr[0] : null
  return (first && first.url) || ''
}


/* ---------------- 双语歌词合并 ---------------- */
function parseTime(line) {
  const m = line.match(/^\s*\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/)
  if (!m) return null
  return (+m[1]) * 60000 + (+m[2]) * 1000 + (m[3] ? +m[3].padEnd(2, '0').slice(0, 2) * 10 : 0)
}

/** 把翻译按时间戳并进原文：同一时间戳输出「原文行 + 翻译行」 */
function mergeLrc(main, trans) {
  const tmap = new Map()
  for (const line of String(trans || '').split(/\r?\n/)) {
    const t = parseTime(line)
    if (t == null) continue
    const body = line.replace(/^\s*\[[^\]]*\]\s*/, '').trim()
    if (body) tmap.set(t, body)
  }
  if (!tmap.size) return String(main || '')
  const out = []
  for (const line of String(main || '').split(/\r?\n/)) {
    if (!line.trim()) continue
    const t = parseTime(line)
    if (t == null) { out.push(line); continue }
    const tag = line.match(/^\s*(\[[^\]]*\])/)[1]
    const body = line.replace(/^\s*\[[^\]]*\]\s*/, '').trim()
    if (!body) { out.push(line); continue }
    out.push(`${tag}${body}`)
    const tr = tmap.get(t)
    if (tr && tr !== body) out.push(`${tag}${tr}`)
  }
  return out.join('\n')
}

async function lyric(songId) {
  await ensureServer()
  const d = await get(`/lyric?${qs({ id: songId })}`)
  const bag = d.data || d
  const main = (bag.lrc || {}).lyric || ''
  const trans = (bag.tlyric || {}).lyric || ''
  return mergeLrc(main, trans)
}

function sanitize(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/* ---------------- 高清封面 ---------------- */
function hiResCover(url, size = 600) {
  if (!url) return ''
  const base = String(url).split('?')[0]
  return `${base}?param=${size}y${size}`
}

/** 取歌曲封面图片（尽量高清）；没有 cover 时按歌名再搜一次 */
async function coverBuffer(song) {
  let url = song && song.cover ? hiResCover(song.cover) : ''
  if (!url && song && song.name) {
    try {
      const list = await searchSongs([song.name, song.artist].filter(Boolean).join(' '), 3)
      const hit = list.find((x) => x.cover) || list[0]
      if (hit && hit.cover) url = hiResCover(hit.cover)
    } catch { }
  }
  if (!url) return null
  try { return await fetchBuffer(url) } catch { return null }
}

async function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode))
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
    })
    req.on('timeout', () => req.destroy(new Error('超时')))
    req.on('error', reject)
  })
}

function downloadTo(url, filePath, onProgress) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const req = mod.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode))
      const total = Number(res.headers['content-length'] || 0)
      let got = 0
      const out = fs.createWriteStream(filePath)
      res.on('data', (c) => {
        got += c.length
        if (onProgress && total) onProgress(got / total)
      })
      res.pipe(out)
      out.on('finish', () => out.close(() => resolve({ bytes: got })))
      out.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('下载超时')))
    req.on('error', reject)
  })
}

async function downloadVoice({ voice, song, dir }) {
  await ensureServer()
  const target = dir || path.join(app.getPath('music'), 'music-play')
  await fsp.mkdir(target, { recursive: true })

  const info = await trackInfo(voice.mainTrackId)
  const url = info.url
  if (!url) throw new Error('拿不到音频地址（可能是 VIP 限制）')

  const base = sanitize(song && song.name ? song.name : voice.title || 'voice')
  let file = path.join(target, `${base}.mp3`)
  let n = 1
  while (fs.existsSync(file)) { file = path.join(target, `${base} (${n++}).mp3`) }

  await downloadTo(url, file)

  // 写标签：标题 / 作者 / 封面（用歌曲的）
  try {
    const NodeID3 = require('node-id3')
    const tags = {}
    if (song && song.name) tags.title = song.name
    const ar = song && song.artist ? String(song.artist).split('/')[0].trim() : ''
    if (ar) tags.artist = ar
    if (song && song.album) tags.album = song.album
    const imgBuf = await coverBuffer(song && song.cover ? song : { name: (song && song.name) || voice.title, artist: song && song.artist, cover: (song && song.cover) || voice.cover })
    if (imgBuf && imgBuf.length) {
      try { fs.writeFileSync(file.replace(/\.[^.]+$/, '') + '.jpg', imgBuf) } catch { }
    }
    if (imgBuf && imgBuf.length) {
      tags.image = { mime: 'image/jpeg', type: { id: 3, name: 'front cover' }, description: 'cover', imageBuffer: imgBuf }
    }
    if (Object.keys(tags).length) NodeID3.write(tags, file)
  } catch (e) {
    log('写标签失败: ' + (e && e.message))
  }

  // 同步歌词（含翻译）
  let lrcFile = ''
  try {
    const text = song && song.id ? await lyric(song.id) : ''
    if (text && text.trim()) {
      lrcFile = file.replace(/\.mp3$/i, '.lrc')
      await fsp.writeFile(lrcFile, text, 'utf8')
    }
  } catch { /* 歌词失败不影响下载 */ }

  return { file, lrcFile, dir: target, br: info.br, size: info.size }
}

/* ---------------- 自动补词 ---------------- */
function simplify(s) {
  return String(s || '').toLowerCase()
    .replace(/[『』《》「」【】\[\]（）()<>\"'’,，、.。!！?？~〜\-_/\\|·:：;；\s]/g, '')
}

async function autoLyric({ title, artist }) {
  await ensureServer()
  const kw = [title, artist].filter(Boolean).join(' ')
  if (!kw.trim()) return { ok: false, reason: '没有歌名' }
  const songs = await searchSongs(kw, 10)
  if (!songs.length) return { ok: false, reason: '搜不到这首歌' }

  const want = simplify(title)
  const scored = songs.map((s) => {
    const n = simplify(s.name)
    let score = 0
    if (n === want) score += 100
    else if (n.includes(want) || want.includes(n)) score += 60
    if (artist && simplify(s.artist).includes(simplify(artist).split('/')[0])) score += 20
    return { s, score }
  }).sort((a, b) => b.score - a.score)

  for (const { s } of scored.slice(0, 3)) {
    const text = await lyric(s.id)
    const n = (text.match(/^\[\d/gm) || []).length
    if (n >= 4) return { ok: true, text, song: s.name, artist: s.artist, lines: n }
  }
  return { ok: false, reason: '这些结果都没歌词' }
}


/* ---------------- 声音搜索：多查询兜底 ---------------- */
function firstArtist(a) {
  return String(a || '').split(/[\/、,&]|feat\.?\s*/i).map((x) => x.trim()).filter(Boolean)[0] || ''
}
function looseName(n) {
  return String(n || '').replace(/[（(【\[].*?[）)】\]]/g, '').replace(/\s+/g, ' ').trim()
}
function normKey(s) {
  return String(s || '').toLowerCase().replace(/[\s\-_「」『』【】\[\]（）()]/g, '')
}

/**
 * 依次尝试多种关键词，避免「歌名 + 多个歌手 + 斜杠」把搜索搞空。
 * 最多 2 次请求：先「歌名 首位歌手」，结果里没有像样的再退回「歌名」。
 */
async function searchVoicesSmart(name, artist, duration = 0, limit = 20) {
  const clean = looseName(name)
  const fa = firstArtist(artist)
  const q1 = [clean, fa].filter(Boolean).join(' ')
  const queries = []
  if (q1) queries.push(q1)
  if (clean && clean !== q1) queries.push(clean)

  const seen = new Set()
  let out = []
  for (const kw of queries) {
    let list = []
    try { list = await searchVoices(kw, limit) } catch { list = [] }
    for (const v of list) if (!seen.has(v.voiceId)) { seen.add(v.voiceId); out.push(v) }
    if (titleHits(out, clean).length) break     // 标题已经对得上，别再发请求
  }

  // ---- 第 3 层兜底：标题都对不上时，按时长接近度排 ----
  if (!titleHits(out, clean).length && duration > 0 && !out.length) {
    // 标题没命中且没有结果 → 用「歌名」再搜一次（可能是生僻写法）
    try { out = await searchVoices(clean, limit) } catch { /* ignore */ }
  }

  return rankVoices(out, clean, duration)
}

function titleHits(list, clean) {
  const key = normKey(clean)
  if (!key) return []
  return list.filter((v) => {
    const t = normKey(String(v.title || '').replace(/^声音[:：]?\s*/, ''))
    return t && (t === key || t.includes(key) || key.includes(t))
  })
}

/**
 * 排序：标题命中 > 时长接近 > 播放量
 * duration 单位秒；给 0 表示不知道时长
 */
function rankVoices(list, clean, duration) {
  const key = normKey(clean)
  const tScore = (v) => {
    const t = normKey(String(v.title || '').replace(/^声音[:：]?\s*/, ''))
    if (!t || !key) return 0
    if (t === key) return 3
    if (t.includes(key)) return 2
    if (key.includes(t)) return 1
    return 0
  }
  list.forEach((v) => {
    v._t = tScore(v)
    v._d = duration > 0 ? Math.abs((v.duration || 0) - duration) : 9999
  })

  const good = list.filter((v) => v._t > 0)
  if (good.length) {
    good.sort((a, b) => (b._t - a._t) || (b.plays - a.plays))
    return good.map(strip)
  }

  // 没有标题命中 → 按时长接近度
  if (duration > 0) {
    const tol = Math.max(5, Math.round(duration * 0.06))   // ±5s 或 ±6%
    let pool = list.filter((v) => v._d <= tol)
    if (!pool.length) pool = list.filter((v) => v._d <= 60)
    const use = pool.length ? pool : list
    use.sort((a, b) => (a._d - b._d) || (b.plays - a.plays))
    return use.map(strip)
  }

  list.sort((a, b) => b.plays - a.plays)
  return list.map(strip)
}

function strip(v) { delete v._t; delete v._d; return v }
/* ---------------- 歌单曲目 ---------------- */
async function playlistSongs(id) {
  await ensureServer()
  const d = await get(`/playlist/detail?${qs({ id })}`)
  const bag = d.data || d
  const pl = bag.playlist || {}
  const tracks = pl.tracks || []
  return { name: pl.name || '', cover: pl.coverImgUrl || '', songs: tracks.map(normSong) }
}

async function songDetail(id) {
  await ensureServer()
  const d = await get(`/song/detail?${qs({ ids: String(id) })}`)
  const bag = d.data || d
  return (bag.songs || []).map(normSong)
}

module.exports = {
  autoLyric,
  ensureServer,
  searchSongs,
  searchVoices,
  searchVoicesSmart,
  playlistSongs,
  songDetail,
  trackUrl,
  trackInfo,
  coverBuffer,
  hiResCover,
  lyric,
  downloadVoice,
  getPort: () => ncmPort,
}
