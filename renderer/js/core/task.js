/**
 * core/task.js — 任务横幅（扫描/封面/导入/体检 的进度、错误、停止）
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { esc } from './dom.js'
import { state } from './state.js'
import { renderSheetDialog } from '../views/sheet.js'


export let _taskAutoHideTimer = null

export function startTask(kind, title, sub, total, indet, stopLabel) {
  clearTimeout(_taskAutoHideTimer)
  state.task = {
    active: true,
    kind: kind || '',
    title: title || '正在处理…',
    sub: sub || '',
    done: 0,
    total: total || 0,
    ok: 0,
    fail: 0,
    errors: [],
    indet: !!indet,
    stopLabel: stopLabel || '',
  }
  updateTaskBanner()
}


export function stepTask(done, sub) {
  const tk = state.task
  if (done != null) tk.done = done
  if (sub != null) tk.sub = sub
  updateTaskBanner()
}


export function recordTaskError(name, reason) {
  const tk = state.task
  tk.fail = (tk.fail || 0) + 1
  tk.errors.push({ name: String(name || '未知项'), reason: String(reason || '未知错误') })
  updateTaskBanner()
}


export function finishTask(title, sub, autoHideMs) {
  const tk = state.task
  tk.active = false
  tk.indet = false
  tk.done = tk.total || 1
  tk.total = tk.total || 1
  if (title) tk.title = title
  if (sub != null) tk.sub = sub
  updateTaskBanner()
  clearTimeout(_taskAutoHideTimer)
  if (!tk.errors.length && autoHideMs !== 0) {
    _taskAutoHideTimer = setTimeout(() => {
      if (!state.task.active && !state.task.errors.length) dismissTask()
    }, autoHideMs || 4200)
  }
}


export function dismissTask() {
  clearTimeout(_taskAutoHideTimer)
  state.task = { active: false, kind: '', title: '', sub: '', done: 0, total: 0, ok: 0, fail: 0, errors: [], indet: false, stopLabel: '' }
  const box = document.getElementById('taskBanner')
  if (box) { box.classList.add('hidden'); box.innerHTML = '' }
}


export function updateTaskBanner() {
  const box = document.getElementById('taskBanner')
  if (!box) return
  const tk = state.task
  if (!tk.active && !tk.title) {
    box.classList.add('hidden')
    return
  }
  box.classList.remove('hidden')
  box.classList.toggle('has-err', tk.errors.length > 0 && !tk.active)
  const pct = tk.total > 0 ? Math.min(100, Math.round((tk.done * 100) / tk.total)) : (tk.active ? 35 : 100)
  const errBtn = tk.errors.length
    ? `<button class="task-btn warn" data-task-err="1">报错详情 (${tk.errors.length})</button>`
    : ''
  const stopBtn = tk.active && tk.stopLabel
    ? `<button class="task-btn" data-task-stop="1">${esc(tk.stopLabel)}</button>`
    : ''
  const closeBtn = !tk.active
    ? `<button class="task-btn" data-task-dismiss="1">关闭</button>`
    : ''

  if (!box.querySelector('.task-top')) {
    box.innerHTML = `
      <div class="task-top">
        <div style="flex:1;min-width:0">
          <div class="task-title" id="tbTitle"></div>
          <div class="task-sub" id="tbSub"></div>
        </div>
        <div class="task-acts" id="tbActs"></div>
      </div>
      <div class="task-track"><div class="task-bar" id="tbBar"></div></div>`
  }
  const tEl = document.getElementById('tbTitle')
  const sEl = document.getElementById('tbSub')
  const aEl = document.getElementById('tbActs')
  const bEl = document.getElementById('tbBar')
  if (tEl) tEl.textContent = tk.title + (tk.total > 0 && tk.active ? ` (${tk.done}/${tk.total})` : '')
  if (sEl) sEl.textContent = tk.sub || ''
  if (aEl) aEl.innerHTML = errBtn + stopBtn + closeBtn
  if (bEl) {
    bEl.classList.toggle('indet', !!tk.indet && tk.active)
    bEl.style.width = pct + '%'
  }
}


export function openTaskErrorDialog() {
  state.sheetKind = 'taskerr'
  renderSheetDialog()
}
