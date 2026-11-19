# 构建与发布

## Android APK

```bash
# versionName/versionCode 可省略：默认取 package.json，versionCode 由 semver 推导（1.0.7 -> 107）
APK_KEYSTORE=/path/rel.jks APK_KS_PASS=*** APK_KS_ALIAS=musicplay \
  node tools/build-apk.mjs . out/music-play-1.0.7.apk

# 显式指定版本时注意 versionCode 必须大于已安装版本，否则真机报 INSTALL_FAILED_VERSION_DOWNGRADE
node tools/build-apk.mjs . out/x.apk 1.0.8 108
```

依赖（可用环境变量覆盖默认路径）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ANDROID_SDK_ROOT` | `E:/android-toolchain/android-sdk` | 需含 `build-tools/34.0.0` 与 `platforms/android-34` |
| `JAVA_HOME` | `E:/android-toolchain/jdk/jdk-17.0.20.1+1` | JDK 17 |
| `APK_KEYSTORE` / `APK_KS_PASS` / `APK_KS_ALIAS` | **无默认值，必须显式设置** | 签名用；口令不提供默认值（避免进入仓库历史），脚本改用 `--ks-pass env:` 传参以免出现在进程命令行。密钥请自行备份，丢失后无法再出可覆盖升级的同签包 |
| `APK_WORK_DIR` | `.apk-work` | 中间产物目录 |

### ⚠️ 构建陷阱：aapt2 在 Windows 上会把子目录资产写成反斜杠

`aapt2 link -A <assets>` 在 Windows 下会把子目录里的资产条目名写成 `assets/css\mobile.css`（反斜杠）。
APK 能装能开，但 WebView 按 `css/mobile.css` 找不到文件 → **CSS 与 JS 全部 404，界面变成纯 HTML 裸样式**（表现为整页没有样式、图标巨大、桌面侧栏与手机底栏同时出现）。

因此本脚本**不使用 `-A`**，而是：

1. `aapt2 link` 只产出资源（`resources.arsc` 必须保持 STORED）；
2. 用 Python `zipfile` 重新打包，把 `assets/**` 与 `classes.dex` 以**正斜杠**路径写入；
3. 打包后自动校验：任何条目名含 `\` 或缺少 `assets/index.html` / `assets/css/mobile.css` / `assets/js/mobile.js` / `assets/js/neta.js` / `classes.dex` / `resources.arsc` 直接失败；
4. `zipalign -p 4` + `apksigner` 签名，签名后再校验一次。

> 历史教训：v1.0.0 首次发布就因为漏了这一步，APK 装上去整页无样式；修复后已重新发布。

## Windows 安装包（Inno Setup）

1. 准备「应用目录副本」：`E:\music-play` 的运行时文件 + `resources\app`，**必须排除 `resources\` 下的用户曲库**（否则安装包会超过 4GB，Inno 直接报 `Disk spanning must be enabled`）。
2. 改 `tools/music-play.iss` 里的 `#define SourceDir` 指向该副本，然后：

```bash
"<Inno Setup 目录>/ISCC.exe" tools/music-play.iss
```

3. 产物在 `out/music-play-Setup-<version>.exe`。建议装到临时目录做一次静默安装冒烟测试：

```bash
music-play-Setup-1.0.0.exe /VERYSILENT /SUPPRESSMSGBOXES /TASKS= /NOICONS /DIR=<临时目录>
```

## 诊断日志（偶发问题 / 机型适配）

App 内置诊断采集，**用户无需 root、无需连电脑**：

- 设置 → 《设置》页 → 「🧾 诊断与日志导出」→「📦 导出诊断包」，生成
  `Android/data/com.phis.musicplay/files/diag/export-<时间>.zip`，内含：
  `session.log`（运行日志）、`crash-*.txt`（崩溃堆栈）、`snapshot.txt`
  （机型/屏幕/WebView/权限/存储/电量/播放状态）、`library.json`（曲库摘要，不含音频）、
  `logcat.txt`（本进程日志尾部）、`state.json`（前端设置与队列摘要）。
- 维护者也可**不动界面**触发：
  `adb shell am broadcast -n com.phis.musicplay/.DiagReceiver -a com.phis.musicplay.DIAG_EXPORT`
  （必须带 `-n`：Android 8+ 不接受隐式广播到 manifest receiver）。

## 桌面端 Electron 版本与打包（v1.0.9 起为 45.2.1）

- 31.7.7 已于 2025-01-14 EOL，v1.0.9 起升到 **45.2.1**（Chromium 156 / Node 24.22）。
- **打包方式必须整目录复制 dist**：45 的 dist **不再包含 `libEGL.dll` / `libGLESv2.dll`**（ANGLE 静态链接进二进制），也没有 Windows ia32 预编译。按文件名清单复制会缺文件导致启动失败。
- 便携包结构：`music-play.exe`（启动器 stub）+ `music-play-core.exe`（= dist/electron.exe 改名）+ `resources/app/`（应用代码，含 `node_modules`）+ dist 其余文件整目录。
- 45 与 31 的差异：新增 `dxcompiler.dll`、`electron_wer.dll`、`version`；`LICENSE.electron.txt` 改名为 `LICENSE`；dist 内 `resources/default_app.asar` 存在但**不要**覆盖 `resources/app`。
- 前置约束：Electron 45 的渲染层 preload 不再提供 `Buffer`/`timers`/`url` shim，**preload 里禁止使用这些**（当前 `preload.js` 只用 `require('electron')`，符合）。
- 发布前必测：主窗启动、播放出声、悬浮歌词 + 鼠标穿透（Win32 侧可校验 `WS_EX_TRANSPARENT`）、托盘菜单、SMTC/媒体键、WebAudio 音量平衡、IPC 全通道。

## 发布

1. `git tag -a vX.Y.Z -m "..."` 并推送（`test` / `build` 两个工作流会跑单测与源码归档）；
2. 在 GitHub Release 上传 `music-play-Setup-X.Y.Z.exe`、`music-play-X.Y.Z.apk`、`music-play-src-X.Y.Z.zip`；
3. 在 Release 说明里附上是三个产物的 SHA-256。
