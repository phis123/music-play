# music-play · 项目记忆 / 交接文档

> 最后更新：2026-11-19 12:50（v1.0.10）
> 用途：新会话/新 Agent 接手时先读本文件；避免重复摸索与踩已知坑。

---

## 一、基本坐标

| 项 | 值 |
|---|---|
| 仓库 | https://github.com/phis123/music-play （默认分支 `main`，v1.0.10 = `67d1ab5`） |
| 本地克隆 | `E:\dsh\work3\mp` |
| 产物目录 | `E:\dsh\work3\out`（APK / Setup.exe / src.zip / 报告） |
| 打包脚本 | `mp/tools/build-apk.mjs`、`mp/tools/music-play.iss`、`E:\dsh\work3\build\build-setup*.mjs`、`E:\dsh\work3\build\push-head.mjs`（API 推送兜底） |
| Windows 安装目录 | `E:\music-play`（内含用户曲库 `resources\*.mp3`，**打包时必须排除**） |
| 平板（测试机） | 小米平板 6 Pro `23046RP50C`，Android 13，Magisk root，adb：`100.120.69.40:5555`（Tailscale，零弹窗） |
| 手机（用户自己的） | 荣耀 WIN RT，Tailscale `100.98.137.42` |

### 关键环境变量（打包必填）

```bash
export APK_KEYSTORE=E:/dsh/work3/keys/music-play-release.jks
export APK_KS_PASS=<见本机密码记录，不入库>
export APK_KS_ALIAS=musicplay
```
> 密钥与口令**绝不入库**；`.gitignore` 已忽略 `*.jks/*.keystore`。

### 常用命令

```bash
cd E:/dsh/work3/mp
node --test                                   # 56 项单测
export APK_KEYSTORE=... APK_KS_PASS=... APK_KS_ALIAS=musicplay
node tools/build-apk.mjs . ../out/music-play-X.Y.Z.apk   # 版本自动取 package.json + Manifest
node E:/dsh/work3/build/build-setup.mjs       # 打 Windows Setup（排除曲库）
node E:/dsh/work3/build/push-head.mjs         # git push 被 reset 时用 API 推
```

### 真机（平板）操作约束

- **可以操作前台**（用户已授权）；但装包后首次启动会弹权限框，需 `input tap` 选择「始终允许」。
- 静默安装：`adb shell su -c "pm install -r /data/local/tmp/mp.apk"`（root 免确认框）。
- 诊断取证（不动 UI）：`adb shell am broadcast -n com.phis.musicplay/.DiagReceiver -a com.phis.musicplay.DIAG_EXPORT`，包在 `Android/data/com.phis.musicplay/files/diag/export-*.zip`（**必须带 `-n`**）。
- 平板无密码，`input swipe 675 1900 675 400 250` 可解锁。

---

## 二、架构现状（v1.0.8）

### Android 原生
```
PlaybackService.java   壳：MediaSession / 通知 / 音频焦点 / WakeLock / 回推网页
PlayerEngine.java      ★ 唯一持有 MediaPlayer，专属 HandlerThread 串行执行
Bridge.java            58 个 @JavascriptInterface（播放/曲库/歌词/悬浮词/诊断）
AudioStore.java        MediaStore + 磁盘 + 内嵌 ID3 兜底；标签缓存原子写（纳秒 mtime）
LyricsOverlay.java     悬浮词（全主线程 + 尊重 locked）
Diag.java / DiagReceiver.java  诊断：会话日志、崩溃捕获、环境快照、zip 导出、广播触发
MainActivity.java      WebView 宿主 + 权限申请 + dev 资源覆盖钩子（未验证可用）
```

### Android 前端（v1.0.9 已模块化）
`assets/js/mobile.js` = **82 行入口**；模块在 `core/ library/ player/ views/` + `diag.js` + `native-callbacks.js` + `events.js`。
零构建：`<script>` + `window.MP`（`MP.state` 即原 `S`，`MP.bus` 事件总线）。加载顺序 core→library→player(random.js 先于 queue.js)→views→回调→入口。

### Electron 桌面（v1.0.9 起 Electron 45.2.1）
`main.js`（约 840 行）+ `preload.js` + `renderer/js/app.js`（约 3900 行）。**阶段 4 待拆分**。Electron 45 打包必须整目录复制 dist（无 libEGL/libGLESv2）。
打包是**自建便携包**：`music-play.exe`（启动器）+ `music-play-core.exe`（改名 electron.exe）+ `resources/app`。

---

## 三、已修复的关键 Bug（避免重犯）

| Bug | 根因 | 位置 |
|---|---|---|
| 整页无样式（v1.0.0） | aapt2 在 Windows 把子目录资产写成 `assets/css\mobile.css`；WebView 按正斜杠找不到 | `tools/build-apk.mjs` 改为自建 zip |
| 封面/歌手全掉 | 磁盘兜底不读 ID3；媒体库不可用时整库变「未知艺人」 | `AudioStore` 内嵌标签兜底 + 标签缓存 |
| 一键补齐只跑 60 首 | `slice(0, manual ? 60 : 12)` 写死 | `mobile.js` 改 Infinity |
| 试听暂停后无法恢复 | ① `_restoredNeedsPlay` 劫持成"重播本地歌" ② `requestAudioFocus` 抖动触发 `pause()` ③ 错误被静默吞 | `mobile.js` + `PlaybackService` |
| 试听时显示上一首封面歌手 | 三处 `A.preview()` 只改图标不改标题/封面 | `enterPreviewMode()` + `previewEx` |
| 调节悬浮词字号/底色闪退 | View 在 JavaBridge 线程创建、样式在主线程改 | `LyricsOverlay` 全量 `runOnUi` |
| MediaPlayer 跨线程 | JS 桥/主线程/reopen 线程并发操作 | **`PlayerEngine` 单线程（v1.0.8）** |
| 歌词自动跟随失效（v1.0.8 回归） | scroll 监听用 120ms 定时器清「程序滚动」标志，而 smooth 滚动持续 200~400ms → 自己的 scroll 被当成用户滚动，每句刷新时间戳 → 永久不跟随 | `scrollLyricsTo()` + 800ms 时间窗 + `scrollend`（v1.0.10） |
| 「回到当前句」胶囊看不到 | 放在 `overflow-y:auto` 的 `.lp-right` 内，absolute 随内容滚走 | 移到 `.lp-body` + z-index（v1.0.10） |

---

## 四、待办与优先级

| 优先级 | 任务 | 备注 |
|---|---|---|
| ✅ 已完成 v1.0.8 | 播放内核单线程化 + P0/P1/P2 修复 | APK/Setup 已发 |
| ✅ 已完成 v1.0.9 | 前端模块化（28 模块）+ Electron 45.2.1 + CI 加固（68 单测） | APK/Setup 已发 |
| ✅ 已完成 v1.0.10 | 修歌词自动跟随回归 + 胶囊定位 | APK/Setup 已发 |
| P1 | 阶段 4：Electron 主进程/渲染层拆分 | `ipc-registry` 统一注册+校验 |
| P2 | APK 构建进 CI | 需要容器内 aapt2/jdk |
| P2 | 下载内容哈希校验 | 目前只有 Content-Length |
| P2 | 下载内容哈希校验 | 目前只有 Content-Length |
| P2 | 大曲库扫描单测 | 需先把扫描逻辑下沉到 `lib/library-scan.js` |
| P2 | 沙箱冒烟 | 自动化一直在 `no-sandbox` 下跑（`DSH_SESSION_ID` 存在） |

---

## 五、回滚策略（重要）

1. **发版前打锚点 tag**：`v1.0.9`，模块化前锚点 `rollback/pre-modularize-1.0.8`。Electron 回滚=重装 `Setup-1.0.8.exe`。
2. **每个重构阶段单独分支**：`chore/electron-upgrade`、`refactor/mobile-modules`、`refactor/electron-modules`。
3. **不直接改 main**：用仓库副本（`E:\dsh\work3\branches\<name>`）做实验，产出 patch + 报告，我核验后再合并。
4. 合并顺序：单测 → 真机冒烟 → 推送；任何一步失败 `git revert` 单个提交即可（每阶段一个提交）。
5. 二进制产物回滚：`E:\music-play` 保留上一版 Setup 安装包（`out/music-play-Setup-<上一版>.exe`）。

---

## 六、已知坑（别再踩）

1. **git push 经常被 reset** → 用 `build/push-head.mjs`（GitHub API）推送；tag 也要用 API 建。
2. **bash heredoc 传 Python 时 `\n` / `\\` 会被吃** → 涉及转义优先用 `write` 工具写脚本文件，再用 shell 执行。
3. **`aapt2 -A` 资产反斜杠** → 构建脚本已自建 zip，勿改回 `-A`。
4. **MSYS 路径转换**：`adb push/pull` 本地路径要写 `E:/...` 或加 `MSYS_NO_PATHCONV=1`。
5. **`adb exec-out screencap` 会产出坏 PNG** → 先 `shell screencap -p /sdcard/x.png` 再 `pull`。
6. **打包 Setup 必须排除 `E:\music-play\resources\*.mp3`**（8.9GB 曲库，否则 Inno 报 4GB 上限）。
7. **安装签名**：v1.0.x 同签名可覆盖；b73 等旧测试包签名不同需先卸载。
8. **`inject` 式热更新无效**：`shouldInterceptRequest` 对 `file://` 资产不生效（实测），改前端仍需装包或 dev 目录方案（未验证）。
9. **区分「程序滚动」与「用户滚动」不要用短定时器清标志**：`scrollTo({behavior:'smooth'})` 是异步的（Chromium 200~400ms），期间 scroll 事件持续触发。曾经用 `setTimeout(120)` 清标志，导致自动跟随自己触发的 scroll 被当成用户滚动 → 跟随永久失效（v1.0.8 引入、v1.0.10 修复）。正确做法：记录「程序滚动调用时刻」+ 时间窗（≥800ms）判定，并用 `scrollend` 提前收尾。
10. **`position:absolute` 提示层不要放在滚动容器里**：`.lp-right` 是 `overflow-y:auto`，放在里面的 `#lpResume` 胶囊会随歌词滚走（用户几乎看不到）。应挂到 `position:relative` 的非滚动祖先（`.lp-body`）。

---

## 七、外部审计结论（docs/AUDIT-TRIAGE.md）

- 误报：沙箱全局关闭、默认目录硬编码
- 已修复：IPC 路径校验、扫描并发、下载校验、bootPromise 重置
- 确认为真：Electron 31 EOL、测试覆盖缺口（已补 4 项 → 56 项）
- 潜在：下载无内容哈希、断链 symlink 读/删边界、沙箱冒烟盲区