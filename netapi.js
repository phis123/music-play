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

// 网易云 API 启动重试配置（见核实报告第 6 节）：
// - BOOT_MAX_RETRIES：启动失败后最多再试 2 次，即最多尝试 3 次；
// - BOOT_RETRY_DELAY_MS：每次重试前等待 1s（固定退避，不引入指数退避依赖）；
// - BOOT_START_PORT：端口从 3300 起自动挑选（行为不变）；
// - BOOT_MAX_PORT_TRIES：findFreePort 最多探测 100 个端口，超限即抛错，
//   避免原先无上限递归在端口连续被占时无限加深。
const BOOT_MAX_RETRIES = 2
const BOOT_RETRY_DELAY_MS = 1000
const BOOT_START_PORT = 3300
const BOOT_MAX_PORT_TRIES = 100

// 诊断日志（应用自带目录，不写系统 TEMP）
function log(msg) {
  try {
    const f = path.join(app.getPath('userData'), 'netease.log')
    fs.appendFileSync(f, `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* 忽略 */ }
}

function findFreePort(start, tried = 0) {
  return new Promise((resolve, reject) => {
    if (tried >= BOOT_MAX_PORT_TRIES) {
      reject(new Error(`没有空闲端口（已尝试 ${BOOT_MAX_PORT_TRIES} 个，从 ${start - tried} 起）`))
      return
    }
    const srv = net.createServer()
    srv.once('error', () => {
      // 端口被占用：探测下一个端口；tried 计数由上限兜底，不再无上限递归
      findFreePort(start + 1, tried + 1).then(resolve, reject)
    })
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
    let lastErr = null
    for (let attempt = 0; attempt <= BOOT_MAX_RETRIES; attempt++) {
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

      // 每次尝试都重新挑端口：若上次是 EADDRINUSE（探测与绑定之间的
      // TOCTOU 窗口被别的进程抢占），这次会拿到另一个空闲端口再试。
      const port = await findFreePort(BOOT_START_PORT)
      log(`booting on port ${port}, tmp=${tmp}`)
      const { serveNcmApi } = require('@neteasecloudmusicapienhanced/api/server.js')
      await serveNcmApi({ port, host: '127.0.0.1', checkVersion: false })
      ncmPort = port
      log(`ready on ${port}`)
      return port
     } catch (e) {
       lastErr = e
       log(`BOOT FAILED (attempt ${attempt + 1}/${BOOT_MAX_RETRIES + 1}): ` + (e && e.stack || e))
       if (attempt < BOOT_MAX_RETRIES) {
         if (e && e.code === 'EADDRINUSE') log('端口被抢占，下次重试将重新挑选端口')
         await new Promise((r) => setTimeout(r, BOOT_RETRY_DELAY_MS))
       }
     }
    }
    // 全部尝试失败：先把 bootPromise 置空再重抛（ncmPort 已是 0，无需另设），
    // 让下一次调用可以重新启动；否则调用方会永远拿到同一个已 rejected 的
    // Promise，直到重启应用（见核实报告第 6 节）。
    bootPromise = null
    throw lastErr
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
    alias: [].concat(s.alia || [], s.tns || [], s.alias || []).filter((v, i, a) => v && a.indexOf(v) === i),
  }
}

function normVoice(r) {
  const bi = r.baseInfo || {}
  const ms = bi.mainSong || {}
  const ui = r.uiElement || {}
  const radio = bi.radio || {}
  const dj = bi.dj || (radio && radio.dj) || {}
  const rawTitle = (ui.mainTitle && ui.mainTitle.title) || ms.name || bi.name || ''
  return {
    cover: thumb(bi.coverUrl || (radio && radio.picUrl) || (ui.image && ui.image.imageUrl) || ''),
    voiceId: r.resourceId || bi.id || ms.id,
    title: String(rawTitle).replace(/^声音[:：]?\s*/, '').trim(),
    sub: (ui.subTitle && ui.subTitle.title) || ui.subTitle || '',
    radio: radio.name || '',
    dj: dj.nickname || '',
    duration: Math.round((bi.duration || ms.duration || 0) / 1000),
    plays: bi.listenerCount || bi.adjustedPlayCount || 0,
    mainTrackId: bi.mainTrackId || ms.id || 0,
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

// 单曲音频下载上限：200MB。选值理由：单曲即使是无损 FLAC（约 5MB/分钟，
// 一首 10 分钟长曲约 50MB）也远低于此值；200MB 只是防无界下载的安全网，
// 不是“预期大小”。超过即拒绝，避免错误响应/无限流把磁盘写满。
// （核实报告第 5 节：原代码无任何大小限制，fetchBuffer 同样无上限——
// 本次只约束 downloadTo，fetchBuffer 的封面图片不在本次范围。）
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024

// 音频下载只接受的 Content-Type：audio/* 与 application/octet-stream。
// 明确拒绝错误页面：text/html / application/json（与 Android
// downloadAsync 的拒绝清单一致，Bridge.java:296）。
// Content-Type 缺失时放行——部分 CDN 不返回标准类型，此时仍由大小上限
// 与 got/total 完整性校验兜底；但 text/html / json 一律不放过。
function checkAudioContentType(ct) {
  const t = String(ct || '').toLowerCase().split(';')[0].trim()
  if (!t) return // 缺失：无法判断，放行，靠大小与完整性校验兜底
  if (t.includes('text/html') || t.includes('json')) {
    throw new Error('服务器返回的不是音频（' + t + '），可能需要会员或已下架')
  }
  if (t.startsWith('audio/') || t === 'application/octet-stream') return
  throw new Error('服务器返回的不是音频（Content-Type: ' + t + '）')
}

// 进程内下载锁：按最终目标文件路径复用进行中的下载，避免两次
// downloadVoice 共用同一个 .downloading 交错写入（核实报告第 5 节
// “并发冲突”潜在项）。key 用 path.resolve 归一化；失败或成功后
// 从 map 移除，下次调用可重新下载。只防同一进程内并发，不防多进程。
const inflightDownloads = new Map()

function downloadTo(url, filePath, onProgress) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    let out = null
    let settled = false
    // 任意失败路径：关闭写流并删除临时文件，避免残留 .downloading
    const cleanup = () => {
      try { if (out) out.destroy() } catch { /* 忽略 */ }
      try { fs.unlinkSync(filePath) } catch { /* 不存在或删不掉时忽略 */ }
    }
    const fail = (err) => {
      if (settled) return
      settled = true
      cleanup()
      // 断开请求，停止继续收数据（失败路径不再消费响应体）
      try { req.destroy() } catch { /* 尚未建立或已关闭时忽略 */ }
      reject(err)
    }
    const req = mod.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode !== 200) return fail(new Error('HTTP ' + res.statusCode))
      const total = Number(res.headers['content-length'] || 0)
      // 大小上限：content-length 超限直接拒绝，不建文件、不写盘
      if (total > MAX_DOWNLOAD_BYTES) {
        return fail(new Error('文件过大：' + total + ' 字节，超过上限 ' + MAX_DOWNLOAD_BYTES + ' 字节'))
      }
      // 内容类型校验：错误页面（HTML/JSON）即使返回 200 也不当音频保存
      try { checkAudioContentType(res.headers['content-type']) } catch (e) { return fail(e) }
      let got = 0
      out = fs.createWriteStream(filePath)
      res.on('data', (c) => {
        got += c.length
        // 流式累计超限即 abort：content-length 缺失或撒谎时仍能兜底
        if (got > MAX_DOWNLOAD_BYTES) {
          return fail(new Error('文件过大：已下载 ' + got + ' 字节，超过上限 ' + MAX_DOWNLOAD_BYTES + ' 字节'))
        }
        if (onProgress && total) onProgress(got / total)
      })
      res.on('error', fail)
      res.pipe(out)
      out.on('finish', () => {
        if (settled) return
        // 完整性校验：服务端给了 content-length 时，实收字节必须一致
        if (total > 0 && got !== total) {
          return fail(new Error('下载不完整：已下载 ' + got + ' / ' + total + ' 字节'))
        }
        settled = true
        out.close(() => resolve({ bytes: got }))
      })
      out.on('error', fail)
    })
    req.on('timeout', () => req.destroy(new Error('下载超时')))
    req.on('error', fail)
  })
}

async function downloadVoice({ voice, song, dir, overwritePath }) {
  // 先算出最终目标文件（不依赖网络），再按它加锁：同一目标并发两次时，
  // 第二次直接复用进行中的 Promise，不会共用 .downloading 交错写入。
  // 注意：overwritePath 的路径约束不在这里做——netapi 不知道曲库根，
  // 由第 2 项 IPC 改动在 main.js 的 net:download / net:replaceSource
  // handler 层约束；这里只保证内部生成的目标路径仍走 sanitize + 重名递增。
  const target = overwritePath ? path.dirname(overwritePath) : (dir || path.join(app.getPath('music'), 'music-play'))

  let file = overwritePath
  if (!file) {
    const base = sanitize(song && song.name ? song.name : voice.title || 'voice')
    file = path.join(target, `${base}.mp3`)
    let n = 1
    while (fs.existsSync(file)) { file = path.join(target, `${base} (${n++}).mp3`) }
  }

  const key = path.resolve(file)
  const existing = inflightDownloads.get(key)
  if (existing) return existing
  const p = downloadVoiceOnce({ voice, song, target, file })
    .finally(() => { if (inflightDownloads.get(key) === p) inflightDownloads.delete(key) })
  inflightDownloads.set(key, p)
  return p
}

async function downloadVoiceOnce({ voice, song, target, file }) {
  await ensureServer()
  await fsp.mkdir(target, { recursive: true })

  const info = await trackInfo(voice.mainTrackId)
  const url = info.url
  if (!url) throw new Error('拿不到音频地址（可能是 VIP 限制）')

  const tmpFile = file + '.downloading'
  try {
    await downloadTo(url, tmpFile)
  } catch (e) {
    // 纵深清理：downloadTo 失败时本应已删临时文件，这里再兜底一次
    try { await fsp.unlink(tmpFile) } catch { /* 不存在或已清理时忽略 */ }
    throw e
  }
  try {
    await fsp.rename(tmpFile, file)
  } catch {
    await fsp.copyFile(tmpFile, file)
    try { await fsp.unlink(tmpFile) } catch { }
  }

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


/* ---------------- 声音搜索：多查询兜底与智能评分 ---------------- */
function firstArtist(a) {
  const raw = String(a || '').split(/[\/、,&]|feat\.?\s*/i).map((x) => x.trim()).filter(Boolean)[0] || ''
  // 去掉歌手后面的括号别名（如 "void (Mournfinale)" -> "void"），避免括号拖累搜索
  const stripped = raw.replace(/\s*[（(【\[].*?[）)】\]]\s*/g, ' ').trim()
  return stripped || raw
}

function unwrapQuotes(n) {
  return String(n || '').replace(/^[『「《【]+|[』」》】]+$/g, '').replace(/\s+/g, ' ').trim()
}

function looseName(n) {
  const raw = unwrapQuotes(n)
  // 仅剥离有空格分隔或位于末尾的括号附加说明（如 "(feat. Salita)"、"(vivid/stasis edit)"），保留词内括号如 "AI[UE]OON"
  const stripped = raw
    .replace(/\s+[（(【\[][^）)】\]]*[）)】\]]/g, '')
    .replace(/^[（(【\[][^）)】\]]*[）)】\]]\s+/g, '')
    .replace(/[（(][^）)]*(?:feat\.?|ver\.?|version|edit|mix|ost|op|ed|inst|off\s*vocal)[^）)]*[）)]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return stripped.length >= 2 ? stripped : raw
}

function normKeyRaw(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^声音[:：]?\s*/, '')
    .replace(/^\d{1,3}\s*[-._、)\]]\s*/, '')
    .replace(/^\d{2}\s+(?=[a-z\u4e00-\u9fa5])/i, '')
    .replace(/[\s\-_—–·・.,，。:：;；!！?？'"“”‘’\/\\|~`+*#@&^%$=<>{}「」『』【】\[\]（）()]/g, '')
}

function normKeyLoose(s) {
  const stripped = String(s || '')
    .replace(/^声音[:：]?\s*/, '')
    .replace(/^\d{1,3}\s*[-._、)\]]\s*/, '')
    .replace(/^\d{2}\s+(?=[a-z\u4e00-\u9fa5])/i, '')
    .replace(/\s+[（(【\[][^）)】\]]*[）)】\]]/g, ' ')
    .replace(/^[（(【\[][^）)】\]]*[）)】\]]\s*/g, ' ')
  const k = normKeyRaw(stripped)
  return k.length >= 2 ? k : normKeyRaw(s)
}

function isVariantVoice(voiceTitle, songName) {
  const vt = String(voiceTitle || '')
  const sn = String(songName || '')
  const re = /伴奏|纯音乐|inst(rumental)?\b|off\s*vocal|karaoke|钢琴版|吉他版|八音盒|铃声|片段|试听|[×x]\s*0\.\d+|0\.\d+\s*[×x]|slowed|nightcore|倍速/i
  return re.test(vt) && !re.test(sn)
}

function scoreCandidate(v, rawName, cleanName, fa, duration) {
  const vt = String(v.title || '').replace(/^声音[:：]?\s*/, '').trim()
  const krSong = normKeyRaw(rawName)
  const klSong = normKeyLoose(cleanName)
  const krVoice = normKeyRaw(vt)
  const klVoice = normKeyLoose(vt)
  const kArtist = normKeyRaw(fa)

  let tScore = 0
  // 特殊符号歌名（如 "-" 或 "_"）
  if (!krSong && rawName.trim()) {
    const sym = rawName.trim()
    if (vt.includes(sym) || vt.includes('_') || vt.includes('-')) {
      tScore = (kArtist && krVoice.includes(kArtist)) ? 60 : 35
    }
  } else {
    const pairs = [
      [krSong, krVoice],
      [klSong, klVoice],
      [krSong, klVoice],
      [klSong, krVoice],
    ]
    for (const [ks, kv] of pairs) {
      if (!ks || !kv) continue
      if (kv === ks) {
        tScore = Math.max(tScore, 65)
      } else if (kv.includes(ks)) {
        tScore = Math.max(tScore, 50)
      } else if (ks.includes(kv) && kv.length >= Math.max(3, Math.floor(ks.length * 0.5))) {
        tScore = Math.max(tScore, 38)
      }
    }
  }

  if (kArtist && kArtist.length >= 2 && (krVoice.includes(kArtist) || normKeyRaw(v.dj || '').includes(kArtist) || normKeyRaw(v.radio || '').includes(kArtist))) {
    tScore += 8
  }

  let dScore = 0
  const vDur = +(v.duration || 0)
  const sDur = +(duration || 0)
  const gap = (sDur > 0 && vDur > 0) ? Math.abs(vDur - sDur) : null
  if (gap != null) {
    if (gap <= 2) dScore = 55
    else if (gap <= 5) dScore = 44
    else if (gap <= 10) dScore = 26
    else if (gap <= 20) dScore = 8
    else if (gap <= 30) dScore = -12
    else dScore = -45
  }

  let penalty = 0
  if (isVariantVoice(vt, rawName)) penalty = 35

  const strong = (tScore >= 45) && !penalty && (gap == null || gap <= 6)
  return {
    total: tScore + dScore - penalty,
    tScore,
    gap: gap == null ? 9999 : gap,
    strong,
  }
}

/**
 * 依次尝试多种关键词：
 * 1) 「原歌名 精简首位歌手」
 * 2) 「原歌名」（防止歌手名不匹配或只返回 ×0.75/片段版）
 * 3) 「去括号后缀歌名 精简首位歌手」与「去括号后缀歌名」
 * 4) 符号歌名（如 "-"）兜底搜歌手名
 * 只有当已经找到「标题命中 + 时长误差 ≤ 6s + 非片段/变速版」的高置信结果时才提前结束请求。
 */
async function searchVoicesSmart(name, artist, duration = 0, limit = 25) {
  const raw = unwrapQuotes(name)
  const clean = looseName(name)
  const fa = firstArtist(artist)

  const queries = []
  const addQ = (q) => {
    const s = String(q || '').replace(/\s+/g, ' ').trim()
    if (s && !queries.includes(s)) queries.push(s)
  }

  if (raw && normKeyRaw(raw).length >= 1) {
    if (fa) addQ(`${raw} ${fa}`)
    addQ(raw)
  }
  if (clean && clean !== raw) {
    if (fa) addQ(`${clean} ${fa}`)
    addQ(clean)
  }
  if (!normKeyRaw(raw) && fa) {
    addQ(`${raw} ${fa}`)
    addQ(fa)
  }

  const seen = new Set()
  const out = []
  for (const kw of queries) {
    let list = []
    try { list = await searchVoices(kw, limit) } catch { list = [] }
    for (const v of list) {
      const key = `${v.voiceId || ''}:${v.mainTrackId || ''}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push(v)
      }
    }
    // 只有当已经拿到「标题匹配 + 时长一致(≤6s) + 非变速/片段」的优质声源时才提前收工
    const hasStrong = out.some((v) => scoreCandidate(v, raw, clean, fa, duration).strong)
    if (hasStrong && out.length >= 4) break
  }

  return rankVoices(out, raw, clean, fa, duration)
}

/**
 * 排序：综合评分（标题命中 + 时长接近 + 歌手匹配 - 片段/倍速扣分）> 播放量
 * 保留全部候选（不再丢弃低分项），方便用户在「换源」界面人工挑选
 */
function rankVoices(list, raw, clean, fa, duration) {
  const scored = list.map((v) => {
    const sc = scoreCandidate(v, raw, clean, fa, duration)
    return { v, sc }
  })
  scored.sort((a, b) => {
    if (b.sc.total !== a.sc.total) return b.sc.total - a.sc.total
    if (a.sc.gap !== b.sc.gap) return a.sc.gap - b.sc.gap
    return (b.v.plays || 0) - (a.v.plays || 0)
  })
  return scored.map((x) => x.v)
}
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
