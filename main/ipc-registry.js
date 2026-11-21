'use strict'
/**
 * main/ipc-registry.js — IPC 统一注册入口（30 个通道集中登记）
 *
 * 为什么要有这一层：历史上 `library:scan` 曾经漏掉来源校验，之后才靠人工逐个补
 * verifyIpc。把通道收敛成一张表后，校验由注册器统一注入（verifyIpc 一定先于业务代码
 * 执行），新增通道只要忘了写 allowFloat 也不会「默认放行悬浮窗」。
 *
 * 表结构：
 *   channel      通道名（逐字不变，改动即破坏 preload 契约）
 *   kind         'handle'（ipcMain.handle，返回 Promise）| 'on'（ipcMain.on，单向下发）
 *   allowFloat   是否额外信任悬浮歌词窗（默认 false = 仅主窗口）
 *   onDeny       校验失败时的行为：'reject' 抛出（invoke 端 rejected）、
 *                'return' 静默返回、或函数（返回该通道原有的兜底值）
 *   handler      业务实现（拿到的 event 已完成校验）
 */
const { ipcMain } = require('electron')
const windows = require('./windows')
const library = require('./library')
const net = require('./net')
const diag = require('./diag')

const deny = (reasonOf) => (e) => ({ ok: false, reason: String((e && e.message) || e) })
const EMPTY_LYRICS = () => ({ source: 'none', lines: [], paired: 0 })

const CHANNELS = [
  // ---------- 曲库 ----------
  { channel: 'library:scan', kind: 'handle', allowFloat: false, onDeny: 'reject',
    handler: (event, dir) => library.handleScan(event, dir) },
  { channel: 'library:scan-cancel', kind: 'on', allowFloat: false, onDeny: 'return',
    handler: (_event, gen) => library.handleScanCancel(gen) },

  // ---------- 歌词 / 封面 / 增益 ----------
  { channel: 'lyrics:get', kind: 'handle', allowFloat: false, onDeny: EMPTY_LYRICS,
    handler: (_event, filePath) => library.handleLyricsGet(filePath) },
  { channel: 'cover:get', kind: 'handle', allowFloat: false, onDeny: '',
    handler: (_event, filePath) => library.handleCoverGet(filePath) },
  { channel: 'dialog:pickFolder', kind: 'handle', allowFloat: false, onDeny: 'reject',
    handler: () => library.handlePickFolder() },
  { channel: 'audio:gain', kind: 'handle', allowFloat: false, onDeny: 0,
    handler: (_event, filePath) => library.handleAudioGain(filePath) },

  // ---------- 内置网易云 API ----------
  { channel: 'net:songs', kind: 'handle', allowFloat: false, onDeny: 'reject',
    handler: (_event, kw) => net.handleSongs(kw) },
  { channel: 'net:voices', kind: 'handle', allowFloat: false, onDeny: 'reject',
    handler: (_event, payload) => net.handleVoices(payload) },
  { channel: 'lyrics:auto', kind: 'handle', allowFloat: false, onDeny: deny(),
    handler: (_event, payload) => net.handleLyricsAuto(payload) },
  { channel: 'net:playlist', kind: 'handle', allowFloat: false, onDeny: 'reject',
    handler: (_event, id) => net.handlePlaylist(id) },
  { channel: 'net:songDetail', kind: 'handle', allowFloat: false, onDeny: 'reject',
    handler: (_event, id) => net.handleSongDetail(id) },
  { channel: 'net:preview', kind: 'handle', allowFloat: false, onDeny: 'reject',
    handler: (_event, trackId) => net.handlePreview(trackId) },
  { channel: 'net:download', kind: 'handle', allowFloat: false, onDeny: 'reject',
    handler: (_event, payload) => net.handleDownload(payload) },
  { channel: 'net:replaceSource', kind: 'handle', allowFloat: false, onDeny: 'reject',
    handler: (_event, payload) => net.handleReplaceSource(payload) },

  // ---------- 收藏 / 封面补齐 / 删除 ----------
  { channel: 'lib:fav', kind: 'handle', allowFloat: false, onDeny: deny(),
    handler: (_event, payload) => library.handleFav(payload) },
  { channel: 'lib:coverFix', kind: 'handle', allowFloat: false, onDeny: 'reject',
    handler: (_event, tracks) => library.handleCoverFix(tracks) },
  { channel: 'lib:delete', kind: 'handle', allowFloat: false, onDeny: deny(),
    handler: (_event, filePath) => library.handleDelete(filePath) },

  // ---------- 应用信息（悬浮窗也要能读版本与曲库根） ----------
  { channel: 'app:info', kind: 'handle', allowFloat: true, onDeny: 'reject',
    handler: () => diag.appInfo() },

  // ---------- 无边框窗口控制 ----------
  { channel: 'win:minimize', kind: 'on', allowFloat: false, onDeny: 'return',
    handler: () => { const w = windows.getMainWindow(); if (w) w.minimize() } },
  { channel: 'win:toggle-max', kind: 'on', allowFloat: false, onDeny: 'return',
    handler: () => {
      const w = windows.getMainWindow()
      if (!w) return
      w.isMaximized() ? w.unmaximize() : w.maximize()
    } },
  { channel: 'win:close', kind: 'on', allowFloat: false, onDeny: 'return',
    handler: () => { const w = windows.getMainWindow(); if (w) w.close() } },

  // ---------- 悬浮歌词窗 ----------
  { channel: 'float:toggle', kind: 'handle', allowFloat: true, onDeny: 'reject',
    handler: () => windows.toggleFloatWindow() },
  { channel: 'float:isOpen', kind: 'handle', allowFloat: true, onDeny: 'reject',
    handler: () => windows.isFloatOpen() },
  { channel: 'float:push', kind: 'on', allowFloat: false, onDeny: 'return',
    handler: (_event, payload) => windows.sendFloatUpdate(payload) },
  { channel: 'float:style', kind: 'on', allowFloat: true, onDeny: 'return',
    handler: (_event, style) => windows.sendFloatStyle(style) },
  { channel: 'float:lock', kind: 'on', allowFloat: true, onDeny: 'return',
    handler: (_event, locked) => windows.setFloatLock(locked) },
  { channel: 'float:menu', kind: 'on', allowFloat: true, onDeny: 'return',
    handler: () => windows.popupFloatMenu() },
  { channel: 'float:cmd', kind: 'on', allowFloat: true, onDeny: 'return',
    handler: (_event, cmd) => windows.sendPlayerCmd(cmd) },
  { channel: 'float:close', kind: 'on', allowFloat: true, onDeny: 'return',
    handler: () => windows.closeFloatWindow() },
  { channel: 'float:resize', kind: 'on', allowFloat: true, onDeny: 'return',
    handler: (_event, h) => windows.resizeFloat(h) },
]

function denyResult(def, e) {
  if (typeof def.onDeny === 'function') return def.onDeny(e)
  return undefined
}

/** handle 通道：async 包装（校验异常 → rejected promise，与拆分前的 async handler 一致） */
function wrapHandle(def) {
  return async (event, ...args) => {
    try {
      windows.verifyIpc(event, { allowFloat: !!def.allowFloat })
    } catch (e) {
      if (def.onDeny === 'reject') throw e
      return denyResult(def, e)
    }
    return def.handler(event, ...args)
  }
}

/** on 通道：同步包装（校验异常 → 静默返回） */
function wrapOn(def) {
  return (event, ...args) => {
    try {
      windows.verifyIpc(event, { allowFloat: !!def.allowFloat })
    } catch (e) {
      if (def.onDeny === 'reject') throw e
      return denyResult(def, e)
    }
    return def.handler(event, ...args)
  }
}

/** 注册全部通道；返回通道数，便于自检 */
function registerAll() {
  for (const def of CHANNELS) {
    if (def.kind === 'handle') ipcMain.handle(def.channel, wrapHandle(def))
    else ipcMain.on(def.channel, wrapOn(def))
  }
  return CHANNELS.length
}

module.exports = {
  CHANNELS,
  registerAll,
}
