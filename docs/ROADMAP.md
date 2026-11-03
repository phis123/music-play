# 路线图

## P0 · 技术验证（当前）

三个风险点，各半天内可验完：

1. **pywebview 能否加载 WebView2 固定版内核**
   通过 `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` 指向包内目录，验证窗口正常渲染。
2. **miniaudio 能否播放目标格式**
   用 MP3 / FLAC / WAV / OGG 各一首实测；确认 seek、时长读取准确。
3. **PyInstaller onedir 打包后能独立运行**
   拷到没装 Python 的机器上跑，确认无缺失 DLL。

## P1 · 自用版（3 天）

- 播放 / 暂停 / 进度 / 音量
- 目录扫描 + 曲库列表 + 搜索
- **双语歌词两行渲染 + 平滑滚动**
- 封面显示

## P2 · 可分发给朋友（1 天）

- 便携 ZIP（解压即用，不写注册表）
- 使用说明（含 SmartScreen 解除方法）
- GitHub Actions 自动打包 + Release

## P3 · 打磨（1 天）

- 申请 OSS 免费代码签名（SignPath Foundation）
- 内置版本检查（GitHub Releases API）

## P4 · Android（可选，5~7 天）

系统 WebView 做 UI + 原生 Foreground Service 播放，复用前端代码。

## 已知风险

| 风险 | 应对 |
|---|---|
| 杀软误报 PyInstaller 产物 | onedir 模式 + 附 SHA256 |
| SmartScreen 拦截未签名 exe | 说明文档 / OSS 代码签名 |
| 180MB 包体分发成本 | GitHub Releases + 版本检查 |
| 固定版内核与系统策略冲突 | 启动探测 + 回退提示 |

## 决策记录

- **播放内核选 miniaudio 而非 libVLC**：避开 GPL 插件，体积从 80MB 降到 3MB；代价是不支持 AAC/APE/DSD，暂不需要。
- **UI 用 Web 而非 Qt**：双语歌词的滚动与高亮用 CSS 实现成本最低，且能复用已有前端代码。
- **许可证 MIT**：项目捆绑微软闭源运行时（WebView2），MIT 可避免 GPL 的再分发争议。
