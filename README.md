# music-play

本地音乐播放器，只解决一件事：**双语歌词** —— 原文一行、译文一行，跟着播放滚动。

> 状态：P1 原型已跑通（曲库扫描 / 播放 / 双语歌词），尚未打包分发。

## 为什么自己写

现成播放器都做不到「上原文、下译文」：

| 播放器 | 问题 |
|---|---|
| AIMP（Android） | 4.25 版没有歌词面板 |
| Salt Player | 同时间戳的两行会被合并，只留一条 |
| 网易云（本地歌词） | 只从「本地音乐」入口读 lrc，歌单/云盘条目不读 |
| MusicBee / AIMP 桌面版 | 支持，但只在 PC 且配置繁琐 |

根因：**LRC 标准没有「翻译」字段**。播放器要做双语，只能靠私有格式。

## 做了什么

播放器把**同时间戳（±30ms）的相邻两行**识别为「原文 / 译文」配对，上下两行渲染：

```
I can't be helped because I love to play the victim
我无可救药，因为我沉溺于扮演受害者

<Dark angels will run with scissors,cutting off my three fingers>
<堕落天使手持剪刀狂奔，剪断我的三根手指>
```

## 运行

```bash
pnpm install                    # 安装依赖
node node_modules/electron/install.js   # pnpm v10+ 需手动下载 Electron 二进制
pnpm start
```

⚠️ **不要放在 DSH 工作区路径下运行**（`E:\dsh\work2\...` 会 0x80000003 崩溃），
复制到 `C:\Temp\xxx` 或 `E:\xxx` 再跑。详见 [docs/P1-验证报告.md](docs/P1-验证报告.md)。

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| UI | HTML / CSS / JS | 歌词滚动用 CSS transform 最好写 |
| 运行时 | Electron 31.7.7 | 自带 Chromium，不依赖系统 Edge 版本 |
| 标签 | music-metadata | 纯 JS，支持中文路径 |
| 歌词 | 自写解析器 | LRC / 双语配对 / 后续支持 SPL、USLT |

## 目录

```
main.js              主进程：扫描、标签、歌词读取（IPC）
preload.js           contextBridge 安全桥
renderer/            UI：index.html / app.js / style.css
docs/                ROADMAP、P0/P1 验证报告
```

## License

MIT
