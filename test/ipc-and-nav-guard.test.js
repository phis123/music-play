'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
  isAllowedLocalPageUrl,
  isSafeExternalUrl,
  assertTrustedIpcSender,
} = require('../lib/ipc-guard')

const INDEX_HTML = path.resolve(__dirname, '..', 'renderer', 'index.html')
const FLOAT_HTML = path.resolve(__dirname, '..', 'renderer', 'float.html')
const INDEX_URL = pathToFileURL(INDEX_HTML).href
const FLOAT_URL = pathToFileURL(FLOAT_HTML).href

test('P1-2：assertTrustedIpcSender 放行主窗口（index.html）与悬浮歌词窗（float.html）顶层 Frame', () => {
  const mainSender = { mainFrame: { routingId: 1 }, isDestroyed: () => false }
  const floatSender = { mainFrame: { routingId: 2 }, isDestroyed: () => false }

  const mainEvent = {
    sender: mainSender,
    senderFrame: { url: INDEX_URL, parent: null, routingId: 1 },
  }
  assert.equal(
    assertTrustedIpcSender(mainEvent, {
      allowedSenders: [mainSender],
      allowedFiles: [INDEX_HTML],
    }),
    true
  )

  const floatEvent = {
    sender: floatSender,
    senderFrame: { url: FLOAT_URL, parent: null, routingId: 2 },
  }
  assert.equal(
    assertTrustedIpcSender(floatEvent, {
      allowedSenders: [mainSender, floatSender],
      allowedFiles: [INDEX_HTML, FLOAT_HTML],
    }),
    true
  )
})

test('P1-2：assertTrustedIpcSender 拒绝子 Frame (iframe)、未知 sender、远程 URL 与非预期本地文件', () => {
  const mainSender = { mainFrame: { routingId: 1 }, isDestroyed: () => false }
  const rogueSender = { mainFrame: { routingId: 9 }, isDestroyed: () => false }

  // 1. 子 Frame（parent 不为 null）被拒绝
  assert.throws(
    () =>
      assertTrustedIpcSender(
        {
          sender: mainSender,
          senderFrame: { url: INDEX_URL, parent: {}, routingId: 1 },
        },
        { allowedSenders: [mainSender], allowedFiles: [INDEX_HTML] }
      ),
    /IPC_UNAUTHORIZED/
  )

  // 2. routingId 与 mainFrame 不一致被拒绝
  assert.throws(
    () =>
      assertTrustedIpcSender(
        {
          sender: mainSender,
          senderFrame: { url: INDEX_URL, parent: null, routingId: 99 },
        },
        { allowedSenders: [mainSender], allowedFiles: [INDEX_HTML] }
      ),
    /IPC_UNAUTHORIZED/
  )

  // 3. 未知 WebContents sender 被拒绝
  assert.throws(
    () =>
      assertTrustedIpcSender(
        {
          sender: rogueSender,
          senderFrame: { url: INDEX_URL, parent: null, routingId: 9 },
        },
        { allowedSenders: [mainSender], allowedFiles: [INDEX_HTML] }
      ),
    /IPC_UNAUTHORIZED/
  )

  // 4. 悬浮歌词窗调用仅限主窗口的敏感接口（allowFloat=false）时被拒绝
  assert.throws(
    () =>
      assertTrustedIpcSender(
        {
          sender: mainSender,
          senderFrame: { url: FLOAT_URL, parent: null, routingId: 1 },
        },
        { allowedSenders: [mainSender], allowedFiles: [INDEX_HTML] }
      ),
    /IPC_UNAUTHORIZED/
  )

  // 5. 远程 https:// URL 或其他本地 file:// 文件被拒绝
  assert.throws(
    () =>
      assertTrustedIpcSender(
        {
          sender: mainSender,
          senderFrame: { url: 'https://evil.example.com/index.html', parent: null, routingId: 1 },
        },
        { allowedSenders: [mainSender], allowedFiles: [INDEX_HTML] }
      ),
    /IPC_UNAUTHORIZED/
  )
  const otherLocalUrl = pathToFileURL(path.resolve(__dirname, '..', 'package.json')).href
  assert.throws(
    () =>
      assertTrustedIpcSender(
        {
          sender: mainSender,
          senderFrame: { url: otherLocalUrl, parent: null, routingId: 1 },
        },
        { allowedSenders: [mainSender], allowedFiles: [INDEX_HTML] }
      ),
    /IPC_UNAUTHORIZED/
  )
})

test('P2-5：窗口导航保护 isAllowedLocalPageUrl 与 isSafeExternalUrl 校验', () => {
  assert.equal(isAllowedLocalPageUrl(INDEX_URL, [INDEX_HTML]), true)
  assert.equal(isAllowedLocalPageUrl(FLOAT_URL, [INDEX_HTML]), false)
  assert.equal(isAllowedLocalPageUrl('https://music.163.com', [INDEX_HTML]), false)
  assert.equal(isAllowedLocalPageUrl('javascript:alert(1)', [INDEX_HTML]), false)

  assert.equal(isSafeExternalUrl('https://github.com/phis123/music-play'), true)
  assert.equal(isSafeExternalUrl('http://example.com'), true)
  assert.equal(isSafeExternalUrl('file:///C:/Windows/System32/cmd.exe'), false)
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false)
})
