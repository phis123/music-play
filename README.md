# music-play

一个本地音乐播放器，重点解决一件小事：**双语歌词**——原文一行、译文一行，跟着播放滚动。

> 只播放你自己电脑里的音频文件。不带任何在线曲库、不联网拉取内容。

## 为什么自己写

现成播放器都做不好「上原文、下译文」：

| 播放器 | 问题 |
|---|---|
| AIMP（Android） | 4.25 版没有歌词面板 |
| 盐选音乐 | 同时间戳的两行会被合并成一行 |
| MusicBee / AIMP 桌面版 | 支持但要手写配置，不直观 |

根本原因：LRC 格式没有「翻译」字段。要做双语，只能自己定规矩。

## 怎么做的

播放器把**同时间戳（±30ms）的相邻两行**识别为「原文 / 译文」，上下两行渲染：

```
I can't be helped because I love to play the victim
我无可救药，因为我沉溺于扮演受害者

<Dark angels will run with scissors,cutting off three of my fingers>
<堕落天使手持剪刀狂奔，剪断我的三根手指>
```

## 功能

- 本地目录扫描（递归），支持 mp3 / flac / wav / m4a / ogg / opus
- 播放、上一首、下一首、进度拖动
- 歌词：旁挂 `.lrc`（含 `.双语` `.trans` `.zh` 等后缀）→ 内嵌标签 → 手动
- 双语两行渲染、当前行高亮、自动居中；手动滚动时暂停跟随
- 点歌词行跳转到该时间点
- 歌词延迟调节（±0.1 秒，记住每首歌）
- 桌面悬浮歌词：透明底、可换色、可调字号、上一首/下一首/关闭、锁定穿透
- 歌单、我喜欢的音乐、最近播放（30 首）
- 音质标注（128k / 320k）、封面补全、删除到回收站

## 运行

```bash
pnpm install
node node_modules/electron/install.js   # pnpm v10+ 需要手动下载 Electron 二进制
pnpm start
```

> 如果放在某些受管目录下启动会崩溃，把工程复制到普通目录（如 `C:\Temp\app`）再跑。

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| UI | HTML / CSS / JS | 歌词滚动用 CSS transform 最好写 |
| 运行时 | Electron | 自带 Chromium，不依赖系统浏览器 |
| 标签 | music-metadata / node-id3 | 纯 JS，支持中文路径 |
| 歌词 | 自写解析器 | 双语配对、偏移、多候选 |

## 目录

```
main.js              主进程：窗口、扫描、标签、歌词、删除
preload.js           contextBridge 安全桥
renderer/            UI：index.html / js / css
docs/                ROADMAP、验证报告
```

## License

MIT