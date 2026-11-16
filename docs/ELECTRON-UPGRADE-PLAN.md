# Electron 升级方案（待验证分支草案）

> **状态：评估与分阶段升级方案（当前生产分支保持 `31.7.7`，不盲目直接升级）。**
>
> **第二轮审计更新（2026-11-16）：**
> `main` 分支已完成全部 P0/P1/P2 纵深防御整改：
> 1. 恢复 Chromium 渲染器沙箱（`sandbox: true`）并配置严格 CSP；
> 2. 集中校验 IPC 路径边界（`lib/path-guard.js`），统一 `net:download` / `net:replaceSource` 目标路径参数并严禁 `overwritePath` 未校验透传；
> 3. 全量敏感 IPC 增加调用来源校验（`lib/ipc-guard.js`，核验 `sender`、`senderFrame` 顶层 Frame 与预期本地 HTML URL）；
> 4. 主窗口与悬浮歌词窗均启用导航保护（`setWindowOpenHandler` 拒绝弹窗、`will-navigate` 拦截非本地应用页跳转并改由 `shell.openExternal` 打开外部链接）；
> 5. 内置 `node:test` 自动化回归测试套件与 GitHub Actions CI 已全量启用。

## 1. 为什么升

- **Electron 31 已停止维护。**Electron 31 发布于 2024-06-10，EOL 为 2025-01-14，该分支的最新版本即 `31.7.7`（2025-01-14）；此后该分支无任何安全更新。截至 2026-11-16，31 已 EOL 约 22 个月，Chromium 停留在 M126，Node v20.14.0。M126 之后公开的 Chromium / V8 漏洞均无回补路径。
- **风险被其他缺陷放大，但不等同于“已被攻破”。**渲染进程一旦被攻破，沙箱本应是最后一道防线，但本项目全局关闭了沙箱（`main.js:8-9`），且 IPC 没有路径校验（核实报告第 1、2 节）。三者叠加，风险放大。实事求是地说：应用只加载本地文件（`loadFile`），不直接浏览远程页面，攻击面主要来自不可信的远端数据（歌词、封面、歌曲元数据）被渲染，而非任意网页。**不要把“EOL”等同于“已被攻破”**——无 PoC、无 Issue、无用户上报。
- **目标版本（本次独立核实，2026-11-16）：**
  - npm registry（`npm view electron version dist-tags.latest dist-tags.45-x-y`，2026-11-16 查询）：`latest` 与 `45-x-y` 均为 **`45.3.2`**，`45.3.2` 发布于 2026-11-13。
  - endoflife.date（页面最后更新 2026-11-13）：Electron 45 发布于 2026-10-20，Chromium M156，Node 24，支持至 **2027-04-27**，最新为 `45.3.2`（2026-11-13）；受支持的大版本为 **43、44、45**，43 将于 2027-01-05 EOL。
  - 因此本草案把 `electron` 精确版本定为 **`45.3.2`**（保持原有精确版本、无 `^` 的写法，不放宽范围）。

## 2. 为什么不能直接升

- **跨度太大。**31 → 45 是 14 个大版本，中间的 breaking changes 未逐项核对。Electron 每 8 周发一个大版本，只维护最新的 3 个稳定大版本；一次跨 14 个版本跳升，不能未经测试直接合并。
- **无 lockfile，依赖解析不可复现。**仓库中 `package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` 均不存在（2026-11-16 在基线提交上确认）。升级验证前须先固定 lockfile（见 §3）。
- **pnpm 工具链有旧坑（`docs/P1-验证报告.md` §2–§3，2026-11-03 原型验证记录）：**
  - pnpm 默认符号链接布局的 `node_modules` 用 robocopy 复制到别处会断链（表现为 `Cannot find package 'debug'`）。当时解决办法是在项目根放 `.npmrc` → `node-linker=hoisted`（该文件已在仓库中）。
  - pnpm v10+ 默认阻止 postinstall，Electron 二进制不会被下载（只剩 3 KB 占位包）。当时解决办法是手动执行 `node node_modules/electron/install.js`，或 `pnpm approve-builds`。
  - 升级验证时须先确认当前机器上的包管理器与上述坑的状态，不能假设“装上就能跑”。
- **本项目没有打包工具配置。**仓库中无 `electron-builder` / `electron-packager` 配置，CI（`.github/workflows/build.yml`）是 PyInstaller 空转流程，不打包 Electron、不跑测试。Windows 打包路径本身就是待验证项。
- **没有自动化测试兜底。**全仓库零测试文件，`package.json` 无 `test` 脚本（核实报告第 8 节）。升级前应先按第 8 项补 `node:test` 回归测试，否则升级后无回归保障。

## 3. 升级步骤（另开分支，不合并到 main）

1. **另开独立分支**（例如 `chore/electron-45-upgrade`），本 patch 仅为该分支的起点草案。
2. **先补 lockfile。**在 Windows 上用仓库既定包管理器重新生成 lockfile 并提交；本草案在 Linux 上尝试生成 `package-lock.json` 的结果见 §6——若当时未成功或未随 patch 提交，须在 Windows 上重新生成后才能合并。
3. **先补第 8 项的测试**（`node:test` + `package.json` 加 `"test": "node --test"`），再跑升级后的回归测试。
4. **按 §4 的冒烟清单逐项验证**，全部通过才可提 PR；任一不通过即回退本分支，不合并。
5. **不要与 P0/P1 修复混在同一个 PR。**沙箱、IPC 校验、默认路径、下载清理是各自独立的改动；Electron 升级单独一个分支、单独一个 PR。
6. **合并前把补丁作者占位 `Muse <muse@local>` 改为提交者自己的名字和邮箱。**

## 4. 需验证的兼容点清单（未实测，逐项打勾）

以下全部须在 **Windows 10/11 真机 + Electron 45.3.2** 上验证通过，方可合并：

- [ ] **Windows 打包**：确认打包工具链（当前仓库无 electron-builder / electron-packager 配置，需先确定打包方式）能在 Electron 45 下产出可运行的 exe；打包后从 DSH 工作区目录内外分别启动（`docs/P1-验证报告.md` §1 的崩溃退出码 `-2147483645` 是否与 Electron 版本有关，须复测）。
- [ ] **透明悬浮歌词**：`main.js:417-438`（`frame: false` + `transparent: true` + `backgroundColor: '#00000000'` + `alwaysOnTop`），歌词窗正常显示、置顶、透明背景无黑框。
- [ ] **鼠标穿透**：`main.js:508-514`（`setFloatLock` 内 `floatWin.setIgnoreMouseEvents(floatLocked, { forward: true })`），锁定/解锁切换正常，穿透时点击落到下层窗口。
- [ ] **IPC / preload**：`preload.js:1-35` 的 `contextBridge.exposeInMainWorld('api', …)` 在 Electron 45 下全部 32 个方法可用；`contextIsolation: true` / `nodeIntegration: false` 保持不变。
- [ ] **music-metadata v12 纯 ESM 动态 import**：`main.js:77` 的 `await import('music-metadata')` 在 Electron 45（Node 24）下仍能正常解析标签（含 `main.js:137-142` 的 `parseFile` 调用）。
- [ ] **node-id3 写入**：`netapi.js:313` 的 `require('node-id3')` 下载后写标签仍正常。
- [ ] **pnpm postinstall / approve-builds**：确认 Electron 45 二进制被实际下载（不是 3 KB 占位包）；若仍被 pnpm v10+ 阻止，执行 `node node_modules/electron/install.js` 或 `pnpm approve-builds` 后复验。
- [ ] **网易云本地 API 启动**：`netapi.js:36-70` 的 `ensureServer()` 在 Electron 45 下能正常启动并绑定 `127.0.0.1`（注意第 6 项的 `bootPromise` 失败不重置问题与升级无关，勿混入本次验证）。
- [ ] **冒烟清单**：按核实报告第 8 节的最小化方案，先跑新增的 `node:test`；再人工冒烟：曲库扫描、播放、双语歌词同步、封面显示、下载、悬浮歌词开关、托盘与快捷键。
- [ ] **回退预案**：任一验证不通过，回退本分支（`electron` 改回 `31.7.7`），不合并；记录失败点，不强行修补绕过。

## 5. 已知风险

- 14 个大版本的 breaking changes 未逐项核对，存在未知不兼容（尤其是 Chromium M126 → M156 的渲染行为、Node 20 → 24 的 API 变化）。
- Electron 45 自身的支持窗口只到 2027-04-27；按“最新 3 个大版本”的策略，应用需约每 24 周跟进一次大版本，否则会再次掉出支持范围。
- 升级不修复任何 P0/P1 问题：沙箱仍关闭、IPC 仍无校验、默认路径仍是硬编码个人路径、下载仍无完整性校验。不要把“升了版本”误读为“安全问题已解决”。
- 无 lockfile 时，不同机器、不同时间安装可能得到不同的依赖树；lockfile 须在合并前固定（见 §6）。

## 6. lockfile 说明

- 基线仓库无任何 lockfile（`package-lock.json` / `pnpm-lock.yaml` / `yarn.lock` 均不存在）。
- 本草案在 Linux 上尝试用 `npm install --package-lock-only --ignore-scripts` 生成 `package-lock.json`（不下载 Electron 二进制、不跑完整安装）。结果见随 patch 附带的 `07-notes.md`。
- **若生成成功且合理**，`package-lock.json` 随本 patch 一并提交，并在 `07-notes.md` 中写明生成命令。
- **若生成失败，或 npm lockfile 与仓库历史上的 pnpm 用法冲突**，则不硬塞坏 lockfile：lockfile 须在 Windows 上用仓库既定包管理器重新生成后才能合并。
- 注意：仓库根已有 `.npmrc`（`node-linker=hoisted`），这是 pnpm 扁平布局的配置；用 npm 生成 lockfile 时须确认它不影响 npm 的解析结果，合并前在 Windows 上以既定包管理器复核。

## 7. 未验证项（明确声明）

- 未做 Electron 升级的兼容性实测。
- 未在 Windows 上打包验证。
- 未跑 Electron 45 下的应用（未启动、未播放、未扫描）。
- 未逐项核对 31 → 45 之间全部 breaking changes。
- 本文档与 `package.json` 的版本号改动仅为方案草案，不代表升级可行。
