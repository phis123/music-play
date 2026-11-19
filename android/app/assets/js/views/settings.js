/*
 * views/settings.js — 设置页。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

function viewSettings() {
  const curRoot = (function () { try { return (A && A.rootDir) ? A.rootDir() : '/storage/emulated/0/Music/music-play'; } catch (e) { return '/storage/emulated/0/Music/music-play'; } })();
  const gainMapCount = Object.keys(getTrackGainMap()).length;
  const playCountsCount = Object.keys(getPlayCounts()).length;
  const lrcColors = [
    ['#ec4141', '网易红'],
    ['#4da3ff', '极光蓝'],
    ['#10b981', '翡翠绿'],
    ['#f59e0b', '琥珀金'],
    ['#a855f7', '霓虹紫'],
    ['#ffffff', '高对比白'],
  ];
  return backBar('设置') + `<div class="set-wrap">
    <div class="set-card">
      <div>
        <div class="set-card-title">📁 曲库与下载目录</div>
        <div class="set-card-desc">调整在线下载与批量导入保存的目标目录，并检测存储读写权限</div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">当前目录（已扫 ${S.tracks.length} 首）</div>
          <div class="set-row-sub">${esc(curRoot)}</div>
        </div>
        <div class="set-row-ctrl">
          <button class="hero-btn pri" data-set-dir="picker">📁 调整目录</button>
          <button class="hero-btn" data-rescan="1">🔄 重新扫描</button>
          <button class="hero-btn" data-storage="1">${storageOK() ? '✓ 存储权限正常' : '⚠ 开启存储权限'}</button>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div>
        <div class="set-card-title">♪ 音量平衡（Loudness Normalization）</div>
        <div class="set-card-desc">基于 MP3 帧增益分析 + 原生 LoudnessEnhancer 动态均衡，自动消除不同音源声音忽大忽小问题</div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">全局自动音量平衡</div>
          <div class="set-row-sub">开启后自动衰减过响音源、放大偏轻音源（可在播放页「⚙ 播放设置」对单首歌独立调整）</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-norm="1" class="${S.normEnabled ? 'on' : ''}">开启</button>
            <button data-set-norm="0" class="${!S.normEnabled ? 'on' : ''}">关闭</button>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">目标响度模式</div>
          <div class="set-row-sub">标准模式对齐流媒体 (-14 LUFS)；夜间模式更轻柔护耳；增强模式适合偏轻播客音源</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-preset="standard" class="${S.normPreset === 'standard' ? 'on' : ''}">标准 (-14)</button>
            <button data-set-preset="night" class="${S.normPreset === 'night' ? 'on' : ''}">轻柔夜间 (-17)</button>
            <button data-set-preset="boost" class="${S.normPreset === 'boost' ? 'on' : ''}">人声增强 (-12)</button>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">单曲独立微调记录</div>
          <div class="set-row-sub">已为 ${gainMapCount} 首歌单独保存了音量微调偏移</div>
        </div>
        <div class="set-row-ctrl">
          <button class="hero-btn" data-set-cleargains="1" ${gainMapCount ? '' : 'disabled'}>清空单曲微调</button>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div>
        <div class="set-card-title">🔀 随机播放策略</div>
        <div class="set-card-desc">选择切换至「随机播放」时的下一首抽选算法</div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">随机抽选模式</div>
          <div class="set-row-sub">${
            S.randomStrategy === 'no-repeat'
              ? '不重复随机：整轮队列全部听完一遍前绝不重复抽中同一首歌（推荐）'
              : S.randomStrategy === 'rare-first'
                ? '不常听优先：结合播放次数统计，优先随机抽选少听或未听过的歌曲'
                : '真随机：每次切歌完全独立随机抽取'
          }</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-rand="no-repeat" class="${S.randomStrategy === 'no-repeat' ? 'on' : ''}">不重复随机</button>
            <button data-set-rand="rare-first" class="${S.randomStrategy === 'rare-first' ? 'on' : ''}">不常听随机</button>
            <button data-set-rand="true-random" class="${S.randomStrategy === 'true-random' ? 'on' : ''}">真随机</button>
          </div>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div>
        <div class="set-card-title">🎨 歌词外观（字号大小与高亮颜色）</div>
        <div class="set-card-desc">调整播放页双语歌词字号与当前句高亮色彩</div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">歌词字号（当前 ${S.lrcSize}px）</div>
          <div class="set-row-sub">支持档位选择或滑块调节（14px ~ 28px）</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-lrcsz="15" class="${S.lrcSize === 15 ? 'on' : ''}">小</button>
            <button data-set-lrcsz="18" class="${S.lrcSize === 18 ? 'on' : ''}">标准</button>
            <button data-set-lrcsz="21" class="${S.lrcSize === 21 ? 'on' : ''}">大</button>
            <button data-set-lrcsz="24" class="${S.lrcSize === 24 ? 'on' : ''}">特大</button>
          </div>
          <input type="range" id="mobLrcSizeRange" min="14" max="28" step="1" value="${S.lrcSize}" style="width:120px;accent-color:var(--red)">
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">当前句高亮配色</div>
          <div class="set-row-sub">点选预设主题色或自定义颜色</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-swatches">
            ${lrcColors.map(([c, name]) => `<span class="set-swatch${S.lrcColor.toLowerCase() === c ? ' on' : ''}" data-set-lrccolor="${c}" title="${name}" style="background:${c}"></span>`).join('')}
          </div>
        </div>
      </div>
      <div class="set-preview-box">
        <div id="mobLrcPrevEn" style="font-size:${S.lrcSize + 2}px;color:${esc(S.lrcColor)};font-weight:800">Can we pretend we're not angels through a cable?</div>
        <div id="mobLrcPrevZh" style="font-size:${S.lrcSize - 1}px;color:${esc(S.lrcColor)};font-weight:650;margin-top:4px">我们能否假装自己不是隔着网线相望的天使？</div>
      </div>
    </div>

    <div class="set-card">
      <div>
        <div class="set-card-title">🛠 界面外观与非常用维护工具</div>
        <div class="set-card-desc">将低频工具集中收纳，保持主界面简洁清爽</div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">界面外观主题</div>
          <div class="set-row-sub">切换浅色、深色或跟随系统</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-theme-set="auto" class="${S.theme === 'auto' ? 'on' : ''}">跟随系统</button>
            <button data-theme-set="light" class="${S.theme === 'light' ? 'on' : ''}">浅色</button>
            <button data-theme-set="dark" class="${S.theme === 'dark' ? 'on' : ''}">深色</button>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">曲库体检与补齐工具</div>
          <div class="set-row-sub">已累计统计 ${playCountsCount} 首歌播放频次</div>
        </div>
        <div class="set-row-ctrl">
          <button class="hero-btn pri" data-go="health">🩺 打开曲库体检</button>
          <button class="hero-btn" data-enrich-now="1">✦ 补齐封面与歌词</button>
          <button class="hero-btn" data-set-clearstats="1">🧹 清空统计缓存</button>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div>
        <div class="set-card-title">🧾 诊断与日志导出</div>
        <div class="set-card-desc">遇到闪退、偶发无响应、机型适配异常时用这里：一键打包现场（日志 + 崩溃堆栈 + 设备/屏幕/WebView/权限快照 + 曲库摘要），无需连电脑、无需 root</div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">导出诊断包</div>
          <div class="set-row-sub" id="diagPathTip">${esc(S.diagLastPath ? ('上次导出：' + S.diagLastPath) : '导出后会在 App 外部目录生成 zip，路径会显示在这里')}</div>
        </div>
        <div class="set-row-ctrl">
          <button class="hero-btn pri" data-diag="export">📦 导出诊断包</button>
          <button class="hero-btn" data-diag="snapshot">👁 查看快照</button>
          <button class="hero-btn" data-diag="clear">🧹 清空本地日志</button>
        </div>
      </div>
    </div>
  </div>`;
}
