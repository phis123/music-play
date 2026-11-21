'use strict'
/**
 * main/net.js — 网易云 API 侧：netapi 启停、在线搜索、试听/下载、换源、自动抓词
 *
 * 下载上限（200MB）与流式兜底都在 netapi.js 内，本模块不重复实现，只做：
 * - 启停（ensureServer）；
 * - 下载/换源参数经 lib/path-guard.js 的 validateDownloadPayload /
 *   validateReplaceSourcePayload 归一化后再交给 netapi，杜绝渲染层透传任意写入路径；
 * - 自动抓词写旁挂 .lrc 前做 assertInsideLibrary + assertSafeWriteTarget 校验。
 */
const fs = require('fs')
const netapi = require('../netapi')
const { parseLrc } = require('../lib/lrc')
const { validateDownloadPayload, validateReplaceSourcePayload } = require('../lib/path-guard')
const library = require('./library')
const diag = require('./diag')

/** 启动内置网易云 API 服务（失败只告警，不影响主功能） */
function startServer() {
  return netapi.ensureServer().catch((e) => diag.warn('[ncm] 启动失败:', e.message))
}

function handleSongs(kw) {
  return netapi.searchSongs(kw)
}

function handleVoices(payload) {
  // payload 可以是字符串（播客 tab）或 { name, artist }（选中歌曲后找声音）
  if (typeof payload === 'string') return netapi.searchVoicesSmart(payload, '')
  return netapi.searchVoicesSmart(payload.name, payload.artist, payload.duration || 0)
}

function handlePlaylist(id) {
  return netapi.playlistSongs(id)
}

function handleSongDetail(id) {
  return netapi.songDetail(id)
}

function handlePreview(trackId) {
  return netapi.trackUrl(trackId)
}

/** 普通下载：禁止透传 overwritePath / targetPath，只能写入授权曲库根目录（P0-1） */
function handleDownload(payload) {
  const cleanOpts = validateDownloadPayload(payload, library.getRoot())
  return netapi.downloadVoice(cleanOpts)
}

/** 替换音源：目标必须过曲库白名单校验，参数统一为 targetPath（P0-1） */
async function handleReplaceSource(payload) {
  const cleanOpts = validateReplaceSourcePayload(payload, library.getRoot())
  const res = await netapi.downloadVoice(cleanOpts)
  if (cleanOpts.targetPath) library.invalidateCover(cleanOpts.targetPath)
  if (payload && payload.targetPath) library.invalidateCover(payload.targetPath)
  return res
}

/** 自动抓词：写旁挂 .lrc 前对派生目标做符号链接/越界校验 */
async function handleLyricsAuto({ title, artist, filePath }) {
  try {
    const r = await netapi.autoLyric({ title, artist })
    if (!r.ok) return { ok: false, reason: r.reason }
    // 写旁挂歌词，下次直接命中（同时对派生 .lrc 目标做防符号链接校验）
    if (filePath) {
      let side = ''
      try {
        const checkedAudio = library.assertInsideLibrary(filePath)
        side = library.assertSafeWriteTarget(checkedAudio.replace(/\.[^.]+$/, '') + '.lrc')
      } catch {
        return { ok: false, reason: 'PATH_OUTSIDE_LIBRARY：路径不在曲库授权目录内' }
      }
      try { fs.writeFileSync(side, r.text, 'utf8') }
      catch (e) { return { ok: false, reason: 'WRITE_FAILED' + (e.code ? '(' + e.code + ')' : '') + '：写入歌词文件失败' } }
    }
    const lines = parseLrc(r.text.replace(/^\uFEFF/, ''))
    return { ok: lines.length > 0, lines, song: r.song, paired: lines.filter((l) => l.pair).length }
  } catch (e) {
    return { ok: false, reason: String(e.message || e) }
  }
}

module.exports = {
  startServer,
  handleSongs,
  handleVoices,
  handlePlaylist,
  handleSongDetail,
  handlePreview,
  handleDownload,
  handleReplaceSource,
  handleLyricsAuto,
}
