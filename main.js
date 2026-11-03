// music-play · 主进程
const { app, BrowserWindow, ipcMain, dialog } = require('electron')
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
    const lrcPath = path.join(path.dirname(f), path.basename(f, path.extname(f)) + '.lrc')
    tracks.push({ path: f, title, artist, album, duration, hasLrc: fs.existsSync(lrcPath) })
  }
  tracks.sort((a, b) => a.title.localeCompare(b.title, 'zh'))
  return { root: target, tracks }
})

ipcMain.handle('lyrics:get', async (_e, filePath) => {
  const lrcPath = path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath)) + '.lrc')
  if (fs.existsSync(lrcPath)) {
    const text = await fsp.readFile(lrcPath, 'utf8')
    return { source: 'lrc', lines: parseLrc(text.replace(/^\uFEFF/, '')) }
  }
  try {
    const mm = await mmModule()
    const meta = await mm.parseFile(filePath, { skipCovers: true })
    const embedded = (meta.common.lyrics || []).find(Boolean)
    if (embedded) return { source: 'embedded', lines: parseLrc(embedded) }
  } catch { /* ignore */ }
  return { source: 'none', lines: [] }
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

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 780,
    minWidth: 960, minHeight: 620,
    frame: false,
    backgroundColor: '#121216',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => win.show())
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
