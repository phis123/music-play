'use strict'
/**
 * main/diag.js — 诊断日志出口 + 应用信息快照
 *
 * 桌面端历史上没有独立诊断模块（Android 侧有 diag.js），主进程的「诊断」只由若干
 * console.warn / console.error 承担。拆分后把所有日志输出集中到此处：
 * warn/error 只透传参数，不重新格式化，因此输出与拆分前逐字一致。
 * appInfo() 提供 app:info 通道所需的快照（版本 / 运行时 / 当前曲库根）。
 */
const { app } = require('electron')

/** 诊断日志：与拆分前 console.warn(...) 完全等价 */
function warn(...args) {
  console.warn(...args)
}

/** 诊断日志：与拆分前 console.error(...) 完全等价 */
function error(...args) {
  console.error(...args)
}

/**
 * app:info 快照。
 * 与原实现一致：先 loadUserConfig() 刷新一次曲库根（用户手改 config 后无需重启即可反映）。
 */
function appInfo() {
  const library = require('./library') // 延迟 require：避免 diag ↔ library 的加载期循环
  library.loadUserConfig()
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    root: library.getRoot(),
  }
}

module.exports = {
  warn,
  error,
  appInfo,
}
