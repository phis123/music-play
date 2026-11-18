# 构建与发布

## Android APK

```bash
node tools/build-apk.mjs <repoRoot> <outApk> <versionName> <versionCode>
# 例：
node tools/build-apk.mjs . out/music-play-1.0.0.apk 1.0.0 100
```

依赖（可用环境变量覆盖默认路径）：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `ANDROID_SDK_ROOT` | `E:/android-toolchain/android-sdk` | 需含 `build-tools/34.0.0` 与 `platforms/android-34` |
| `JAVA_HOME` | `E:/android-toolchain/jdk/jdk-17.0.20.1+1` | JDK 17 |
| `APK_KEYSTORE` / `APK_KS_PASS` / `APK_KS_ALIAS` | 本地发布密钥 | 签名用；密钥请自行备份，丢失后无法再出可覆盖升级的同签包 |
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

## 发布

1. `git tag -a vX.Y.Z -m "..."` 并推送（`test` / `build` 两个工作流会跑单测与源码归档）；
2. 在 GitHub Release 上传 `music-play-Setup-X.Y.Z.exe`、`music-play-X.Y.Z.apk`、`music-play-src-X.Y.Z.zip`；
3. 在 Release 说明里附上是三个产物的 SHA-256。
