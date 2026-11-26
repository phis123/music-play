/*
 * views/settings.js — 设置页（v2 重构：全套自定义 SVG 图标 + 规范卡片与对齐）。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

function viewSettings() {
  const curRoot = (function () { try { return (A && A.rootDir) ? A.rootDir() : '/storage/emulated/0/Music/music-play'; } catch (e) { return '/storage/emulated/0/Music/music-play'; } })();
  const gainMapCount = Object.keys(getTrackGainMap()).length;
  const playCountsCount = Object.keys(getPlayCounts()).length;
  const lrcColors = [
    ['#e53945', '绯红'],
    ['#4da3ff', '极光蓝'],
    ['#10b981', '翡翠绿'],
    ['#f59e0b', '琥珀金'],
    ['#a855f7', '暮光紫'],
    ['#ffffff', '纯净白'],
  ];
  const hasPerm = storageOK();
  return `<div class="page-shell">${backBar('设置')}<div class="set-wrap">
    <div class="set-card">
      <div class="set-card-head">
        <span class="set-ico tone-red">${ico('folder')}</span>
        <div class="set-card-meta">
          <div class="set-card-title">曲库与下载目录</div>
          <div class="set-card-desc">管理本地扫描路径、下载保存位置与系统存储权限</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">当前目录（已扫 ${S.tracks.length} 首）</div>
          <div class="set-row-sub">${esc(curRoot)}</div>
        </div>
        <div class="set-row-ctrl">
          <button class="hero-btn pri" data-set-dir="picker">${ico('folder', 'ico-xs')}<span>调整目录</span></button>
          <button class="hero-btn" data-rescan="1">${ico('refresh', 'ico-xs')}<span>重新扫描</span></button>
          <button class="hero-btn${hasPerm ? '' : ' danger'}" data-storage="1">${ico(hasPerm ? 'shield' : 'alert', 'ico-xs')}<span>${hasPerm ? '存储权限正常' : '开启存储权限'}</span></button>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <span class="set-ico tone-blue">${ico('wave')}</span>
        <div class="set-card-meta">
          <div class="set-card-title">音量平衡</div>
          <div class="set-card-desc">基于 MP3 帧增益分析 + 原生 LoudnessEnhancer，平滑消除音源响度跳变</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">全局自动音量平衡</div>
          <div class="set-row-sub">自动衰减过响音源、适度提升偏轻音源，可在播放页独立微调单曲</div>
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
          <div class="set-row-label">目标响度基准</div>
          <div class="set-row-sub">标准 (-14 LUFS) 对齐流媒体；夜间更柔和；人声增强适合偏轻播客</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-preset="standard" class="${S.normPreset === 'standard' ? 'on' : ''}">标准</button>
            <button data-set-preset="night" class="${S.normPreset === 'night' ? 'on' : ''}">夜间</button>
            <button data-set-preset="boost" class="${S.normPreset === 'boost' ? 'on' : ''}">增强</button>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">单曲独立微调记录</div>
          <div class="set-row-sub">已为 ${gainMapCount} 首歌保存独立增益偏移</div>
        </div>
        <div class="set-row-ctrl">
          <button class="hero-btn" data-set-cleargains="1" ${gainMapCount ? '' : 'disabled'}>${ico('del', 'ico-xs')}<span>清空单曲微调</span></button>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <span class="set-ico tone-green">${ico('shuffle')}</span>
        <div class="set-card-meta">
          <div class="set-card-title">随机播放策略</div>
          <div class="set-card-desc">选择「随机播放」模式下的下一首抽选算法</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">抽选算法</div>
          <div class="set-row-sub">${
            S.randomStrategy === 'no-repeat'
              ? '不重复随机：整轮播完前绝不重复抽中同一首歌（推荐）'
              : S.randomStrategy === 'rare-first'
                ? '不常听优先：结合播放次数统计，优先抽选少听或未听过的歌曲'
                : '真随机：每次切歌独立随机抽取'
          }</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-rand="no-repeat" class="${S.randomStrategy === 'no-repeat' ? 'on' : ''}">不重复</button>
            <button data-set-rand="rare-first" class="${S.randomStrategy === 'rare-first' ? 'on' : ''}">不常听优先</button>
            <button data-set-rand="true-random" class="${S.randomStrategy === 'true-random' ? 'on' : ''}">真随机</button>
          </div>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <span class="set-ico tone-amber">${ico('palette')}</span>
        <div class="set-card-meta">
          <div class="set-card-title">歌词外观</div>
          <div class="set-card-desc">自定义播放页双语歌词字号与当前句高亮色</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">歌词字号（当前 ${S.lrcSize}px）</div>
          <div class="set-row-sub">支持预设档位或 14px ~ 28px 连续调节</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-lrcsz="15" class="${S.lrcSize === 15 ? 'on' : ''}">小</button>
            <button data-set-lrcsz="18" class="${S.lrcSize === 18 ? 'on' : ''}">标准</button>
            <button data-set-lrcsz="21" class="${S.lrcSize === 21 ? 'on' : ''}">大</button>
            <button data-set-lrcsz="24" class="${S.lrcSize === 24 ? 'on' : ''}">特大</button>
          </div>
          <input type="range" id="mobLrcSizeRange" class="set-range" min="14" max="28" step="1" value="${S.lrcSize}">
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">当前句高亮色</div>
          <div class="set-row-sub">点选配色即时生效</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-swatches">
            ${lrcColors.map(([c, name]) => `<span class="set-swatch${S.lrcColor.toLowerCase() === c ? ' on' : ''}" data-set-lrccolor="${c}" title="${name}" style="background:${c}"></span>`).join('')}
          </div>
        </div>
      </div>
      <div class="set-preview-box">
        <div id="mobLrcPrevEn" style="font-size:${S.lrcSize + 2}px;color:${esc(S.lrcColor)};font-weight:800">Can we pretend we're not angels through a cable?</div>
        <div id="mobLrcPrevZh" style="font-size:${S.lrcSize - 1}px;color:${esc(S.lrcColor)};font-weight:600;margin-top:4px;opacity:.9">我们能否假装自己不是隔着网线相望的天使？</div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <span class="set-ico tone-slate">${ico('sliders')}</span>
        <div class="set-card-meta">
          <div class="set-card-title">界面外观与曲库维护</div>
          <div class="set-card-desc">主题切换、曲库体检、封面歌词补齐与缓存清理</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">界面外观主题</div>
          <div class="set-row-sub">浅色 Studio Paper / 深色 Obsidian Vinyl</div>
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
          <div class="set-row-label">曲库体检与元信息补齐</div>
          <div class="set-row-sub">已记录 ${playCountsCount} 首歌的播放频次</div>
        </div>
        <div class="set-row-ctrl">
          <button class="hero-btn pri" data-go="health">${ico('health', 'ico-xs')}<span>曲库体检</span></button>
          <button class="hero-btn" data-enrich-now="1">${ico('sparkle', 'ico-xs')}<span>补齐封面歌词</span></button>
          <button class="hero-btn" data-set-clearstats="1">${ico('del', 'ico-xs')}<span>清空统计</span></button>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <span class="set-ico tone-slate">${ico('diag')}</span>
        <div class="set-card-meta">
          <div class="set-card-title">诊断与日志导出</div>
          <div class="set-card-desc">一键打包会话日志、崩溃堆栈、屏幕与权限快照，便于排查异常</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">现场诊断包</div>
          <div class="set-row-sub" id="diagPathTip">${esc(S.diagLastPath ? ('上次导出：' + S.diagLastPath) : '导出后将在 App 外部目录生成 zip')}</div>
        </div>
        <div class="set-row-ctrl">
          <button class="hero-btn pri" data-diag="export">${ico('download', 'ico-xs')}<span>导出诊断包</span></button>
          <button class="hero-btn" data-diag="snapshot">${ico('eye', 'ico-xs')}<span>查看快照</span></button>
          <button class="hero-btn" data-diag="clear">${ico('del', 'ico-xs')}<span>清空日志</span></button>
        </div>
      </div>
    </div>
  </div></div>`;
}
