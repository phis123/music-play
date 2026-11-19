# 诊断与日志导出

用于定位**偶发问题**（闪退、点了没反应、卡在播放中）与**机型适配问题**（屏幕/密度/WebView/权限差异）。
不需要 root、不需要连电脑、不需要在别人的设备上复现。

## 用户侧（三步）

1. 打开 App → 底部「设置」→ 拉到最下 **🧾 诊断与日志导出**
2. 点 **📦 导出诊断包** —— 生成 zip，页面会显示完整路径并弹提示
3. 把 zip 发回给维护者。文件位置：

```
/sdcard/Android/data/com.phis.musicplay/files/diag/export-<时间>.zip
```

同页还有：
- **👁 查看快照**：直接看设备/屏幕/WebView/权限/存储/播放状态（不导出也能看）
- **🧹 清空本地日志**：清掉本地日志，已导出的 zip 保留

## 维护者侧（不动界面）

设备在场但**不能操作前台**（锁屏、别人在用）时，用广播触发。**必须带 `-n`**：
Android 8+ 不接受隐式广播打到 manifest receiver。

```bash
adb shell am broadcast -n com.phis.musicplay/.DiagReceiver -a com.phis.musicplay.DIAG_EXPORT
# 也可清空：-a com.phis.musicplay.DIAG_CLEAR
adb pull /sdcard/Android/data/com.phis.musicplay/files/diag/ <本地目录>
```

若 App 进程/界面还在，广播会**转交前端**执行导出，从而一并收集 `state.json`（前端设置与队列）。

## 导出包内容

| 文件 | 内容 | 私密性 |
|---|---|---|
| `session.log` / `sessionN.log` | 会话日志（1MB 轮转，保留 2 份）：启动、曲库扫描、播放、暂停/恢复、错误、崩溃前记录 | 无隐私 |
| `crash-*.txt` | 未捕获异常的完整堆栈（含线程名与堆栈） | 无隐私 |
| `snapshot.txt` | 机型/厂商/系统指纹/ABI/root 迹象、屏幕 px 与 density、WebView 实现与 UA、权限授予状态、存储与内存、电量与省电模式、播放与悬浮词状态、线程表 | 无隐私 |
| `library.json` | 曲库摘要：**仅文件名、大小、时长、有无歌手/歌词**，不含音频内容 | ⚠ 含歌曲文件名 |
| `logcat.txt` | 本进程 logcat 尾部（无需 root） | 无隐私 |
| `state.json` | 前端设置（均衡档位、歌词字号配色、随机策略）、播放队列长度/当前曲目、曲库规模、设备信息、最近任务报错 | ⚠ 含当前曲目路径 |
| `README.txt` | 内容说明 | — |

## 实现要点

- 原生：`Diag.java`（会话日志、崩溃处理器、环境快照、zip 打包）、`DiagReceiver.java`（广播入口）
- JS：`hookDiag()` 统一包装 `window.onerror`、`unhandledrejection`、`onPlayerError`/`onEnded`/`onAppResume`；
  关键节点（启动、曲库加载、试听、暂停/恢复/复核、导出）调用 `diagLog()`
- 崩溃即使发生在 WebView 里也会先经 `window.onerror` 落一条记录，再走原生 `UncaughtExceptionHandler`
- 日志上限 1MB×2，导出包只带最近现场，不会无限增长

## 常见排查套路

| 现象 | 先看 |
|---|---|
| 点了没反应 | `session.log` 里是否有对应 `ui:`/`native-cb:` 记录；`state.json.playing` 与原生 `snapshot.txt.播放状态` 是否矛盾 |
| 偶发无声 | `native-cb: onPlayerError args=<what>,<extra>`（`-38` 是 vivo/MIUI 的媒体错误） |
| 封面/歌手丢了 | `snapshot.txt` 的权限段（`READ_MEDIA_AUDIO`）+ `library.json.summary` 的缺歌手计数 |
| 界面错位/字号怪 | `snapshot.txt` 的 `dp/density/scaledDensity/smallestWidthDp` 与 `WebView 实现` 版本 |
| 后台被杀 | `session.log` 的 `lifecycle:` 序列 + `snapshot.txt` 的电量/省电模式 |