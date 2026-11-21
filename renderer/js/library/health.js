/**
 * library/health.js — 曲库体检（重复/缺歌词/缺标签/异常短音频）与一键修复
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { $, cleanTitle, esc } from '../core/dom.js'
import { state } from '../core/state.js'
import { finishTask, recordTaskError, startTask, stepTask } from '../core/task.js'
import { waitNavYield } from '../core/nav.js'
import { coverCache } from './cover.js'
import { rescan } from './scan.js'
import { trackRowHtml } from '../views/lists.js'
import { normKey } from '../views/sheet.js'
import { render } from '../views/router.js'


/* ---------------- 曲库体检视图 (Phase 3) ---------------- */
export function analyzeLibraryHealth() {
  const byKey = new Map()
  const dupSet = new Set()
  const noLrc = []
  const noMeta = []
  const shortClips = []
  for (const t of state.tracks) {
    const k = normKey(cleanTitle(t.title))
    if (k) {
      if (!byKey.has(k)) byKey.set(k, [])
      byKey.get(k).push(t)
    }
    if (!t.hasLrc) noLrc.push(t)
    if (!t.artist || (t.bitrate && t.bitrate < 128)) noMeta.push(t)
    const d = +(t.duration || 0)
    if (d > 0 && d < 25) shortClips.push(t)
  }
  const dups = []
  for (const [, group] of byKey) {
    if (group.length > 1) {
      group.forEach((x) => { if (!dupSet.has(x.path)) { dupSet.add(x.path); dups.push(x) } })
    }
  }
  return { dups, noLrc, noMeta, shortClips }
}


export function viewHealth() {
  const h = analyzeLibraryHealth()
  const tab = state.healthTab || 'dup'
  const cards = [
    ['dup', '疑似重复', h.dups.length],
    ['lrc', '缺少歌词', h.noLrc.length],
    ['meta', '缺歌手/低码率', h.noMeta.length],
    ['short', '异常短音频(<25s)', h.shortClips.length],
  ]
  const curList = tab === 'dup' ? h.dups : tab === 'lrc' ? h.noLrc : tab === 'meta' ? h.noMeta : h.shortClips
  const descMap = {
    dup: '同名或高度相似的本地音频文件，可对比时长/码率后清理多余副本',
    lrc: '尚未匹配到旁挂 .lrc 歌词的曲目，可点右上角「一键补齐缺失歌词与封面」',
    meta: '缺少歌手标签或码率低于 128kbps 的曲目，可播放后点「换源」替换为高音质版本',
    short: '时长不足 25 秒的音频（可能是试听片段或损坏文件），可播放后点「换源」重下',
  }
  return `<div class="health-wrap">
    <div class="page-head">
      <div>
        <div class="page-title">曲库体检</div>
        <div class="page-sub">共扫描 ${state.tracks.length} 首本地音频 · ${esc(state.root)}</div>
      </div>
      <div class="page-actions">
        <button id="btnHealthFixAll" class="btn-sm primary">一键补齐缺失歌词与封面</button>
      </div>
    </div>
    <div class="health-grid">
      ${cards.map(([k, lbl, cnt]) => `
        <div class="health-stat${tab === k ? ' on' : ''}" data-health-tab="${k}">
          <div class="health-stat-num">${cnt}</div>
          <div class="health-stat-label">${lbl}</div>
        </div>`).join('')}
    </div>
    <div class="page-sub" style="margin-bottom:10px">${descMap[tab] || ''}</div>
    ${curList.length
      ? `<div class="tracklist">${curList.map((t, i) => trackRowHtml(t, state.tracks.indexOf(t), i + 1)).join('')}</div>`
      : `<div class="empty-note" style="padding:56px 0"><div class="big">太棒了，这一项没有发现问题</div><div>曲库状态非常健康</div></div>`}
  </div>`
}


export async function healthFixAll() {
  const btn = $('#btnHealthFixAll')
  if (btn) { btn.disabled = true; btn.textContent = '正在补齐…' }
  const total = state.tracks.length
  if (!total) return
  window.__deskHealthStop = false
  startTask('healthfix', '正在补齐缺失歌词与高清封面…', `共扫描 ${total} 首曲目`, total, false, '停止')
  let lrcDone = 0, covDone = 0, step = 0
  for (const t of state.tracks) {
    if (window.__deskHealthStop) break
    await waitNavYield()
    step++
    stepTask(step, `正在处理 (${step}/${total})：${cleanTitle(t.title)}`)
    if (!t.hasLrc) {
      try {
        const r = await window.api.autoLyric({ title: cleanTitle(t.title), artist: t.artist, filePath: t.path })
        if (r && r.ok) {
          t.hasLrc = true
          lrcDone++
        } else {
          recordTaskError(cleanTitle(t.title), '歌词补齐失败：' + ((r && r.reason) || '未搜到匹配歌词'))
        }
      } catch (e) {
        recordTaskError(cleanTitle(t.title), '歌词接口错误：' + (e.message || e))
      }
    }
    try {
      const cr = await window.api.coverFix([t])
      if (cr && cr.done > 0) {
        covDone += cr.done
        coverCache.delete(t.path)
      } else if (cr && Array.isArray(cr.errors) && cr.errors.length) {
        cr.errors.forEach((er) => recordTaskError(er.name, er.reason))
      }
    } catch (e) {
      recordTaskError(cleanTitle(t.title), '封面补齐错误：' + (e.message || e))
    }
  }
  await rescan(false)
  finishTask(
    window.__deskHealthStop ? '曲库修复已停止' : '曲库体检修复完成',
    `新补齐歌词 ${lrcDone} 首，高清封面 ${covDone} 张${state.task.errors.length ? ` · 异常/未匹配 ${state.task.errors.length} 项` : ''}`,
    5500
  )
  render()
}
