# music-play · 剩余问题处理与解耦方案

> 版本基线：v1.0.7（`501a311`）
> 目标：① 处理代码审查剩余问题；② 把「播放 / 曲库 / UI / 诊断」解耦，降低后续维护成本。
> 原则：**每阶段独立可发布、可回滚**，不追求一次性大重构。

---

## 一、现状：耦合点量化

| 文件 | 行数 | 问题 |
|---|---|---|
| `android/.../PlaybackService.java` | ~600 | 播放器 + 音频焦点 + 通知 + MediaSession + 封面解码 + WakeLock + JS 回调 全在一个类 |
| `android/.../Bridge.java` | ~880 | 58 个 `@JavascriptInterface`，播放/曲库/歌词/悬浮词/诊断/路径校验混在一起 |
| `android/assets/js/mobile.js` | ~4700 | 状态、视图、播放、歌词、导入、换源、设置、诊断 全在一个文件 |
| `main.js`（Electron） | ~830 | 窗口 + 曲库扫描 + 下载 + 歌词 + 悬浮窗 + IPC 全在一个文件 |
| `renderer/js/app.js` | ~3900 | 同上（前端侧） |

**直接后果**：改播放要动 `PlaybackService` + `Bridge` + `mobile.js` 三处；任何一处遗漏就是 v1.0.6 那种"点了没反应"。

---

## 二、目标分层

### Android 原生（按职责切 5 个包）

```
com.phis.musicplay
├── player/                 播放内核（唯一持有 MediaPlayer 的地方）
│   ├── PlayerEngine        单 HandlerThread 拥有 MediaPlayer，所有调用 post 到该线程
│   ├── AudioFocusController 申请/放弃配对，preparing 期间挂起处理
│   ├── PlaybackState        playing/preparing/pos/dur/ducked 的单一真相
│   └── SessionController   MediaSession + 通知（只读 PlaybackState）
├── library/                曲库（无播放依赖）
│   ├── AudioLibrary        MediaStore + 磁盘扫描 + 内嵌 ID3 兜底
│   ├── TagCache            path|size|mtime 缓存（原子写、失败不缓存）
│   └── LibraryRoots        授权根集合（含自定义根）
├── overlay/                悬浮词（独立于播放，只订阅文本）
├── diag/                   诊断（只读，不反向依赖任何模块）
└── bridge/                 JS 门面（薄，只做参数校验 + 转发）
    ├── PlaybackBridge  LibraryBridge  OverlayBridge  DiagBridge
```

**关键约束**：`Bridge` 拆成 4 个门面后，**JS 侧的 `window.Android` 接口名保持不变**（门面注册到同一个对象），所以前端零改动、可灰度。

### Android 前端（无打包器，用 script 标签 + 命名空间）

```
assets/js/
├── core/  state.js  store.js(本地持久化)  bus.js(事件总线)  dom.js
├── player/  playback.js(状态机)  queue.js(三种随机)  lyrics-sync.js
├── library/  scan.js  covers.js(LRU)  enrich.js
├── views/  home.js  local.js  nowplaying.js  settings.js  import.js  health.js
├── diag.js
└── app.js   （入口：装配 + 路由）
```
用 `window.MP = {}` 命名空间挂载，避免全局函数互相踩；引入顺序固定在 `index.html`。

### Electron

```
main/
├── windows.js（主窗+悬浮窗）  ipc-registry.js（统一注册+校验）
├── library/（scan, tagcache, path-guard 已在 lib/）
├── net/（下载、歌词、换源）
└── diag.js
renderer/js/  （改 ESM：import/export，按 core/player/views 分层）
```

---

## 三、剩余问题清单 → 归属阶段

### P0（会崩 / 线程不安全）

| # | 问题 | 位置 | 处理 |
|---|---|---|---|
| 1 | MediaPlayer 跨线程（JS 桥、主线程 ticker、reopen 线程都在调） | `PlaybackService` 全类 | 阶段 1：`PlayerEngine` 单线程串行化；所有 `Bridge` 播放方法改为 `engine.post{}` |
| 2 | 服务未就绪时无条件 `startForegroundService`，Android 12+ 后台可能直接崩 | `Bridge.svc()` / `PlaybackService.start` | 阶段 1：try/catch + 后台只复用已有实例 + `onPlayerError(-2)` |
| 3 | `coverCache` 无上限（Bitmap），通知构建时同步解码 | `PlaybackService` | 阶段 1：`LruCache` + 异步解码 + 尺寸限制 |

### P1（功能错误 / 数据错乱）

| # | 问题 | 位置 | 处理 |
|---|---|---|---|
| 4 | 音频焦点申请/放弃不配对；preparing 期间 Loss 被丢弃后不补发 | `PlaybackService.requestFocus/onFocusChange` | 阶段 1 的 `AudioFocusController`（pendingLoss 在 finally 处理） |
| 5 | `instance`/`pending` 非 volatile，pending 单槽会覆盖 | `PlaybackService` | 阶段 1：命令队列 + 代际校验 |
| 6 | WakeLock 只 acquire 不 release，45 分钟到期不续 | `PlaybackService.setBgTaskState` | 阶段 1：`WakeLockController`（onDestroy/active=false 释放） |
| 7 | `isInsideAllowedRoot` 漏自定义曲库根 | `Bridge` | 阶段 2：`LibraryRoots` 统一提供（canonical `Path.startsWith` 分段比较） |
| 8 | `removeFile` 可删 `Music/` 下任意文件 | `Bridge.removeFile` | 阶段 2：限曲库条目 + 扩展名白名单 + MediaStore 失败回传 |
| 9 | Activity 销毁未注销 listener → WebView 泄漏；API33+ 未申请通知权限 | `MainActivity` / `Bridge` | 阶段 2 |
| 10 | 标签缓存非原子写、失败也缓存、mtime 秒级碰撞 | `AudioStore` | 阶段 2：临时文件 + rename，失败不写，键加纳秒 |
| 11 | `meta:` localStorage 无淘汰，`metaByBase` O(n×m) | `mobile.js` | 阶段 3：改单一索引表 + 配额告警 |
| 12 | 渲染层 `esc()` 不转单引号（CSS 上下文注入面） | `app.js` | 阶段 0 快修 |
| 13 | 歌词滚动只响应 wheel/touchmove，滚动条/键盘不生效 | `app.js` | 阶段 3 |
| 14 | LRC 只解析首个时间戳；三位毫秒截断为两位 | `lib/lrc.js` | 阶段 0 快修 + 测试改基线 |
| 15 | 扫描全局状态（并发扫描互相清 cancel 标志、缓存覆盖） | `main.js` | 阶段 4 |
| 16 | `loadFile` / `whenReady` 未 catch | `main.js` | 阶段 0 快修 |
| 17 | `float:resize` 不校验 h | `main.js` | 阶段 0 快修 |
| 18 | 测试三处假绿（ensure-server 依赖缺失、随机策略自实现、CI 不装依赖） | `test/` + CI | 阶段 5 |

### P2（清理项）
`mobile.css:259` 字面 `\n`、`#npLock/#npOffset` 死代码、`neta.js` 重复 `songDetail`、同步 `httpPost` 阻塞 JS 线程、静默 catch 补 `diagLog`。

---

## 四、分阶段计划（每阶段可独立发版）

### 阶段 0 · 快修（0.5 天，无架构改动）
- LRC 多时间戳 + 毫秒精度（改 `lib/lrc.js` 与测试基线）
- `esc()` 转单引号；`float:resize` 数值校验；`loadFile`/`whenReady` catch
- 清理死代码（`#npLock/#npOffset` 或补齐、CSS 字面 `\n`、`neta.js` 重复 `songDetail`）
- 静默 catch 统一改为 `diagLog(...)`（有了诊断导出，兜底日志零成本）
- **验收**：`node --test` 全绿 + 平板诊断包无新增 error

### 阶段 1 · 播放内核解耦（1.5 天，风险最高，单独发版）
- 新增 `player/PlayerEngine`（单 HandlerThread）+ `AudioFocusController` + `WakeLockController` + `SessionController`
- `PlaybackService` 退化为"壳"：只转发 `onStartCommand` → `engine`
- `Bridge` 播放方法改 `engine.post{}`，接口签名不变（前端零改动）
- 顺带修 P0-2/P0-3、P1-4/5/6
- **验收**（真机，用诊断导出取证）：试听/暂停/恢复 ×10、seek、切歌、来电打断（`adb shell cmd telecom` / 手动）、后台 10 分钟播放、锁屏悬浮词；`session.log` 无 `IllegalStateException`

### 阶段 2 · 曲库与门面拆分（1 天）
- `library/AudioLibrary + TagCache + LibraryRoots`；`Bridge` 拆 4 个门面
- 修 P1-7/8/9/10
- **验收**：自定义曲库根下歌词/封面/删除/均衡全部生效；删除越界用例进 `test/`（路径层已可单测）

### 阶段 3 · 前端模块化（1.5 天）
- `mobile.js` 按 core/player/library/views 拆分（script 标签 + `window.MP`）
- 事件总线替代跨模块直接改 `S`；`meta:` 改索引表（P1-11、13）
- **验收**：功能回归清单（首页/搜索/试听/播放页/设置/导入/体检/悬浮词）逐项过；包体积不增加

### 阶段 4 · Electron 拆分（1 天）
- `main/` 分模块 + `ipc-registry` 统一注册与校验（避免再出 `library:scan` 那种漏授权）
- 渲染层改 ESM 分层；修 P1-15/16
- **验收**：`npm start` 冒烟 + 52 项单测 + 桌面 Setup 冒烟

### 阶段 5 · 测试与 CI 加固（1 天）
- 随机策略抽 `lib/random.js` 由前后端共用并单测；`loudness` 加真实小 MP3 样本断言
- `ensure-server` 改注入确定性失败；提交 lockfile；CI 加依赖安装 + `node --check` + `windows-latest` matrix
- APK 构建进 CI（容器内 aapt2/jdk）+ 结构校验
- **验收**：故意删依赖/改坏 assets，CI 必须变红

**总计约 6.5 人天**，可拆成 5 次发版（阶段 0 可与阶段 1 合并发）。

---

## 五、风险与对策

| 风险 | 对策 |
|---|---|
| 播放线程迁移引发新的偶发问题 | 阶段 1 单独发版；保留旧路径 1 个版本（`-Dplayer.legacy=true` 开关不可行时，用 `git revert` 单提交回滚）；用诊断导出对比迁移前后 `session.log` |
| 前端拆分导致功能漏改 | 逐视图迁移，每迁一个视图跑一遍该视图回归清单；保留 `mobile.js` 直到阶段 3 末尾再删 |
| `window.Android` 接口变动破坏旧客户端 | 门面拆分**不改接口名**；新增能力只加新方法，不删旧方法 |
| 无真机时不可验证 | 每阶段先在有 root 的小米平板验证（已具备零弹窗 adb + 诊断导出） |

## 六、我建议的落地顺序

1. **阶段 0**（今天就能做完，低风险，先把假绿测试和 LRC 基线条正）
2. **阶段 1**（播放内核；单独立项，做完先只发 APK 内测）
3. **阶段 2**（曲库/门面；与阶段 1 分开，避免一次改太多）
4. 阶段 3 → 4 → 5（可按你的节奏）

---

## 七、需要你确认的三点

1. **阶段 1 是否单独发版**（`1.0.8-rc` 只给平板内测，稳定后再合入正式版）？
2. **是否允许改 `window.Android` 接口**？我的建议是**不改**（只增不删），代价是门面里保留少量兼容转发。
3. **前端是否引入打包器**？我的建议是**不引入**（继续 script 标签 + 命名空间），避免给一个"零构建"项目引入 vite/rollup 的维护负担；如果你愿意接受构建步骤，模块化会更彻底。