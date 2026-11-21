/**
 * core/ui.js — 提示层与通用对话框（toast / askDialog），提示层不入 overflow 容器
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { $ } from './dom.js'


/* ---------------- 轻提示（替代 alert：不阻塞、自动消失） ---------------- */
export let __toastHost = null

export function toast(msg, ms) {
  if (!__toastHost) {
    __toastHost = document.createElement('div')
    __toastHost.id = 'toastHost'
    document.body.appendChild(__toastHost)
  }
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = String(msg == null ? '' : msg)
  __toastHost.appendChild(el)
  setTimeout(() => {
    el.classList.add('out')
    setTimeout(() => el.remove(), 240)
  }, ms || 2600)
}

/* ---------------- 通用对话框（Electron 不支持 window.prompt，必须自己实现） ---------------- */
export function askDialog(opt) {
  return new Promise((resolve) => {
    const dlg = $('#askDlg')
    if (!dlg) { resolve(opt.input ? null : false); return }
    dlg.querySelector('.ask-title').textContent = opt.title || ''
    const msg = dlg.querySelector('.ask-msg')
    msg.textContent = opt.message || ''
    msg.style.display = opt.message ? '' : 'none'
    const inp = dlg.querySelector('.ask-input')
    inp.value = opt.value || ''
    inp.style.display = opt.input ? '' : 'none'
    dlg.querySelector('.ask-btn:not(.ghost)').textContent = opt.okText || '确定'
    const onClose = () => {
      dlg.removeEventListener('close', onClose)
      const ok = dlg.returnValue === 'ok'
      resolve(ok ? (opt.input ? inp.value.trim() : true) : (opt.input ? null : false))
    }
    dlg.returnValue = ''
    dlg.addEventListener('close', onClose)
    if (dlg.open) dlg.close()
    dlg.showModal()
    if (opt.input) setTimeout(() => { inp.focus(); inp.select() }, 30)
  })
}

export const askText = (title, value) => askDialog({ title, input: true, value })

export const askConfirm = (text) => {
  // confirm 的文案一般带换行：首行当标题，其余当说明，排版更像原生确认框
  const parts = String(text || '').split('\n')
  const title = parts.shift() || ''
  return askDialog({ title, message: parts.join('\n'), okText: '确定' })
}
