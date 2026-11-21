'use strict'
/**
 * main/windows.js — 主窗口 + 悬浮歌词窗 + 托盘 + 解锁快捷键 + IPC 来源校验
 *
 * 拆分原则：窗口生命周期与窗口操作集中在本模块；其它模块（ipc-registry / library / net）
 * 只能通过本模块导出的函数操作窗口，不再直接持有 win / floatWin 引用。
 * verifyIpc 放在这里是因为它需要当前窗口引用与两个页面路径（index.html / float.html）。
 */
const { BrowserWindow, screen, globalShortcut, Tray, Menu, nativeImage, shell, app } = require('electron')
const path = require('path')
const fs = require('fs')
const {
  isAllowedLocalPageUrl,
  isSafeExternalUrl,
  assertTrustedIpcSender,
} = require('../lib/ipc-guard')
const diag = require('./diag')

const INDEX_HTML_PATH = path.join(__dirname, '..', 'renderer', 'index.html')
const FLOAT_HTML_PATH = path.join(__dirname, '..', 'renderer', 'float.html')
const PRELOAD_PATH = path.join(__dirname, '..', 'preload.js')

let win = null
let floatWin = null
let floatLocked = false
let tray = null
let unlockKey = ''

/**
 * IPC 来源校验（P1-2）：所有通道统一走这里。
 * 默认只信任主窗口；allowFloat=true 时额外信任悬浮歌词窗（调用方必须显式声明）。
 */
function verifyIpc(event, { allowFloat = false } = {}) {
  const allowedSenders = [
    win && !win.isDestroyed() ? win.webContents : null,
    allowFloat && floatWin && !floatWin.isDestroyed() ? floatWin.webContents : null,
  ].filter(Boolean)
  const allowedFiles = allowFloat ? [INDEX_HTML_PATH, FLOAT_HTML_PATH] : [INDEX_HTML_PATH]
  return assertTrustedIpcSender(event, { allowedSenders, allowedFiles })
}

function hardenWindowNavigation(wc, allowedHtmlFile) {
  if (!wc) return
  wc.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url).catch(() => {})
    }
    return { action: 'deny' }
  })
  wc.on('will-navigate', (event, url) => {
    if (isAllowedLocalPageUrl(url, [allowedHtmlFile])) return
    event.preventDefault()
    if (isSafeExternalUrl(url)) {
      shell.openExternal(url).catch(() => {})
    }
  })
  wc.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

function getMainWindow() {
  return win && !win.isDestroyed() ? win : null
}

function getFloatWindow() {
  return floatWin && !floatWin.isDestroyed() ? floatWin : null
}

function isFloatOpen() {
  return !!floatWin
}

// ---------- 主窗口 ----------
function createMainWindow() {
  const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico')
  win = new BrowserWindow({
    width: 1200, height: 780,
    minWidth: 960, minHeight: 620,
    frame: false,
    backgroundColor: '#ffffff',
    show: false,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.setMenuBarVisibility(false)
  hardenWindowNavigation(win.webContents, INDEX_HTML_PATH)
  win.once('ready-to-show', () => win.show())
  // 主窗关闭时一并关掉悬浮歌词，避免留下幽灵窗口
  win.on('closed', () => {
    if (floatWin && !floatWin.isDestroyed()) floatWin.close()
    win = null
  })
  win.loadFile(INDEX_HTML_PATH).catch((e) => diag.warn('[win] 主页面加载失败:', e && e.message))
  return win
}

function focusMainWindow() {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

// ---------- 悬浮歌词窗 ----------
function createFloatWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const w = 900, h = 200
  floatWin = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round((width - w) / 2),
    y: height - h - 80,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    hasShadow: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  try { if (!tray) createTray() } catch { }
  hardenWindowNavigation(floatWin.webContents, FLOAT_HTML_PATH)
  floatWin.setAlwaysOnTop(true, 'screen-saver')
  floatWin.setVisibleOnAllWorkspaces(true)
  floatWin.loadFile(FLOAT_HTML_PATH).catch((e) => diag.warn('[float] 页面加载失败:', e && e.message))
  floatWin.webContents.on('did-finish-load', () => {
    if (floatWin && !floatWin.isDestroyed()) {
      floatWin.webContents.send('float:keyinfo', { key: unlockKey, locked: floatLocked })
    }
  })
  floatWin.on('closed', () => {
    floatWin = null
    floatLocked = false
    // 通知主窗：悬浮窗真的关了（否则主窗一直以为它还开着，pushFloat 空转）
    try { if (win && !win.isDestroyed()) win.webContents.send('float:closed') } catch { }
    try { if (tray) { tray.destroy(); tray = null } } catch { }
  })
  return floatWin
}

/** float:toggle 的窗口侧语义：开着就关，关着就开；返回切换后的状态 */
function toggleFloatWindow() {
  if (floatWin) { floatWin.close(); floatWin = null; return false }
  createFloatWindow()
  return true
}

function setFloatLock(locked) {
  floatLocked = !!locked
  if (floatWin && !floatWin.isDestroyed()) {
    floatWin.setIgnoreMouseEvents(floatLocked, { forward: true })
    floatWin.webContents.send('float:locked', floatLocked)
  }
  // 主窗也要知道锁定状态，否则「锁定穿透」按钮会显示成相反状态
  try { if (win && !win.isDestroyed()) win.webContents.send('float:locked', floatLocked) } catch { }
}

function sendFloatUpdate(payload) {
  if (floatWin && !floatWin.isDestroyed()) floatWin.webContents.send('float:update', payload)
}

function sendFloatStyle(style) {
  if (floatWin && !floatWin.isDestroyed()) floatWin.webContents.send('float:style', style)
}

function closeFloatWindow() {
  if (floatWin && !floatWin.isDestroyed()) floatWin.close()
}

function sendPlayerCmd(cmd) {
  if (win && !win.isDestroyed()) win.webContents.send('player:cmd', cmd)
}

/**
 * float:resize：数值必须夹取在 [60, workArea.height]。
 * NaN/负值/超大值会让 setBounds 抛未捕获异常（P0 历史缺陷），因此先做数值校验。
 */
function resizeFloat(rawHeight) {
  if (!floatWin || floatWin.isDestroyed()) return
  const height = Math.round(Number(rawHeight))
  if (!Number.isFinite(height)) return
  const maxH = (screen.getPrimaryDisplay().workAreaSize.height || 1080)
  const next = Math.min(maxH, Math.max(60, height))
  const b = floatWin.getBounds()
  if (next === b.height) return
  try {
    floatWin.setBounds({ x: b.x, y: b.y + (b.height - next), width: b.width, height: next })
  } catch (e) {
    diag.warn('[float] resize 失败:', e && e.message)
  }
}

// ---------- 托盘（锁定后的保底解锁入口） ----------
const TRAY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAyUlEQVR4nO2X0Q2DMAxEnVM3aBeCwWGhMgNVPyIBjZ04tRMkuL8o+N6ZSMEQdVbQFryHYZX2X/Os8gxW4NogwRqsDQJPeIkHPOElXvCG5zzRAi55oxWcY0Br8Jymqj1O4JJJgBRI2jtqywJ1FrTdp9bSHqfIBHUW7gB0H8HVj+ARhwbr7wB3FyzjuBtUUGoYC7l1rVA7TP6jLQuawti1Vfdf/XTtPRMc3zRyD3jCkwG8QnCe0BZYwsUAViFyHuH0v2akDNLyPjHRB4+YZ9o9UTaiAAAAAElFTkSuQmCC'

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: floatWin ? '关闭悬浮歌词' : '打开悬浮歌词',
      click: () => {
        if (floatWin) { floatWin.close(); floatWin = null }
        else { createFloatWindow(); setTimeout(() => { if (win) win.webContents.send('float:opened') }, 300) }
      },
    },
    {
      label: floatLocked ? '解锁悬浮歌词（鼠标可点）' : '锁定悬浮歌词（鼠标穿透）',
      enabled: !!floatWin,
      click: () => setFloatLock(!floatLocked),
    },
    { type: 'separator' },
    { label: '显示主窗口', click: () => { if (win) { win.show(); win.focus() } } },
    { type: 'separator' },
    { label: '退出 music-play', click: () => app.quit() },
  ])
}

function createTray() {
  try {
    const icon = nativeImage.createFromDataURL(TRAY_PNG)
    tray = new Tray(icon)
    tray.setToolTip('music-play 悬浮歌词')
    tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()))
    tray.on('double-click', () => {
      if (!floatWin) { createFloatWindow(); return }
      setFloatLock(!floatLocked)          // 双击托盘：快速切锁定
    })
  } catch (e) {
    // 托盘不可用不影响主功能
  }
}

/** float:menu：在无托盘的环境里也能右键弹出同一个菜单 */
function popupFloatMenu() {
  buildTrayMenu().popup({ window: win || undefined })
}

// ---------- 解锁快捷键（多候选，注册成功才算数） ----------
const KEY_CANDIDATES = [
  ['Control+Alt+L', 'Ctrl+Alt+L'],
  ['Control+Alt+U', 'Ctrl+Alt+U'],
  ['Control+Shift+L', 'Ctrl+Shift+L'],
  ['Alt+Shift+L', 'Alt+Shift+L'],
]

function registerUnlockShortcut() {
  for (const [acc, label] of KEY_CANDIDATES) {
    try {
      if (globalShortcut.register(acc, () => setFloatLock(!floatLocked))) {
        unlockKey = label
        return
      }
    } catch { /* 下一个 */ }
  }
  unlockKey = '托盘图标右键'
}

/** will-quit：释放全局快捷键与托盘 */
function shutdownWindows() {
  globalShortcut.unregisterAll()
  try { if (tray) { tray.destroy(); tray = null } } catch { }
}

module.exports = {
  INDEX_HTML_PATH,
  FLOAT_HTML_PATH,
  verifyIpc,
  hardenWindowNavigation,
  getMainWindow,
  getFloatWindow,
  createMainWindow,
  focusMainWindow,
  createFloatWindow,
  toggleFloatWindow,
  isFloatOpen,
  setFloatLock,
  sendFloatUpdate,
  sendFloatStyle,
  closeFloatWindow,
  sendPlayerCmd,
  resizeFloat,
  createTray,
  buildTrayMenu,
  popupFloatMenu,
  registerUnlockShortcut,
  shutdownWindows,
}
