// music-play · 主进程（薄入口：app 生命周期 + 模块装配 + IPC 注册）
//
// 阶段4 模块化后的分工：
//   main/windows.js       主窗口 / 悬浮歌词窗 / 托盘 / 解锁快捷键 / verifyIpc
//   main/library.js       曲库扫描（含代际取消与增量缓存）/ 封面 / 收藏 / 删除 / 用户配置
//   main/net.js           netapi 启停 / 在线搜索 / 下载与换源（200MB 上限在 netapi.js）/ 自动抓词
//   main/diag.js          诊断日志出口 + app:info 快照
//   main/ipc-registry.js  30 个 IPC 通道统一注册（统一注入 verifyIpc）
// 本文件只保留「谁先谁后」的启动顺序，不再承载业务逻辑。
const { app, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

// 兼容受管目录 / 低完整性级别启动：若默认 %APPDATA%\music-play 不可写，自动回退到程序旁 userdata 目录；
// 仅在受限沙箱环境（DSH_SESSION_ID 或显式 ELECTRON_NO_SANDBOX=1）下追加 no-sandbox 兜底，常规桌面环境保持 Chromium 沙箱开启。
if (process.env.DSH_SESSION_ID || process.env.ELECTRON_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}
;(function ensureWritablePaths() {
  try {
    const defDir = app.getPath('userData')
    fs.mkdirSync(defDir, { recursive: true })
    const probe = path.join(defDir, '._wprobe')
    fs.writeFileSync(probe, '1')
    fs.unlinkSync(probe)
  } catch {
    try {
      const baseDir = path.join(path.dirname(process.execPath), 'userdata')
      const sessDir = path.join(baseDir, 'session')
      const tmpDir = path.join(baseDir, 'temp')
      fs.mkdirSync(sessDir, { recursive: true })
      fs.mkdirSync(tmpDir, { recursive: true })
      app.setPath('userData', baseDir)
      app.setPath('sessionData', sessDir)
      app.setPath('temp', tmpDir)
      process.env.TEMP = tmpDir
      process.env.TMP = tmpDir
    } catch { }
  }
})()

const diag = require('./main/diag')
const windows = require('./main/windows')
const library = require('./main/library')   // 加载即执行 authorizeDir(默认曲库根)
const net = require('./main/net')
const ipcRegistry = require('./main/ipc-registry')

// ---------- 单实例锁：重复双击只聚焦已有窗口，不再起第二个 ----------
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

// ---------- IPC 注册：统一入口，校验由注册器注入 ----------
ipcRegistry.registerAll()

app.whenReady().then(() => {
  windows.createMainWindow()
  windows.registerUnlockShortcut()
  net.startServer()
}).catch((e) => {
  diag.error('[app] 初始化失败:', e && (e.stack || e.message || e))
  try { dialog.showErrorBox('music-play 启动失败', String((e && e.message) || e)) } catch { }
})

app.on('will-quit', () => {
  windows.shutdownWindows()
})

app.on('second-instance', () => {
  windows.focusMainWindow()
})

app.on('window-all-closed', () => app.quit())
