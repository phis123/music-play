# 外部审计问题清单 · 逐项核实报告

> 被审版本：`music-play v0.4.3`（审计文档基线）
> 核实版本：`main` @ v1.0.8（`PlayerEngine` 单线程化之后）
> 结论口径：**确认**（当前代码仍存在）/ **已修复**（后续版本已处理）/ **误报**（基线描述与当前代码不符）/ **潜在**（有风险但需特定条件）

---

## 一、P0 安全

### P0-1｜Electron 沙箱配置 —— **误报（当前版本已改为条件启用）**

- 审计基线：`main.js` 第 6–7 行「全局启用 no-sandbox 与 disable-gpu-sandbox」
- 当前代码：`main.js:8-13`

```js
// 仅在受限沙箱环境（DSH_SESSION_ID 或显式 ELECTRON_NO_SANDBOX=1）下追加 no-sandbox 兜底，
// 常规桌面环境保持 Chromium 沙箱开启。
if (process.env.DSH_SESSION_ID || process.env.ELECTRON_NO_SANDBOX === '1') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}
```

- 结论：普通用户双击启动时 **不带** 这两个开关，Chromium 沙箱正常开启。
- 但有一个**测试盲区**（潜在）：自动化验证是在 DSH 会话里跑的，`DSH_SESSION_ID` 恒存在 → 我们自己的冒烟测试**始终在无沙箱状态下运行**，无法发现"开沙箱后才出现的问题"。
- 建议（已列入待办）：冒烟脚本显式 `unset DSH_SESSION_ID` 或加 `ELECTRON_FORCE_SANDBOX=1` 跑一遍。
- `BrowserWindow` 配置核实：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`（`main.js` 创建窗口处），与审计要求一致。

### P0-2｜IPC 文件路径安全 —— **已修复（全部通道已覆盖）**

审计点名的 5 个接口逐一核实（当前行号）：

| 接口 | 位置 | 路径校验 |
|---|---|---|
| `lib:delete` | `main.js:608` | `verifyIpc` + `assertInsideLibrary` + 派生文件 `isInsideLibrary` 复核 + 回收站失败回传 |
| `lib:fav` | `main.js:543` | `verifyIpc` + `assertInsideLibrary(src)` + **收藏目录库内校验 + `assertSafeWriteTarget(dst/dstLrc)`**（v1.0.7 补） |
| `lib:coverFix` | `main.js:575` | `verifyIpc` + 目标 `.jpg` 全部走 `assertSafeWriteTarget` |
| `lyrics:get` / `cover:get` | `main.js:375 / 428` | `verifyIpc` + `assertInsideLibrary`，越界一律按"无此文件"返回 |
| `audio:gain` | `main.js:466` | `verifyIpc` + `assertInsideLibrary` |
| `net:download` / `net:replaceSource` | `main.js:524 / 530` | `validateDownloadPayload` / `validateReplaceSourcePayload`（禁止透传 overwritePath/targetPath） |
| `library:scan` | `main.js:262` | **v1.0.7 起** `dir` 必须在已授权集合内，新目录只能经 `dialog:pickFolder` |
| `dialog:pickFolder` | `main.js:458` | 用户显式选择后 `authorizeDir` |

- 审计建议的"统一验证函数 + path.resolve/relative + 符号链接/大小写边界"→ 已在 `lib/path-guard.js` 实现（`assertInsideLibrary` / `assertSafeWriteTarget` / `isInsideLibrary`），并有 12 项单测覆盖（含 symlink、`..`、Windows 盘符大小写变体）。
- **新发现的细节（本次核实并加测试）**：`assertInsideLibrary` 对"指向库外但目标不存在的断链 symlink"会退化为看起来在库内（`realpath` 失败回退到 `path.resolve`）。
  - 影响面小：读操作打不开文件；删除只会删链接本身；**写路径**由 `assertSafeWriteTarget` 明确拒绝断链 symlink。
  - 处理：已在 `test/robustness.test.js` 补用例说明该边界（真实存在的库外目标必须被拒）。

---

## 二、P1 可靠性与性能

### P1-1｜默认音乐目录硬编码开发路径 —— **误报（当前版本）**

- 当前代码：`main.js:161-162`
```js
const DEFAULT_ROOT = process.env.MUSIC_ROOT ||
  (app && typeof app.getPath === 'function' ? app.getPath('music') : path.join(require('os').homedir(), 'Music'))
```
- 已无任何 `E:\dsh\...` 开发路径；且 `loadUserConfig()` 保留用户配置，升级不丢曲库。
- 补充：v1.0.0 起增加了"若配置目录没有音频而程序旁 resources 有歌则自动切回"的兜底，避免首次启动空库。

### P1-2｜曲库扫描串行性能 —— **已修复**

- 当前实现：`SCAN_CONCURRENCY = 4` 的有限并发队列（`runLimited`，手写、不用 Promise.all）+ `scan-cache.json` 增量缓存（`size + mtimeMs` 命中直接跳过解析）+ `library:scan-progress` 进度推送 + 取消 + **v1.0.8 起扫描代际号**（重叠扫描不再互相清取消标志/覆盖缓存）。
- 实测：本机 738 首、平板 674 首都能在秒级出结果；单文件解析失败只跳过该文件并计入进度，不中断整批。

### P1-3｜下载逻辑可靠性 —— **基本已修复，留一项潜在**

| 审计要求 | 现状 |
|---|---|
| 文件大小限制 | ✅ `netapi.js:313 MAX_DOWNLOAD_BYTES = 200MB`，超限中止 |
| 校验状态码与响应类型 | ✅ 拒绝 `text/html` / `application/json`（错误页不落盘为媒体文件） |
| 失败清理临时文件 | ✅ `.downloading` 临时文件；9 项单测覆盖「500/404/截断/中途断开/不残留半截」 |
| 覆盖前校验目标路径 | ✅ `validateReplaceSourcePayload` |
| 并发冲突 | ✅ 单文件顺序下载，临时文件名带唯一后缀 |
| 完整性校验 | ⚠ **潜在**：仅校验 `Content-Length` 与实际字节数，**无内容哈希**。若 CDN 返回长度一致但内容错误，无法识别。建议后续加 `Content-MD5`/首帧探测（优先级低） |

### P1-4｜网易云 API 启动失败重试 —— **已修复**

- `netapi.js:37 BOOT_MAX_RETRIES = 2`（最多 3 次尝试）、`:32 BOOT_MAX_PORT_TRIES = 100`（端口探测上限，避免无限重试）
- `bootPromise` 失败后重置：有专门单测 `test/ensure-server.test.js`（"启动失败后 bootPromise 被重置"）

### P1-5（补充）｜Electron 版本已 EOL —— **确认，需升级（P2，见下）**

---

## 三、P2 维护性与兼容性

### P2-1｜Electron 31.7.7 维护状态 —— **确认：已 EOL**

- 官方支持策略是最新 3 个稳定大版本；[Electron 31 的 EOL 是 2025-01-14](https://releases.electronjs.org/schedule)，当前（2026-11）仍在支持的是 **44 / 45**（46 处于 beta/alpha）。
- 风险：Chromium 126 → 150 之间的安全修复拿不到；项目要联网跑网易云接口，属真实风险。
- **不建议盲升**。升级方案建议（与审计要求一致：先制定兼容性验证方案）：

| 步骤 | 内容 | 验收 |
|---|---|---|
| 1 | 分支 `chore/electron-45`，`devDependencies.electron` 升到 45.x（保守选 44.x 亦可） | `npm start` 能起窗口 |
| 2 | 重跑打包链路（本项目是**自建**便携包：`music-play.exe` 启动器 + `music-play-core.exe` = 改名 electron.exe + `resources/app`） | `Setup.exe` 安装后能启动 |
| 3 | 兼容性清单逐项验证 | ① 无边框窗口/标题栏拖拽 ② **透明悬浮歌词 + 鼠标穿透**（`setIgnoreMouseEvents(forward)`）③ `MediaSession` 全局快捷键 ④ `contextBridge` 全部 IPC ⑤ 托盘菜单 ⑥ `<audio>` + **WebAudio 音量平衡图** ⑦ CSP 下页面正常 |
| 4 | 回归 52+ 单测与桌面冒烟 | `node --test` 全绿 + 设置页/歌词页可打开 |
| 5 | 灰度 | 保留 31 版本安装包一个版本，出问题可回滚 |

- 额外注意：Electron 44 起砍了 Windows ia32 预编译、移除渲染层 `clipboard`；本项目仅 x64 且未用 `clipboard`，影响可控。

### P2-2｜自动化测试覆盖 —— **部分已补，仍有缺口（本次新增 4 项）**

本次新增 `test/robustness.test.js`（4 项，全部通过）：

| 审计要求 | 覆盖情况 |
|---|---|
| 非法路径 / 路径穿越 | ✅ 已有（12 项）+ 本次补「断链 symlink 边界」说明 |
| 删除 / 覆盖权限 | ✅ 已有（`assertSafeWriteTarget` 断链 symlink 拒绝、`lib:delete` 派生文件复核） |
| 损坏音频文件 | ✅ **本次新增**：空文件/3 字节/全 0xAB/纯文本伪 mp3 → 响度测算不抛且限幅 |
| 无歌词 / 错误 LRC / 时间戳异常 | ✅ 已有 + **本次新增**：越界秒、非数字时间戳、三时间戳展开、空正文、乱序排序 |
| 下载中断 / 重复下载 | ✅ 已有（9 项 HTTP 边界用例） |
| API 启动失败与重试 | ✅ 已有 |
| 大型曲库扫描 | ⚠ 未覆盖（扫描主逻辑在 `main.js` 内，需先下沉到 `lib/library-scan.js` 才能单测；已列入阶段 2） |
| Android 后台播放与生命周期 | ⚠ 未覆盖（需真机/instrumentation；目前靠诊断导出 + 平板手工回归） |

- 当前总计 **56 项**（原 52 + 新增 4）。

---

## 四、修改文件清单（本次核实顺带完成的改动）

| 文件 | 原因 |
|---|---|
| `test/robustness.test.js` | 新增 4 项健壮性回归（损坏音频 / 异常 LRC / 路径边界 / 增益限幅） |
| `test/lrc.test.js` | 修正被固化的旧行为基线（多时间戳展开、毫秒三位精确） |
| `lib/lrc.js` | 审计「时间戳异常」项对应的真实缺陷修复 |
| `main.js` | `library:scan` 授权校验、扫描代际、`float:resize` 校验、`loadFile`/`whenReady` 兜底 |
| `android/.../PlayerEngine.java`（新增）、`PlaybackService.java` | 审计未覆盖但更严重的 P0：MediaPlayer 跨线程 |
| `docs/REFACTOR-PLAN.md` | 解耦方案（交外部审计） |

## 五、测试命令与结果

```bash
cd E:/dsh/work3/mp
node --test          # 56 tests / 56 pass / 0 fail
```

真机（小米平板 6 Pro / Android 13）：
- 播放 `state=3`，`engine prepared dur=160`；暂停 `state=2` pos=5155 保留；恢复 `state=3` pos 继续增长
- 诊断导出（设置页 + 广播两条路径）均可用

## 六、尚未解决 / 风险

1. **Electron 31 EOL** —— 需按上表升级，未做（避免未验证直接升级）。
2. **下载无内容哈希校验** —— 仅长度校验（低优先级）。
3. **大型曲库扫描 / Android 生命周期无自动化测试** —— 依赖架构下沉（阶段 2）与真机回归。
4. **断链 symlink 的读/删边界** —— 写路径已挡，读/删影响可忽略，已在测试中标注。
5. 沙箱冒烟盲区 —— 自动化测试一直在 `no-sandbox` 下跑，需补一次开沙箱冒烟。