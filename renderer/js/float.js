const $ = (s) => document.querySelector(s)
const $$ = (s) => Array.from(document.querySelectorAll(s))

const S = {
  color: localStorage.getItem('lyColor') || '#ffffff',
  size: Math.min(44, Math.max(14, +(localStorage.getItem('lySize') || 22))),
}

/* ---------- 样式 ---------- */
function applyStyle(save) {
  document.documentElement.style.setProperty('--ly-color', S.color)
  document.documentElement.style.setProperty('--ly-size', S.size + 'px')
  $('#szVal').textContent = S.size
  $$('.sw').forEach((el) => el.classList.toggle('on', el.dataset.c === S.color))
  if (save) {
    localStorage.setItem('lyColor', S.color)
    localStorage.setItem('lySize', String(S.size))
  }
  resize()
}

// 固定窗口高度：不再按内容动态改高度（会导致字幕抖动）
function resize() {}

let lastKey = ''

/* ---------- 数据 ---------- */
function apply(payload) {
  if (!payload) return
  const t = [payload.title, payload.artist].filter(Boolean).join(' · ')
  const key = t + '\u0001' + (payload.en || '') + '\u0001' + (payload.zh || '')
  if (key === lastKey) return          // 内容没变就不动 DOM，避免重绘抖动
  lastKey = key
  $('#title').textContent = t
  $('#en').textContent = payload.en || ''
  $('#zh').textContent = payload.zh || ''
}

/* ---------- 事件 ---------- */
window.api?.onFloatUpdate?.(apply)
window.api?.onFloatLocked?.((locked) => document.body.classList.toggle('locked', !!locked))

$('#bPrev')?.addEventListener('click', () => window.api.floatCmd('prev'))
$('#bNext')?.addEventListener('click', () => window.api.floatCmd('next'))
$('#bClose')?.addEventListener('click', () => window.api.floatClose())
$('#bLock')?.addEventListener('click', () => {
  document.body.classList.add('locked')
  window.api.floatLock(true)
})

$('#bStyle')?.addEventListener('click', (e) => {
  e.stopPropagation()
  $('#panel').classList.toggle('hidden')
})
document.addEventListener('click', (e) => {
  if (!$('#panel').contains(e.target) && e.target.id !== 'bStyle') $('#panel').classList.add('hidden')
})

$$('.sw').forEach((el) => el.addEventListener('click', () => {
  S.color = el.dataset.c
  applyStyle(true)
}))
$('#szDown')?.addEventListener('click', () => { S.size = Math.max(14, S.size - 2); applyStyle(true) })
$('#szUp')?.addEventListener('click', () => { S.size = Math.min(44, S.size + 2); applyStyle(true) })

window.addEventListener('resize', resize)
applyStyle(false)
