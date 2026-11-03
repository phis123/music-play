const $ = (s) => document.querySelector(s)

function apply(payload) {
  if (!payload) return
  if (typeof payload.en === 'string') $('#en').textContent = payload.en
  if (typeof payload.zh === 'string') $('#zh').textContent = payload.zh
  // 内容换行时自适应窗口高度
  requestAnimationFrame(() => {
    const h = Math.ceil($('#lines').getBoundingClientRect().height) + 22
    window.api.floatResize(Math.max(96, h))
  })
}

if (window.api?.onFloatUpdate) {
  window.api.onFloatUpdate(apply)
  window.api.onFloatLocked?.((locked) => document.body.classList.toggle('locked', !!locked))
}

$('#bLock')?.addEventListener('click', () => {
  document.body.classList.add('locked')
  window.api.floatLock(true)
})

$('#bClose')?.addEventListener('click', () => window.api.floatClose())
