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
async function trackUrl(trackId) {
  await ensureServer()
  const d = await get(`/song/url?${qs({ id: trackId })}`)
  const arr = (d.data || d) || []
  const first = Array.isArray(arr) ? arr[0] : null
  return (first && first.url) || ''
}

async function lyric(songId) {
  await ensureServer()
  const d = await get(`/lyric?${qs({ id: songId })}`)
  const lrc = ((d.data || d).lrc || {}).lyric || ''
  return lrc
}

function sanitize(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80)
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

  const url = await trackUrl(voice.mainTrackId)
  if (!url) throw new Error('拿不到音频地址（可能是 VIP 限制）')

  const base = sanitize(song && song.name ? song.name : voice.title || 'voice')
  let file = path.join(target, `${base}.mp3`)
  let n = 1
  while (fs.existsSync(file)) { file = path.join(target, `${base} (${n++}).mp3`) }

  await downloadTo(url, file)

  // 同步歌词
  let lrcFile = ''
  try {
    const text = song && song.id ? await lyric(song.id) : ''
    if (text && text.trim()) {
      lrcFile = file.replace(/\.mp3$/i, '.lrc')
      await fsp.writeFile(lrcFile, text, 'utf8')
    }
  } catch { /* 歌词失败不影响下载 */ }

  return { file, lrcFile, dir: target }
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

module.exports = {
  autoLyric,
  ensureServer,
  searchSongs,
  searchVoices,
  trackUrl,
  lyric,
  downloadVoice,
  getPort: () => ncmPort,
}
