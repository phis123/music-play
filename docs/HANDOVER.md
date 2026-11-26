# 交接文档（HANDOVER）

> 写于 2026-11-26 ｜ 当前开发版本 `v1.0.12`（`versionCode 112`）｜ 线上最新 Release `v1.0.11`
> 项目状态与调度内核见 `.agent/STATE.md`（本地忽略不入库）；人读记忆见 `docs/PROJECT-MEMORY.md`。本文面向「接手这个人」，把他需要知道的一切按上手顺序排好。

## 1. 一句话现状

私人双端本地音乐播放器，Android（原生 Java + WebView 前端）与 Windows 桌面（Electron 45）共用一套前端思路；**v1.0.12 已完成安全加固、Android 原生与事件层模块化、LRC 解析双端统一、桌面与移动端 UI 视觉全面升级、锁文件与 CI 提速，全部 101 项单测 / 72 项语法 / 2 对资产守门全绿，桌面端已在本机 Electron 45 实测通过，正式签名 APK 与 Setup 已出包，待平板与手机真机验收**。

## 2. 项目是什么

- 仓库：`https://github.com/phis123/music-play`（私有）
- 定位：本地曲库播放器，专注**双语歌词**（原文一行 / 译文一行）
- 两套壳、一套前端思路：
  - Android：`android/app/java/com/phis/musicplay/` 原生 + `android/app/assets/` 里的 HTML/CSS/JS 跑在 WebView
  - 桌面：Electron 45.2.1（Chromium 156 / Node 24.22），`main/` 主进程 + `renderer/` 渲染层
- 曲库根：桌面 `E:/music-play/resources`（738 首）；平板 `/storage/emulated/0/Music/music-play`（674 首）
- 不在仓库里的东西：曲库（8.9GB）、keystore、签名口令、GitHub PAT

## 3. 当前版本与发布态

| 项 | 值 |
| --- | --- |
| 版本 | `1.0.12`（`package.json` / `AndroidManifest` versionCode **112** / `PlaybackService.buildTagText = "2026-11-26.19:05-v1.0.12"`） |
| Git | `main`（已同步远端）；线上最新 Release 仍为 `v1.0.11`（`ab91c70`，待真机验收后发 `v1.0.12`） |
| 本地产物 | `E:/dsh/work3/out/music-play-1.0.12.apk`（正式签名，SHA-256 `46165aa1…75a959`）与 `music-play-Setup-1.0.12.exe` |
| 签名 | keystore `E:/dsh/work3/keys/music-play-release.jks`，alias `musicplay`，证书 SHA-256 以 `46165aa1…75a959` 结尾，**与 1.0.9~1.0.11 同一把** |
| 本机状态 | 桌面 Electron 45 便携运行时已同步 1.0.12 并实测通过（738 首、0 报错）；平板与手机真机待用户安装 1.0.12 APK 验收 |

v1.0.12 包含**安全加固、模块化重构、双端 LRC 统一、Studio Paper / Obsidian Vinyl 双端 UI 重构与 CI/锁文件治理**。

## 4. 代码结构现状（真实行数）

```
main.js                75 行   薄入口：app 生命周期 + 模块装配
main/
  ipc-registry.js     149 行   30 个 IPC 通道声明表 + 统一注入 verifyIpc
  windows.js          303 行   主窗 / 悬浮歌词窗 / 托盘 / 全局快捷键
  library.js          530 行   扫描（代际缓存）/ 封面 / 收藏 / 删除 / 歌词读取
  net.js               94 行   ncm API 启停 / 搜索 / 试听 / 下载换源 / 抓词
  diag.js              41 行   日志出口 + app:info
preload.js                     38 个 contextBridge API（**改它要同步改渲染层调用**）
netapi.js                      ncm API 启停 + 下载（200MB 上限）
lib/                           lrc.js / loudness.js / path-guard.js / ipc-guard.js / random.js / library-scan.js
renderer/js/
  app.js              478 行   入口：pickNextShuffleIndex / bindGlobal / init
  core/               dom state store ui task theme nav（7 个）
  library/            cover scan search import health（5 个）
  player/             audio queue lyrics（3 个）
  views/              lists settings sheet router（4 个）
  float.js                      悬浮歌词窗入口
android/app/assets/js/         已模块化：core/ library/ player/ views/ events/(player,library,settings) + diag/events/native-callbacks + lrc.js + random.js + mobile.js(81 行)
android/app/java/com/phis/musicplay/
                              PlayerEngine PlaybackService Bridge(薄门面,64 @JavascriptInterface)
                              BridgeStorage BridgeNet(200MB下载上限) Mp3LoudnessEstimator
                              AudioStore LyricsOverlay Diag DiagReceiver(DUMP权限) MainActivity
tools/                        build-apk.mjs(含JDK17自动回退) / lint-syntax.mjs / verify-assets.mjs / music-play.iss
test/                         13 个文件 / 101 用例
docs/                         共 10 个文档（见第 11 节）
```

**注意路径形态**：Manifest 是 `android/app/AndroidManifest.xml`，Java 在 `android/app/java/...`，**没有 `src/main/` 这一层**。网上文档或旧脚本若按标准 Gradle 布局写路径，会全部找不到文件。

## 5. 架构红线（违反即事故，改代码前必读）

1. **MediaPlayer 只有 `PlayerEngine` 能碰**，且跑在专属 `HandlerThread("mp-player")` 上串行；任何 mp 调用必须 `post` 到该线程
2. **`PlaybackService` 只是壳**（MediaSession / 通知 / 音频焦点 / WakeLock / 回推网页），禁止直接操作 mp
3. **所有 IPC 必过 `verifyIpc`**：主进程侧统一在 `main/ipc-registry.js` 的 `CHANNELS` 表里声明，别在业务文件里另起 `ipcMain.handle`（历史上 `library:scan` 就漏过授权）
4. **所有文件路径必过 `lib/path-guard.js`**：读走 `assertInsideLibrary`，写走 `assertSafeWriteTarget`
5. **`library:scan` 的 `dir` 必须在授权集合内**，新目录唯一入口是 `dialog:pickFolder`
6. **滚动判据**：区分「程序滚动 / 用户滚动」严禁用短定时器清标志（Chromium smooth 滚动异步 200~400ms，120ms 定时器必然误判）；必须「调用时刻 + ≥800ms 窗口 + `scrollend`」。`scrollLyricsTo()` 是歌词区**唯一**程序滚动入口
7. **`position:absolute` 提示层禁止放进 `overflow-y:auto` 容器**（会随内容滚走）
8. **preload 里禁用 `Buffer` / `timers` / `url`**（Electron 45 已移除这些 shim）
9. **Electron 45 dist 没有 `libEGL.dll`/`libGLESv2.dll`（ANGLE 静态链接）也没有 ia32**：打包必须整目录复制 dist；安装目录若残留旧版这两个 DLL，手工删掉
10. **打 Setup 绝不能把 `E:/music-play/resources` 里的曲库纳入**（8.9GB 撞 Inno 4GB 上限，必然失败）

## 6. 契约速查（签名级）

**Electron IPC**：30 个通道，名字与 `handle`/`on` 类型自 v1.0.10 起逐字未变；对照表在 `main/ipc-registry.js` 的 `CHANNELS`，单测 `test/ipc-and-nav-guard.test.js` 守着名字与授权。

**preload**：38 个 API，含 `floatIsOpen()` / `onFloatOpened()` / `onFloatClosed()` / `onFloatLocked()` / `onFloatUpdate()` / `onFloatKeyinfo()` / `onFloatStyle()`。

**主进程模块导出**（节选，全量见 `out/main-split-report.md`）：
- `main/windows.js`：`verifyIpc(event,{allowFloat})`、`createMainWindow()`、`toggleFloatWindow()`、`resizeFloat(rawHeight)`（夹取 `[60, workArea.height]`）、`createTray()`、`shutdownWindows()`
- `main/library.js`：`handleScan(event,dir)`、`handleLyricsGet(filePath)`、`handleCoverGet(filePath)`、`handlePickFolder()`、`handleAudioGain(filePath)`、`handleFav({filePath,on})`、`handleDelete(filePath)`
- `main/ipc-registry.js`：`CHANNELS: Array<{channel,kind,allowFloat,onDeny,handler}>`、`registerAll() -> 30`

**Android 原生**（完整签名见 `.agent/STATE.md` 第 3 节）：
- `PlayerEngine`：`playUrl(String)->boolean` / `pause()` / `resume()` / `seek(int)` / `setVolume(float)` / `setGain(float)` / `setDucked(boolean)` / `setCallback(Callback)` / `positionMs()` / `durationSec()`
- `PlaybackService`：`playUrl(url,title,artist,path[,cover])` / `toggle()` / `recover()` / `setGainDb(float)` / `static start(Context)->boolean` / `static diagState()->String`
- `Diag` / `DiagReceiver`：诊断导出，触发必须带 `-n`：
  `adb shell am broadcast -n com.phis.musicplay/.DiagReceiver -a com.phis.musicplay.DIAG_EXPORT`

**纯函数库**：
- `lib/lrc.js::parseLrc(text) -> [{t:int ms, text, pair}]`
- `lib/random.js::pickNextShuffleIndex({queuePaths,qPos,strategy,playedSet,playCountOf,random}) -> int`，策略 `['no-repeat','rare-first','true-random']`，UMD 供浏览器用
- `lib/library-scan.js`：`pickAudioFiles` / `applyTruncation` / `mergeScanGen` / `acceptScanCancel` / `sortTracksByTitle` / `collectAudioFiles`

## 7. 质量门（提交前必须全绿）

```bash
cd E:/dsh/work3/mp
node --test                        # 101 pass / 0 fail（13 个测试文件）
node tools/lint-syntax.mjs         # 72/72（递归覆盖 main/、renderer 子目录、android assets 子目录）
node tools/verify-assets.mjs       # exit 0：lib/random.js 与 lib/lrc.js 双端副本逐字节一致 + 35 处页面引用存在
```

CI（`.github/workflows/test.yml`）三个 job：`test (ubuntu-latest)`、`test (windows-latest)`、`apk (windows-latest)`（9 步，已加 `package-lock.json` + `npm ci` + 缓存 + `cmdline-tools` 快路径）。`apk` job 在无 secrets 时出随机口令自签包，只证明"能打包"，不可发版。

## 8. 构建与发布

### 8.1 签名口令怎么拿

口令**不在仓库、不在任何脚本**里，而是 DPAPI 密文存在 `E:/dsh/work3/keys/ks-pass.dpapi`（绑定「当前 Windows 用户 + 本机」）：

```bash
source E:/dsh/work3/build/ks-pass.sh          # 注入 APK_KS_PASS / APK_KEYSTORE / APK_KS_ALIAS
pwsh -NoProfile -File E:/dsh/work3/build/ks-pass.ps1 -Action Test   # 校验能否解密（不输出明文）
pwsh -NoProfile -File E:/dsh/work3/build/ks-pass.ps1 -Action Set    # 换机/换用户后重新录入
```

缺口令时 `tools/build-apk.mjs` 会 **exit 2 快速失败**，不会静默降级成 debug 签名。换机器后 DPAPI 解不开是设计如此，口令本体需要在密码管理器里另存一份。

### 8.2 出 APK

```bash
source E:/dsh/work3/build/ks-pass.sh
node tools/build-apk.mjs . ../out/music-play-1.0.12.apk        # 版本自动取 package.json + Manifest
# 显式指定版本时，versionCode 必须大于已安装值，否则真机报 INSTALL_FAILED_VERSION_DOWNGRADE
```

升版本要**三处同步**：`package.json`、`android/app/AndroidManifest.xml`（versionCode/versionName）、`PlaybackService.buildTagText`。

### 8.3 装到平板（无线 adb）

```bash
export MSYS_NO_PATHCONV=1                      # 必须，否则设备路径被 MSYS 改写
adb connect 100.120.69.40:5555
adb -s 100.120.69.40:5555 push ../out/music-play-1.0.12.apk /data/local/tmp/mp.apk
adb -s 100.120.69.40:5555 shell "su -c 'pm install -r /data/local/tmp/mp.apk'"   # Magisk root，静默装零弹窗
```

验收：`dumpsys package com.phis.musicplay` 的 versionCode、`diag/session.log` 里 `boot start, build=...`、`library: tracks=` 数量、`grep -ci error` 为 0。

### 8.4 出桌面 Setup

1. 把 `mp` 的 `main.js` / `preload.js` / `netapi.js` / `main/` / `lib/` / `renderer/` / `assets/` / `package.json` 覆盖进 `E:/dsh/work3/out/mp45-portable/resources/app/`（`node_modules` 保留，Electron 运行时文件不动）
2. 用 `E:/dsh/work3/build/make-iss-110.py` 的模式生成对应版本的 iss（`AppVersion` + `OutputBaseFilename`），再 `ISCC.exe` 编译（lzma2/max，约 1 分钟，产物约 127MB）
3. **静默安装必须原生调用**：

```powershell
Start-Process -FilePath '.../music-play-Setup-1.0.12.exe' -Wait -PassThru -ArgumentList `
  '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-','/DIR=E:\music-play',"/LOG=$log"
```

**坑**：在 git-bash 里直接传 `/VERYSILENT` 会被路径转换成 `E:/dsh/tools/git-bash/VERYSILENT`，参数全部失效 → 安装器卡住。历史上因此误判过「静默安装超时 240 秒」。要么用 `Start-Process`，要么置 `MSYS_NO_PATHCONV=1`。

### 8.5 发布

打 tag → push tag → 建 release 并上传三资产（APK / Setup / `git archive --format=zip` 的源码包）。本机访问 GitHub 需代理 `127.0.0.1:7890`，PAT 在 `C:/Users/phis123/Desktop/重要文件/github密钥，不要上传！.txt`（单行 classic token，**用完即弃、绝不入库、绝不回显**）：

```bash
git -c credential.helper= -c http.proxy=http://127.0.0.1:7890 push \
  https://x-access-token:$T@github.com/phis123/music-play.git main:main    # 置 GIT_TERMINAL_PROMPT=0
```

历史教训：本地与远端曾长期 sha 分叉（本地 48 个提交 vs 远端 16 个 API 提交，内容相同仅 CRLF 差异），**2026-11-21 已用 `--no-ff` 合并统一**。以后再遇到「本地领先但不快进」，先 `git diff --ignore-cr-at-eol` 判断是不是纯 EOL 差异，不要直接 force push。`build/push-head.mjs` 是 API 兜底（压成单提交），非必要别用。

## 9. 环境锚点

| 用途 | 路径 |
| --- | --- |
| Node | `C:/Users/phis123/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe` |
| Python | 同目录 `.../python/python.exe` |
| Android SDK | `E:/android-toolchain/android-sdk`（build-tools 34.0.0 / platforms/android-34） |
| JDK | `E:/android-toolchain/jdk/jdk-17.0.20.1+1` |
| Inno Setup | `E:/android-toolchain/inno/ISCC.exe` |
| keystore | `E:/dsh/work3/keys/music-play-release.jks`（alias `musicplay`） |
| 签名口令 | `E:/dsh/work3/keys/ks-pass.dpapi`（DPAPI）+ `build/ks-pass.{ps1,sh}` |
| 打包源 | `E:/dsh/work3/out/mp45-portable`（Electron 45 整目录 + resources/app） |
| 产物 | `E:/dsh/work3/out/` |
| 平板 | `23046RP50C` Xiaomi Pad 6 Pro / Android 13 / Magisk root / `adb 100.120.69.40:5555` |
| 桌面安装 | `E:/music-play`（AppId 注册表在 `HKCU\...\Uninstall\{2A7F3C51-…}`） |

## 10. 未完成项（都不紧急）

1. **旧口令残留**：明文已从所有脚本清除，但仍存在于两处 DSH 运行时文件（`~/.dsh/dumate-faildump/fail-2026-11-18*.json`、`~/.dsh/storages/session_projcache/sessions/2fd545e5-*.json`）。彻底解决需密钥轮换，代价是老用户无法覆盖升级，故未做
2. **assets 守门覆盖范围**：`verify-assets` 的 `SYNC_PAIRS` 现已守住 `lib/random.js` 与 `lib/lrc.js` 两对；`renderer/js/app.js` ↔ `assets/js/mobile.js` 因壳层差异暂不可逐字节守
3. **CI 不出正式签名包**：配好 `APK_KEYSTORE`(base64) / `APK_KS_PASS` / `APK_KS_ALIAS` 三个 secrets 即可
4. **真机验收待办**：`v1.0.12` APK 已出包，待在小米平板 6 Pro 与手机上完成安装、歌词解析、深浅色 UI、横竖屏布局及下载/换源验收后再决定是否正式打 `v1.0.12` tag 发布
5. **自动化覆盖扩面**：目前 101 用例已覆盖 `lib/`、`netapi.js`、`verify-assets` 及 Android 架构/安全守门；`main/` 与渲染层交互测试可按需继续补齐

## 11. 文档地图

| 文件 | 内容 |
| --- | --- |
| `.agent/STATE.md` | **唯一调度记忆**：内核规则、架构不变量、契约、DAG、阻塞项。改完大块工作要原地覆盖 |
| `docs/HANDOVER.md` | 本文，接手入口 |
| `docs/PROJECT-MEMORY.md` | 人读项目记忆（历史决策与踩坑） |
| `docs/BUILD.md` | 构建细节、aapt2 反斜杠坑、签名口令保管 |
| `docs/DIAG.md` | 诊断导出体系 |
| `docs/REFACTOR-PLAN.md` / `ROADMAP.md` / `ELECTRON-UPGRADE-PLAN.md` | 阶段计划与历史路线 |
| `out/main-split-report.md` | 阶段4 拆分映射表（878 行 main.js 怎么变成 5 个模块） |
| `out/test-ci-report.md` | 测试与 CI 收口报告（含守门红→绿证据） |
| `out/t4-loudness-report.md` | 音量平衡实测（LoudnessEnhancer + 桌面电平） |
| `out/integration-report.md` | 两条分支合入的冲突解决记录 |

## 12. 上手三步

```bash
# 1. 确认基线
cd E:/dsh/work3/mp && git log --oneline -1 && node --test | tail -3

# 2. 跑一次桌面（首次需先 npm ci，或直接用 out/mp45-portable 运行时）
npm ci && node_modules/.bin/electron .        # 或用 out/mp45-portable 的运行时指向本目录

# 3. 改完代码过质量门，再决定要不要出包
node --test && node tools/lint-syntax.mjs && node tools/verify-assets.mjs
```

改代码时最该记住的一条：**这个项目的历史 bug 几乎都不是"写不出来"，而是"两个团队各自以为对"**——IPC 授权、滚动判据、路径校验、版本三处同步，四个地方都曾因为「另一侧会处理」而出过事。改动触及这几处时，先看 `.agent/STATE.md` 的红线，再动手。