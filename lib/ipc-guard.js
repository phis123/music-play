'use strict'
const path = require('path')
const { fileURLToPath } = require('url')

function _normPath(p) {
  const resolved = path.resolve(String(p || ''))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * 判断 URL 是否为允许的本地应用页面（仅允许 file:// 协议且路径精确匹配预期的 HTML 文件）
 */
function isAllowedLocalPageUrl(urlStr, allowedFiles = []) {
  if (typeof urlStr !== 'string' || !urlStr) return false
  try {
    const u = new URL(urlStr)
    if (u.protocol !== 'file:') return false
    const filePath = _normPath(fileURLToPath(u))
    for (const allowed of allowedFiles) {
      if (allowed && _normPath(allowed) === filePath) return true
    }
  } catch {
    return false
  }
  return false
}

/**
 * 判断 URL 是否为允许通过系统默认浏览器打开的外部 http/https 链接
 */
function isSafeExternalUrl(urlStr) {
  if (typeof urlStr !== 'string' || !urlStr) return false
  try {
    const u = new URL(urlStr)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * IPC 调用来源校验（P1-2）：
 * - 验证 event.sender 属于受信任窗口（主窗口 win 或悬浮歌词窗 floatWin）
 * - 验证 event.senderFrame 为顶层 frame（非 iframe / 子 frame）
 * - 验证页面 URL 精确匹配预期的本地应用页面（renderer/index.html 或 renderer/float.html）
 */
function assertTrustedIpcSender(event, { allowedSenders = [], allowedFiles = [] } = {}) {
  if (!event || !event.sender) {
    throw Object.assign(new Error('IPC_UNAUTHORIZED：缺少合法的 IPC sender'), { code: 'IPC_UNAUTHORIZED' })
  }
  const sender = event.sender
  if (typeof sender.isDestroyed === 'function' && sender.isDestroyed()) {
    throw Object.assign(new Error('IPC_UNAUTHORIZED：发送方窗口已销毁'), { code: 'IPC_UNAUTHORIZED' })
  }
  const activeSenders = allowedSenders.filter(Boolean)
  if (activeSenders.length > 0 && !activeSenders.includes(sender)) {
    throw Object.assign(new Error('IPC_UNAUTHORIZED：未知的发送方 WebContents'), { code: 'IPC_UNAUTHORIZED' })
  }
  const frame = event.senderFrame
  if (!frame) {
    throw Object.assign(new Error('IPC_UNAUTHORIZED：缺少 senderFrame'), { code: 'IPC_UNAUTHORIZED' })
  }
  // 必须是顶层 frame（拒绝任何子 frame / iframe 调用敏感 IPC）
  if (frame.parent != null) {
    throw Object.assign(new Error('IPC_UNAUTHORIZED：拒绝子 Frame 调用敏感 IPC'), { code: 'IPC_UNAUTHORIZED' })
  }
  if (sender.mainFrame && frame.routingId !== undefined && sender.mainFrame.routingId !== undefined) {
    if (frame.routingId !== sender.mainFrame.routingId) {
      throw Object.assign(new Error('IPC_UNAUTHORIZED：senderFrame 不是主 Frame'), { code: 'IPC_UNAUTHORIZED' })
    }
  }
  const frameUrl = frame.url || (typeof sender.getURL === 'function' ? sender.getURL() : '')
  if (!isAllowedLocalPageUrl(frameUrl, allowedFiles)) {
    throw Object.assign(new Error('IPC_UNAUTHORIZED：非授信的应用页面 URL'), { code: 'IPC_UNAUTHORIZED' })
  }
  return true
}

module.exports = {
  isAllowedLocalPageUrl,
  isSafeExternalUrl,
  assertTrustedIpcSender,
}
