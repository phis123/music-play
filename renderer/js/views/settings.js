/**
 * views/settings.js — 设置页视图
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { esc } from '../core/dom.js'
import { state } from '../core/state.js'
import { getPlayCounts, getTrackGainMap } from '../core/store.js'


/* ---------------- 独立主设置界面 (#/settings) ---------------- */
export function viewSettings() {
  const gainMapCount = Object.keys(getTrackGainMap()).length
  const playCountsCount = Object.keys(getPlayCounts()).length
  const lrcColors = [
    ['#ec4141', '网易珊瑚红'],
    ['#4da3ff', '极光冰蓝'],
    ['#10b981', '翡翠森林'],
    ['#f59e0b', '流光琥珀'],
    ['#a855f7', '霓虹紫晶'],
    ['#ffffff', '纯净高对比'],
  ]
  return `<div class="set-wrap">
    <div class="page-head">
      <div>
        <div class="page-title">设置</div>
        <div class="page-sub">统一管理曲库与下载目录、音量平衡、随机播放算法、歌词外观与低频维护工具</div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <div>
          <div class="set-card-title">📁 曲库与下载目录</div>
          <div class="set-card-desc">在线下载与批量导入的歌曲、旁挂双语歌词 (.lrc) 与封面将自动保存在此目录</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">当前音乐目录（共 ${state.tracks.length} 首）</div>
          <div class="set-row-sub">${esc(state.root || '默认系统音乐目录')}</div>
        </div>
        <div class="set-row-ctrl">
          <button class="btn-sm primary" id="setPickRootBtn">📁 更改目录</button>
          <button class="btn-sm" id="setRescanBtn">🔄 重新扫描</button>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <div>
          <div class="set-card-title">♪ 音量平衡（Loudness Normalization）</div>
          <div class="set-card-desc">基于 MP3 帧增益分析 + WebAudio 增益与软限幅器，自动消除不同播客音源声音忽大忽小的问题</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">自动音量平衡</div>
          <div class="set-row-sub">开启后将过响曲目平滑衰减、过轻音源自动放大并防破音（可在播放页「⚙ 播放设置」对单首歌独立微调）</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-norm="1" class="${state.normEnabled ? 'on' : ''}">开启</button>
            <button data-set-norm="0" class="${!state.normEnabled ? 'on' : ''}">关闭</button>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">目标响度基准</div>
          <div class="set-row-sub">标准模式对齐主流流媒体（-14 LUFS）；夜间模式更柔和护耳；增强模式适合偏轻音源</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-preset="standard" class="${state.normPreset === 'standard' ? 'on' : ''}">标准 (-14 LUFS)</button>
            <button data-set-preset="night" class="${state.normPreset === 'night' ? 'on' : ''}">轻柔夜间 (-17 LUFS)</button>
            <button data-set-preset="boost" class="${state.normPreset === 'boost' ? 'on' : ''}">人声增强 (-12 LUFS)</button>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">单曲独立增益微调记录</div>
          <div class="set-row-sub">已为 ${gainMapCount} 首歌曲单独保存了音量微调偏好</div>
        </div>
        <div class="set-row-ctrl">
          <button class="btn-sm" id="setClearTrackGains" ${gainMapCount ? '' : 'disabled'}>清空单曲微调</button>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <div>
          <div class="set-card-title">🔀 随机播放策略</div>
          <div class="set-card-desc">控制切换至「随机播放」模式时的下一首抽取算法</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">随机抽选模式</div>
          <div class="set-row-sub">
            ${state.randomStrategy === 'no-repeat'
              ? '不重复随机：当前队列所有歌曲全部听完一遍前绝不重复抽中同一首（推荐）'
              : state.randomStrategy === 'rare-first'
                ? '不常听优先：结合本地播放次数统计，优先随机抽选平时少听或未听过的歌曲'
                : '真随机：每次切歌完全独立随机抽取（像掷骰子一样，可能短时间内再次抽中）'}
          </div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-rand="no-repeat" class="${state.randomStrategy === 'no-repeat' ? 'on' : ''}">不重复随机</button>
            <button data-set-rand="rare-first" class="${state.randomStrategy === 'rare-first' ? 'on' : ''}">不常听随机</button>
            <button data-set-rand="true-random" class="${state.randomStrategy === 'true-random' ? 'on' : ''}">真随机</button>
          </div>
        </div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <div>
          <div class="set-card-title">🎨 歌词外观（字体大小与高亮颜色）</div>
          <div class="set-card-desc">调整歌曲播放页双语歌词的字号与当前句高亮色彩</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">歌词字号大小</div>
          <div class="set-row-sub">支持预设档位或滑块无级调节（14px ~ 28px）</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-lrcsz="15" class="${state.lrcSize === 15 ? 'on' : ''}">小</button>
            <button data-set-lrcsz="18" class="${state.lrcSize === 18 ? 'on' : ''}">标准</button>
            <button data-set-lrcsz="21" class="${state.lrcSize === 21 ? 'on' : ''}">大</button>
            <button data-set-lrcsz="25" class="${state.lrcSize === 25 ? 'on' : ''}">特大</button>
          </div>
          <div class="set-range-wrap">
            <input type="range" id="setLrcSizeRange" min="14" max="28" step="1" value="${state.lrcSize}">
            <span class="set-val-badge" id="setLrcSizeVal">${state.lrcSize}px</span>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">当前句高亮配色</div>
          <div class="set-row-sub">点击预设色圆点或右侧取色器自定义颜色</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-swatches">
            ${lrcColors.map(([c, name]) => `<span class="set-swatch${state.lrcColor.toLowerCase() === c ? ' on' : ''}" data-set-lrccolor="${c}" title="${name}" style="background:${c}"></span>`).join('')}
            <input type="color" id="setLrcColorPicker" value="${esc(state.lrcColor)}" title="自定义颜色" style="width:28px;height:28px;border:0;background:transparent;cursor:pointer">
          </div>
        </div>
      </div>
      <div class="set-preview-box">
        <div id="setLrcPreviewEn" style="font-size:${state.lrcSize + 2}px;color:${esc(state.lrcColor)};font-weight:700">Can we pretend we're not angels through a cable?</div>
        <div id="setLrcPreviewZh" style="font-size:${state.lrcSize}px;color:${esc(state.lrcColor)};font-weight:700;margin-top:4px">我们能否假装自己不是隔着网线相望的天使？</div>
      </div>
    </div>

    <div class="set-card">
      <div class="set-card-head">
        <div>
          <div class="set-card-title">🛠 界面外观与非常用维护工具</div>
          <div class="set-card-desc">将低频工具集中收纳，保持日常听歌界面干净清爽</div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">界面外观主题</div>
          <div class="set-row-sub">切换浅色、深色或跟随系统深浅色</div>
        </div>
        <div class="set-row-ctrl">
          <div class="set-seg">
            <button data-set-theme="auto" class="${state.theme === 'auto' ? 'on' : ''}">跟随系统</button>
            <button data-set-theme="light" class="${state.theme === 'light' ? 'on' : ''}">浅色模式</button>
            <button data-set-theme="dark" class="${state.theme === 'dark' ? 'on' : ''}">深色模式</button>
          </div>
        </div>
      </div>
      <div class="set-row">
        <div class="set-row-main">
          <div class="set-row-label">曲库维护与整理</div>
          <div class="set-row-sub">检测疑似重复歌曲、缺失歌词、缺封面或异常短音频（已累计记录 ${playCountsCount} 首歌播放频次）</div>
        </div>
        <div class="set-row-ctrl">
          <button class="btn-sm primary" id="setOpenHealthBtn">🩺 打开曲库体检</button>
          <button class="btn-sm" id="setFixCoversBtn">✦ 批量补高清封面</button>
          <button class="btn-sm" id="setClearStatsBtn">🧹 清空搜索与播放统计</button>
        </div>
      </div>
    </div>
  </div>`
}
