// music-play · 主进程
const { app, BrowserWindow, ipcMain, dialog, screen, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises

const AUDIO_EXT = new Set(['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.opus'])
const DEFAULT_ROOT = process.env.MUSIC_ROOT ||
  'E:\\dsh\\work2\\conversations\\25_20261030_netease-podcast-lyrics\\out\\ncmv\\downloads'

let win = null
let root = DEFAULT_ROOT

// music-metadata v10+ 是纯 ESM，只能动态 import
let _mm = null
async function mmModule() {
  if (!_mm) _mm = await import('music-metadata')
  return _mm
}


// 无标签时从文件名猜 标题/歌手：\"001-月光-胡彦斌\" → 月光 / 胡彦斌
function parseName(base) {
  let s = base.replace(/^\d{1,3}\s*[-_.、)\]]\s*/, '')          // 去掉序号
  s = s.replace(/\s*[\[【（(][^\]】）)]*[\]】）)]\s*$/, '').trim() // 去掉结尾方括号标签
  const m = s.match(/^(.*?)\s+-\s+(.+)$/)                        // 优先「 - 」分隔
  if (m && !/\s/.test(m[2]) && m[2].length <= 20) return { title: m[1].trim(), artist: m[2].trim() }
  const one = s.match(/^([^-]{1,60})-([^-]{1,20})$/)              // 无空格单横线
  if (one && one[2].trim().length <= 12) return { title: one[1].trim(), artist: one[2].trim() }
  return { title: s || base, artist: '' }
}

async function walk(dir, out, depth = 0) {
  if (depth > 8) return
  let ents
  try { ents = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await walk(p, out, depth + 1)
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) out.push(p)
  }
}

// ---------- LRC 解析：同时间戳（±30ms）相邻两行 → 原文/译文配对 ----------
function parseLrc(text) {
  const rows = []
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*(.*)$/)
    if (!m) continue
    const ms = (+m[1]) * 60000 + (+m[2]) * 1000 + (m[3] ? +m[3].padEnd(2, '0').slice(0, 2) * 10 : 0)
    const body = m[4].trim()
    if (body) rows.push({ t: ms, text: body })
  }
  rows.sort((a, b) => a.t - b.t)
  const out = []
  for (const r of rows) {
    const prev = out[out.length - 1]
    if (prev && Math.abs(prev.t - r.t) <= 30) {
      prev.pair = prev.pair || [prev.text]
      prev.pair.push(r.text)
    } else {
      out.push({ t: r.t, text: r.text, pair: null })
    }
  }
  return out
}

ipcMain.handle('library:scan', async (_e, dir) => {
  const target = dir || root
  root = target
  const files = []
  await walk(target, files)
  const mm = await mmModule().catch(() => null)
  const tracks = []
  for (const f of files.slice(0, 5000)) {
    let title = path.basename(f, path.extname(f))
    let artist = '', album = '', duration = 0
    if (mm) {
      try {
        const meta = await mm.parseFile(f, { duration: true, skipCovers: true })
        title = meta.common.title || title
        artist = meta.common.artist || ''
        album = meta.common.album || ''
        duration = meta.format.duration || 0
      } catch { /* 退回文件名 */ }
    }
    // 没有标签时用文件名兜底
    if (!artist || title === path.basename(f, path.extname(f))) {
      const g = parseName(path.basename(f, path.extname(f)))
      if (g.artist) { title = g.title; artist = g.artist }
    }
    const lrcPath = path.join(path.dirname(f), path.basename(f, path.extname(f)) + '.lrc')
    tracks.push({ path: f, title, artist, album, duration, hasLrc: fs.existsSync(lrcPath) })
  }
  tracks.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  return { root: target, tracks }
})

ipcMain.handle('lyrics:get', async (_e, filePath) => {
  const dir = path.dirname(filePath)
  const base = path.basename(filePath, path.extname(filePath))
  // 多个歌词候选：同名 .lrc 优先，其次常见的双语/翻译后缀
  const names = [
    `${base}.lrc`, `${base}.双语.lrc`, `${base}.双行.lrc`, `${base}.trans.lrc`,
    `${base}.zh.lrc`, `${base}.ja.lrc`, `${base}.bilingual.lrc`,
  ]
  const found = []
  for (const n of names) {
    const fp = path.join(dir, n)
    if (!fs.existsSync(fp)) continue
    try {
      const text = (await fsp.readFile(fp, 'utf8')).replace(/^\uFEFF/, '')
      const lines = parseLrc(text)
      if (lines.length) found.push({ file: n, lines, paired: lines.filter((l) => l.pair).length })
    } catch { /* 跳过损坏文件 */ }
  }
  // 有「原文/译文配对」的优先；否则用第一个能解析的
  const best = found.find((f) => f.paired > 0) || found[0]
  if (best) return { source: 'lrc', file: best.file, lines: best.lines, paired: best.paired }

  try {
    const mm = await mmModule()
    const meta = await mm.parseFile(filePath, { skipCovers: true })
    const embedded = (meta.common.lyrics || []).find(Boolean)
    if (embedded) {
      const lines = parseLrc(embedded)
      if (lines.length) return { source: 'embedded', lines, paired: lines.filter((l) => l.pair).length }
    }
  } catch { /* ignore */ }
  return { source: 'none', lines: [], paired: 0 }
})


// ---------- 封面（带缓存，按需取） ----------
const coverCache = new Map()
ipcMain.handle('cover:get', async (_e, filePath) => {
  if (coverCache.has(filePath)) return coverCache.get(filePath)
  let url = ''
  try {
    const mm = await mmModule()
    const meta = await mm.parseFile(filePath, { duration: false, skipCovers: false })
    const pic = (meta.common.picture || [])[0]
    if (pic && pic.data) {
      const b64 = Buffer.from(pic.data).toString('base64')
      url = `data:${pic.format || 'image/jpeg'};base64,${b64}`
    }
  } catch { /* 忽略 */ }
  coverCache.set(filePath, url)
  return url
})

ipcMain.handle('dialog:pickFolder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  root,
}))

// ---------- 无边框窗口控制 ----------
ipcMain.on('win:minimize', () => win && win.minimize())
ipcMain.on('win:toggle-max', () => {
  if (!win) return
  win.isMaximized() ? win.unmaximize() : win.maximize()
})
ipcMain.on('win:close', () => win && win.close())


// ---------- 悬浮歌词窗 ----------
let floatWin = null

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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  floatWin.setAlwaysOnTop(true, 'screen-saver')
  floatWin.setVisibleOnAllWorkspaces(true)
  floatWin.loadFile(path.join(__dirname, 'renderer', 'float.html'))
  floatWin.on('closed', () => { floatWin = null; floatLocked = false })
  return floatWin
}

ipcMain.handle('float:toggle', () => {
  if (floatWin) { floatWin.close(); floatWin = null; return false }
  createFloatWindow()
  return true
})
ipcMain.handle('float:isOpen', () => !!floatWin)
ipcMain.on('float:push', (_e, payload) => {
  if (floatWin && !floatWin.isDestroyed()) floatWin.webContents.send('float:update', payload)
})
ipcMain.on('float:lock', (_e, locked) => setFloatLock(locked))
ipcMain.on('float:cmd', (_e, cmd) => {
  if (win && !win.isDestroyed()) win.webContents.send('player:cmd', cmd)
})
ipcMain.on('float:close', () => {
  if (floatWin && !floatWin.isDestroyed()) floatWin.close()
})
ipcMain.on('float:resize', (_e, h) => {
  if (floatWin && !floatWin.isDestroyed()) {
    const b = floatWin.getBounds()
    floatWin.setBounds({ x: b.x, y: b.y + (b.height - h), width: b.width, height: h })
  }
})

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 780,
    minWidth: 960, minHeight: 620,
    frame: false,
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => win.show())
  // 主窗关闭时一并关掉悬浮歌词，避免留下幽灵窗口
  win.on('closed', () => {
    if (floatWin && !floatWin.isDestroyed()) floatWin.close()
    win = null
  })
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

let floatLocked = false
function setFloatLock(locked) {
  floatLocked = !!locked
  if (floatWin && !floatWin.isDestroyed()) {
    floatWin.setIgnoreMouseEvents(floatLocked, { forward: true })
    floatWin.webContents.send('float:locked', floatLocked)
  }
}

app.whenReady().then(() => {
  createWindow()
  // Ctrl+Alt+L：悬浮歌词 锁定/解锁（锁定后鼠标穿透，只能靠这个解锁）
  globalShortcut.register('Control+Alt+L', () => {
    if (!floatWin) return
    setFloatLock(!floatLocked)
  })
})
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
