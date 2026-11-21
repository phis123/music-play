/**
 * library/cover.js — 封面 LRU 缓存（COVER_CACHE_MAX=240）与取图队列
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */


/* ---------------- 封面加载队列（限并发） ---------------- */
export const coverQ = []

export let coverBusy = 0

export const coverCache = new Map()

export const COVER_CACHE_MAX = 240

/** 写入封面缓存并做 LRU 淘汰，避免几千首曲库把渲染进程内存吃满 */
export function cacheCover(path, url) {
  if (!path) return url
  if (coverCache.has(path)) coverCache.delete(path)
  coverCache.set(path, url)
  if (coverCache.size > COVER_CACHE_MAX) {
    const first = coverCache.keys().next().value
    if (first !== undefined) coverCache.delete(first)
  }
  return url
}


export function pumpCover() {
  while (coverBusy < 3 && coverQ.length) {
    const job = coverQ.shift()
    coverBusy++
    const finish = () => { coverBusy--; pumpCover() }
    if (coverCache.has(job.path)) {
      job.apply(coverCache.get(job.path))
      coverBusy--
      continue
    }
    window.api.cover(job.path).then((url) => {
      cacheCover(job.path, url)
      job.apply(url)
    }).catch(() => {}).finally(finish)
  }
}

export function loadCover(path, apply) {
  coverQ.push({ path, apply })
  pumpCover()
}

export const setCover = (el, url) => {
  if (!el) return
  if (url) {
    el.style.backgroundImage = `url("${url}")`
    el.style.backgroundSize = 'cover'
    el.style.backgroundPosition = 'center'
    el.classList.add('has-cover')
  } else {
    el.style.backgroundImage = ''
    el.classList.remove('has-cover')
  }
}
