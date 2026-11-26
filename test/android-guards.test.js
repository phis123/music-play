'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const JAVA_DIR = path.join(ROOT, 'android/app/java/com/phis/musicplay')
const ASSETS_DIR = path.join(ROOT, 'android/app/assets')

test('架构红线：PlayerBridge.java 已彻底清除且不再被 MainActivity/Bridge 引用', () => {
  assert.equal(fs.existsSync(path.join(JAVA_DIR, 'PlayerBridge.java')), false)
  const mainAct = fs.readFileSync(path.join(JAVA_DIR, 'MainActivity.java'), 'utf8')
  const bridge = fs.readFileSync(path.join(JAVA_DIR, 'Bridge.java'), 'utf8')
  assert.doesNotMatch(mainAct, /PlayerBridge/)
  assert.doesNotMatch(bridge, /PlayerBridge/)
})

test('Bridge 契约：64 个 @JavascriptInterface 保持完整，下载上限与模块化委托就位', () => {
  const bridge = fs.readFileSync(path.join(JAVA_DIR, 'Bridge.java'), 'utf8')
  const ifaceCount = (bridge.match(/^\s*@JavascriptInterface\b/gm) || []).length
  assert.equal(ifaceCount, 64, `Bridge @JavascriptInterface 数量应保持 64，实测 ${ifaceCount}`)

  assert.equal(fs.existsSync(path.join(JAVA_DIR, 'BridgeStorage.java')), true)
  assert.equal(fs.existsSync(path.join(JAVA_DIR, 'BridgeNet.java')), true)
  assert.equal(fs.existsSync(path.join(JAVA_DIR, 'Mp3LoudnessEstimator.java')), true)

  const bridgeNet = fs.readFileSync(path.join(JAVA_DIR, 'BridgeNet.java'), 'utf8')
  assert.match(bridgeNet, /MAX_DOWNLOAD_BYTES\s*=\s*200L\s*\*\s*1024\s*\*\s*1024/)
})

test('Android 安全防线：index.html 具备 CSP、DiagReceiver 具备 DUMP 权限、nowplaying 歌手名已转义', () => {
  const html = fs.readFileSync(path.join(ASSETS_DIR, 'index.html'), 'utf8')
  assert.match(html, /http-equiv="Content-Security-Policy"/i)
  assert.match(html, /script-src\s+'self'/i)
  assert.match(html, /object-src\s+'none'/i)

  const manifest = fs.readFileSync(path.join(ROOT, 'android/app/AndroidManifest.xml'), 'utf8')
  assert.match(manifest, /android:name="\.DiagReceiver"[\s\S]*?android:permission="android\.permission\.DUMP"/)

  const npJs = fs.readFileSync(path.join(ASSETS_DIR, 'js/views/nowplaying.js'), 'utf8')
  assert.match(npJs, /\$\{esc\(v\.song\.artist \|\| ''\)\}/)
})

test('Android WebView 108 兼容性：mobile.css 不使用 Chromium 111+ 才支持的 color-mix()', () => {
  const css = fs.readFileSync(path.join(ASSETS_DIR, 'css/mobile.css'), 'utf8')
  assert.doesNotMatch(css, /color-mix\s*\(/i)
})

test('版本三处同步：package.json / AndroidManifest.xml / PlaybackService.buildTagText 一致', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const manifest = fs.readFileSync(path.join(ROOT, 'android/app/AndroidManifest.xml'), 'utf8')
  const svc = fs.readFileSync(path.join(JAVA_DIR, 'PlaybackService.java'), 'utf8')
  const mName = manifest.match(/android:versionName="([^"]+)"/)
  assert.ok(mName && mName[1] === pkg.version, `Manifest versionName (${mName && mName[1]}) != package.json (${pkg.version})`)
  assert.ok(svc.includes(`-v${pkg.version}"`), `PlaybackService.buildTagText 未同步到 v${pkg.version}`)
})
