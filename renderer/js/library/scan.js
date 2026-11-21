/**
 * library/scan.js — 曲库扫描 / 换目录 / 删除文件 / 批量补封面
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { $, audio, cleanTitle } from '../core/dom.js'
import { state } from '../core/state.js'
import { FAV_KEY, RECENT_KEY, favSet, getPlaylists, getRecent, savePlaylists } from '../core/store.js'
import { askConfirm, toast } from '../core/ui.js'
import { finishTask, recordTaskError, startTask, stepTask } from '../core/task.js'
import { waitNavYield } from '../core/nav.js'
import { coverCache } from './cover.js'
import { renderSidebar } from '../views/lists.js'
import { render } from '../views/router.js'


// 扫描进度只订阅一次：主进程经 'library:scan-progress' 推送已处理数/总数，
// 这里据此更新任务条的真实进度（总数在 walk 完成后才知道，之前为不确定进度）。
export let _scanProgressBound = false

export function bindScanProgress() {
  if (_scanProgressBound || !window.api || !window.api.onScanProgress) return
  _scanProgressBound = true
  window.api.onScanProgress((p) => {
    const tk = state.task
    if (!p || tk.kind !== 'scan' || !tk.active) return
    if (p.total) { tk.total = p.total; tk.indet = false }
    stepTask(p.done || 0, `正在读取音频文件与 ID3 标签 (${p.done || 0}/${p.total || '?'})…`)
  })
}


export async function rescan(showFeedback) {
  const prevCount = state.tracks.length
  if (showFeedback) {
    bindScanProgress()
    // 总数未知（walk 尚未完成），先用不确定进度 + “取消”按钮；收到第一条
    // library:scan-progress 后总数与进度条由 bindScanProgress 接管。
    startTask('scan', '正在扫描本地音乐目录…', `正在遍历 ${state.root || '默认音乐目录'}`, 0, true, '取消')
    stepTask(0, `正在读取音频文件与 ID3 标签 (${state.root || ''})…`)
  }
  try {
    const lib = await window.api.scan(state.root)
    state.tracks = lib.tracks || []
    state.root = lib.root || state.root
    if (showFeedback) {
      const diff = state.tracks.length - prevCount
      const diffTxt = diff > 0 ? `新增 ${diff} 首` : diff < 0 ? `减少 ${Math.abs(diff)} 首` : '曲目数量无变化'
      const truncTxt = lib.truncated
        ? ` · 曲库共 ${lib.total} 首，仅显示前 ${state.tracks.length} 首`
        : ''
      if (lib.cancelled) {
        finishTask(`本地音乐扫描已取消（已载入 ${state.tracks.length} 首）`, `${diffTxt} · 目录：${state.root}`, 4200)
      } else if (!state.tracks.length) {
        recordTaskError(state.root || '音乐目录', '该目录下未扫描到支持的音频文件 (.mp3/.flac/.m4a/.wav/.ogg)')
        finishTask('本地音乐扫描完成（共 0 首）', `${diffTxt} · 目录：${state.root}`, 4200)
      } else {
        finishTask(`本地音乐扫描完成（共 ${state.tracks.length} 首${lib.total != null && lib.total !== state.tracks.length ? ` / 全部 ${lib.total} 首` : ''}）`, `${diffTxt}${truncTxt} · 目录：${state.root}`, 4200)
        if (lib.truncated) toast(`曲库共 ${lib.total} 首，仅显示前 ${state.tracks.length} 首`)
      }
    }
  } catch (e) {
    if (showFeedback) {
      recordTaskError(state.root || '音乐目录', '目录扫描失败：' + (e.message || e))
      finishTask('本地音乐扫描失败', e.message || String(e))
    }
  }
}


export async function deleteTrack(t) {
  if (!t || !t.path) return
  if (!(await askConfirm(`删除《${cleanTitle(t.title)}》？\n文件会移到回收站（含歌词/封面）`))) return
  const r = await window.api.remove(t.path)
  if (!r || !r.ok) { toast('删除失败：' + ((r && r.reason) || '未知错误')); return }
  // 清掉本地记录
  const set = favSet(); set.delete(t.path)
  localStorage.setItem(FAV_KEY, JSON.stringify([...set]))
  const rec = getRecent().filter((x) => x.path !== t.path)
  localStorage.setItem(RECENT_KEY, JSON.stringify(rec))
  const pls = getPlaylists()
  for (const p of pls) p.tracks = p.tracks.filter((x) => x.path !== t.path)
  savePlaylists(pls)
  if (state.cur >= 0 && state.tracks[state.cur] && state.tracks[state.cur].path === t.path) {
    audio.pause()
    audio.removeAttribute('src')
    state.cur = -1
  }
  await rescan()
  renderSidebar()
  render()
}


export async function fixCovers() {
  const btn = $('#btnFixCover')
  if (btn) { btn.disabled = true; btn.textContent = '处理中…' }
  const total = state.tracks.length
  if (!total) {
    toast('当前曲库为空')
    if (btn) { btn.disabled = false; btn.textContent = '补高清封面' }
    return
  }
  window.__deskCoverStop = false
  startTask('cover', '正在匹配高清封面…', `准备检查 ${total} 首本地曲目`, total, false, '停止')
  let done = 0, step = 0
  for (const t of state.tracks) {
    if (window.__deskCoverStop) break
    await waitNavYield()
    step++
    stepTask(step, `正在匹配封面 (${step}/${total})：${cleanTitle(t.title)}`)
    try {
      const r = await window.api.coverFix([t])
      if (r && r.done > 0) {
        done += r.done
        coverCache.delete(t.path)
      } else if (r && Array.isArray(r.errors) && r.errors.length) {
        r.errors.forEach((er) => recordTaskError(er.name, er.reason))
      }
    } catch (e) {
      recordTaskError(cleanTitle(t.title), '封面下载失败：' + (e.message || e))
    }
  }
  await rescan(false)
  finishTask(
    window.__deskCoverStop ? '高清封面补齐已停止' : '高清封面匹配完成',
    `新补齐 ${done} 张封面（检查 ${step} 首）${state.task.errors.length ? ` · 失败 ${state.task.errors.length} 首` : ''}`,
    5000
  )
  render()
}


export async function pickRoot() {
  const dir = await window.api.pickFolder()
  if (!dir) return
  state.root = dir
  await rescan(true)
  render()
}
