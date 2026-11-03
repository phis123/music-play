# music-play

本地音乐播放器，只为一件事：**双语歌词显示** —— 原文一行、译文一行，跟着播放滚动。

> 状态：早期开发中（P0 技术验证阶段），尚不可用。

## 为什么要自己写

现成播放器都做不到"上原文、下译文"：

| 播放器 | 问题 |
|---|---|
| AIMP（Android） | 4.25 版没有歌词面板 |
| Salt Player | 同时间戳的两行会被合并，只留一条 |
| 网易云（本地歌词） | 只从"本地音乐"入口读 lrc，歌单/云盘条目不读 |
| MusicBee / AIMP 桌面版 | 支持，但只在 PC 且配置繁琐 |

根因：**LRC 标准里没有"翻译"字段**。播放器要实现双语，只能靠私有格式（如 Salt Player 的 SPL）。

## 计划特性

- [ ] 本地曲库扫描（MP3 / FLAC / WAV / OGG）
- [ ] **双语歌词两行显示**（原文 + 译文，逐行滚动）
- [ ] 歌词来源优先级：自定义 JSON > LRC 旁挂 > 内嵌 USLT
- [ ] 封面与标签读写
- [ ] 便携免安装（自带 WebView2 固定版内核，零系统依赖）

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| UI | HTML / CSS / JS | 歌词滚动用 CSS transform 最好写 |
| 渲染内核 | WebView2 固定版（随包分发） | 不依赖用户机器的 Edge 版本 |
| 桥接 | pywebview + WebSocket | 进度/歌词实时推送 |
| 播放 | miniaudio | 公有领域，零许可风险，支持 mp3/flac/wav/ogg |
| 曲库 | SQLite + mutagen | 扫描索引与标签读写 |
| 打包 | PyInstaller（onedir） | onefile 误报率高，必须 onedir |

## 开发

见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## License

MIT
