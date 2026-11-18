# music-play

**v1.0.0 · 正式版**

一个专注**双语歌词**的本地音乐播放器——原文一行、译文一行，跟着播放平滑滚动。支持 Windows 桌面端（Electron）与 Android 移动端。

> 专注本地音频体验与双语 LRC 歌词同步渲染。

## 为什么自己写

现成播放器都做不好「上原文、下译文」：

| 播放器 | 问题 |
|---|---|
| AIMP（Android） | 4.25 版没有独立双语歌词面板 |
| 盐选音乐 | 同时间戳的两行会被合并成一行 |
| MusicBee / AIMP 桌面版 | 支持但要手写配置，不直观 |

根本原因：LRC 格式没有独立的「翻译」字段。要做双语，只能自己定规矩。

## 怎么做的

播放器把**同时间戳（±30ms）的相邻两行**自动识别为「原文 / 译文」，上下分层渲染：

```
I can't be helped because I love to play the victim
我无可救药，因为我沉溺于扮演受害者

<Dark angels will run with scissors,cutting off three of my fingers>
<堕落天使手持剪刀狂奔，剪断我的三根手指>
```

## 功能特性（v1.0.0）

- **本地曲库管理**：递归扫描音频目录，支持 `mp3 / flac / wav / m4a / ogg / aac / opus`，自动记忆自定义音乐目录；增量扫描缓存（`scan-cache.json`）+ 封面 LRU，648 首曲库秒开
- **播放控制与队列**：顺序循环 / 单曲循环 / 随机播放，内置可视化播放队列抽屉（当前曲目动态声波指示、插队「下一首播放」、移除与清空）
- **三种随机播放策略**（可在设置页切换）：
  - **不重复随机**：整轮队列听完一遍前绝不重复抽中同一首（默认）
  - **不常听优先随机**：按本地播放次数为权重，优先抽到少听 / 没听过的歌
  - **真随机**：每次切歌完全独立随机
- **音量平衡（响度归一化）**：自动测算每首歌的响度并做增益补偿，消除不同音源「忽大忽小」
  - MP3 帧 `global_gain` 三段抽样测算（约 1.2ms/首），兼容 ReplayGain 标签
  - 桌面端走 WebAudio `GainNode` + 软限幅器，可衰减也可放大且不破音
  - Android 端走原生 `LoudnessEnhancer` 硬件 DSP + `MediaPlayer` 音量衰减
  - 预设档位 `标准 -14 LUFS / 轻柔夜间 -17 LUFS / 人声增强 -12 LUFS`
- **沉浸式双语歌词页**：
  - 旁挂 `.lrc`（支持 `.双语 / .trans / .zh / .bilingual` 等后缀）与内嵌歌词自动识别
  - 当前行高亮放大、自动居中；手动滑动时暂停自动跟随并浮现「回到当前播放行」胶囊
  - 歌词页内联搜索过滤与点击任意歌词行直达对应时间点
  - 歌词字号（14–28px）与高亮配色（6 套预设 + 自定义）可调
  - 随当前专辑封面实时演变的毛玻璃动态流体背景
- **播放页「⚙ 播放设置」小面板（对单首歌独立调）**：
  - 单曲音量平衡微调（−12 ~ +12 dB，按曲目路径持久化）
  - 单曲歌词延迟微调（−5.0s ~ +5.0s，按曲目路径持久化）
  - 悬浮歌词设计：字号、底衬透明度、配色、锁定触摸穿透
- **独立「设置」主界面**：把下载 / 曲库目录、歌词字号与配色、随机策略、音量平衡、外观主题与曲库体检等低频功能从主界面收纳出来，主视图保持简洁
- **播放页声源切换与曲库体检**：一键试听、对比时长并无缝替换当前曲目音频源（保持播放进度与元数据）；体检面板检测缺词、缺封面、疑似重复与异常短音频
- **全局任务进度与报错中心**：扫描、封面歌词补齐、批量导入下载均配备顶部实时进度条与异常明细汇总弹窗
- **桌面悬浮歌词与系统集成**：透明穿透、多配色与字号调节、系统媒体快捷键与通知栏控制、深色 / 浅色 / 跟随系统三态外观
- **安全与稳定性**：IPC 来源与 Frame 校验、曲库路径越界防护（含符号链接与大小写变体）、下载覆盖路径校验、WebView 导航白名单；52 项单元测试 + GitHub Actions CI

## 下载

| 平台 | 文件 | 说明 |
|---|---|---|
| Windows | `music-play-Setup-1.0.0.exe` | 单文件安装程序（默认安装到 `E:\music-play`，可自选） |
| Android | `music-play-1.0.0.apk` | 支持 Android 7.0+（minSdk 24 / targetSdk 34），可直接侧载安装 |
| 源码 | `music-play-src-1.0.0.zip` | 桌面端 + Android 端完整源码 |

Android 首次使用请允许「所有文件访问权限」（用于删除 / 写入 `Music/` 目录）与「显示在其他应用上层」（悬浮歌词）；Android 13+ 还需允许通知权限以显示播放控制。

## 运行（开发）

```bash
pnpm install
node node_modules/electron/install.js   # pnpm v10+ 手动拉取 Electron 二进制
pnpm start
```

单元测试：

```bash
npm test          # node --test，52 项全绿
```

打包（Windows 安装包 / Android APK）见 [docs/BUILD.md](docs/BUILD.md)，其中记录了 aapt2 在 Windows 上把 assets 路径写成反斜杠导致「整页无样式」的陷阱与规避方式。

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面端 UI / 运行时 | Electron + 原生 HTML / CSS / JS | 零框架开销，大曲库列表分片渲染不掉帧 |
| 移动端 | Android 原生壳（MediaPlayer 前台服务 + WebView） | 支持后台播放、通知栏控制与后台任务保活 |
| 音频标签 | music-metadata / node-id3 | 纯 JS 读写 ID3 封面与标签，完整兼容中文路径 |
| 歌词引擎 | 自研双语 LRC 解析器 | 同时间戳双语配对、逐曲偏移记忆、多候选优先级 |
| 音量平衡 | 自研 MP3 `global_gain` 抽样测算 + WebAudio / LoudnessEnhancer | 无需解码整首歌即可估算响度，毫秒级 |

## 目录结构

```
main.js              桌面端主进程：窗口、曲库扫描、标签读写、音量平衡、桌面悬浮窗
preload.js           contextBridge 安全桥
renderer/            桌面端 UI：index.html / float.html / js / css
lib/                 公共模块：loudness 响度测算 / lrc 解析 / path-guard 路径防护 / ipc-guard IPC 校验
netapi.js            网易云接口封装（搜索、歌词、音频地址、下载）
assets/              应用图标与内置资源
android/app/         Android 客户端源码（Java 前台播放服务 + 移动端自适应 UI）
test/                node --test 单元测试（52 项）
tools/               打包脚本（build-apk.mjs / music-play.iss）
docs/                ROADMAP 与阶段验证报告
```

## License

MIT
