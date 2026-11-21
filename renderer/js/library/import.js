/**
 * library/import.js — 批量导入（解析分享链接 → 匹配播客声源 → 批量下载）
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { $, cleanTitle, esc, fmt, fmtPlays } from '../core/dom.js'
import { state } from '../core/state.js'
import { askText, toast } from '../core/ui.js'
import { finishTask, recordTaskError, startTask, stepTask } from '../core/task.js'
import { cancelImpChunks, setImpChunkRaf, waitNavYield } from '../core/nav.js'
import { rescan } from './scan.js'
import { normKey, scoreVoiceCand } from '../views/sheet.js'
import { render } from '../views/router.js'


/* ---------------- 批量导入（防卡顿分片渲染 + 匹配进度条 + 错误收集 + 节流持久化） ---------------- */
export const imp = {
  link: '', loading: false, matching: false, matchDone: 0, matchTotal: 0,
  name: '', items: [], err: '', busy: false, done: 0, total: 0,
  open: -1, prevId: '', filter: 'all',
}


export let _impSaveTimer = null

export function scheduleSaveImpState(immediate) {
  clearTimeout(_impSaveTimer)
  if (immediate) {
    saveImpState()
    return
  }
  _impSaveTimer = setTimeout(saveImpState, 2200)
}


export function saveImpState() {
  clearTimeout(_impSaveTimer)
  try {
    if (!imp.items.length && !imp.link) {
      localStorage.removeItem('desk:imp')
      return
    }
    const slim = imp.items.slice(0, 1000).map((it, idx) => ({
      _idx: idx,
      song: it.song,
      voices: (it.voices || []).slice(0, 12),
      pick: it.pick != null ? it.pick : 0,
      skip: !!it.skip,
      done: !!it.done,
      manual: !!it.manual,
      suspect: !!it.suspect,
      suspectWhy: it.suspectWhy || '',
      customKw: it.customKw || '',
      err: it.err || '',
    }))
    localStorage.setItem('desk:imp', JSON.stringify({ link: imp.link, name: imp.name, items: slim }))
  } catch { }
}


export function restoreImpState() {
  try {
    const raw = JSON.parse(localStorage.getItem('desk:imp') || 'null')
    if (!raw || !Array.isArray(raw.items)) return
    imp.link = raw.link || ''
    imp.name = raw.name || ''
    imp.items = raw.items.map((it, idx) => {
      const row = { ...it, _idx: idx, running: false, searching: false }
      if (row.voices && row.voices.length && !row.manual) {
        evaluateImpItem(row)
      }
      return row
    })
  } catch { }
}


export function parseShareLink(text) {
  const t = String(text || '')
  const mp = t.match(/playlist[^0-9]{0,12}(\d{5,})/) || t.match(/playlist\/(\d+)/)
  const ms = t.match(/song[^0-9]{0,12}(\d{5,})/) || t.match(/song\/(\d+)/)
  if (mp) return { type: 'playlist', id: mp[1] }
  if (ms) return { type: 'song', id: ms[1] }
  const m = t.match(/(\d{6,})/)
  if (m) return { type: 'playlist', id: m[1] }
  return null
}


export function evaluateImpItem(it) {
  if (!it.voices || !it.voices.length) {
    it.pick = -1
    it.suspect = false
    it.suspectWhy = ''
    return
  }
  const scored = it.voices.map((v, idx) => ({ ...scoreVoiceCand(it.song, v), idx })).sort((a, b) => b.score - a.score)
  const best = scored.find((x) => !x.bad)
  if (best) {
    it.pick = best.idx
    it.suspect = false
    it.suspectWhy = ''
  } else {
    it.pick = scored[0].idx
    it.suspect = true
    it.suspectWhy = scored[0].why || '时长不符·待确认'
  }
}


export function firstArtistClean(a) {
  const raw = String(a || '').split(/[\/、,&]|feat\.?\s*/i).map((x) => x.trim()).filter(Boolean)[0] || ''
  return raw.replace(/\s*[（(【\[].*?[）)】\]]\s*/g, ' ').trim() || raw
}


export function candStripHtml(it, i) {
  const list = it.voices || []
  const fa = firstArtistClean(it.song.artist)
  const defKw = it.customKw || [it.song.name, fa].filter(Boolean).join(' ').trim()
  const rowsHtml = it.searching
    ? '<div class="search-hint" style="padding:14px">正在网易云播客中搜索匹配声音…</div>'
    : !list.length
      ? '<div class="search-hint" style="padding:14px">暂无候选声音，可在上方输入框修改关键词或点击右侧快捷按钮搜索</div>'
      : list.map((v, k) => {
          const sc = scoreVoiceCand(it.song, v)
          const sel = it.pick === k && !it.suspect && !it.skip
          const isPv = imp.prevId && String(imp.prevId) === String(v.mainTrackId)
          const gapAbs = sc.gap == null ? null : Math.abs(sc.gap)
          const gapBadge = gapAbs == null
            ? ''
            : gapAbs <= 3
              ? '<span class="imp-cand-badge ok">时长一致</span>'
              : gapAbs <= 15
                ? `<span class="imp-cand-badge">差 ${fmt(gapAbs)}</span>`
                : `<span class="imp-cand-badge warn">差 ${fmt(gapAbs)}</span>`
          const authorTxt = [v.dj ? `by ${v.dj}` : '', v.radio || ''].filter(Boolean).join(' · ') || '未知来源'
          const playsTxt = v.plays ? ` · ${fmtPlays(v.plays)}播放` : ''
          return `<div class="imp-cand-row${sel ? ' sel' : ''}" data-imp-pick="${i}:${k}">
            <div class="imp-cand-cov" style="background-image:url('${esc(v.cover || '')}')">
              <button class="imp-cand-play${isPv ? ' on' : ''}" data-imp-pv="${i}:${k}" title="试听声源">${isPv ? '❚❚' : '▶'}</button>
            </div>
            <div class="imp-cand-body">
              <div class="imp-cand-t">${esc(String(v.title || '未命名').replace(/^声音[:：]?\s*/, ''))}</div>
              <div class="imp-cand-s">${esc(authorTxt)}${esc(playsTxt)}</div>
            </div>
            <div class="imp-cand-meta">
              <span class="imp-cand-dur">${fmt(v.duration)}</span>
              ${gapBadge}
              <button class="btn-sm${sel ? ' primary' : ''}" data-imp-pick="${i}:${k}">${sel ? '已选用' : '选用'}</button>
            </div>
          </div>`
        }).join('')

  return `<div class="imp-swap-panel" data-panel="${i}">
    <div class="imp-swap-head">
      <div class="imp-swap-search">
        <input type="search" class="imp-kw-in" id="impkw-${i}" data-imp-kwin="${i}" value="${esc(defKw)}" placeholder="输入歌名 / 歌手 / 别名搜索网易云声音（回车直达）…">
        <button class="btn-sm primary" data-imp-kwgo="${i}" ${it.searching ? 'disabled' : ''}>${it.searching ? '搜索中…' : '搜索声音'}</button>
      </div>
      <div class="imp-swap-chips">
        <button class="imp-kw-chip" data-imp-kwpreset="${i}:name" title="仅按歌名搜索">仅搜歌名</button>
        ${fa ? `<button class="imp-kw-chip" data-imp-kwpreset="${i}:both" title="按「歌名 + 精简歌手名」搜索">歌名+歌手</button>` : ''}
        ${fa ? `<button class="imp-kw-chip" data-imp-kwpreset="${i}:artist" title="仅按歌手名搜索">仅搜歌手</button>` : ''}
        <button class="imp-kw-chip" data-imp-kwpreset="${i}:smart" title="多关键词组合智能搜索">智能重搜</button>
        <span class="imp-swap-ref">原曲 ${fmt(it.song.duration)} · 候选 ${list.length} 条</span>
      </div>
    </div>
    <div class="imp-swap-list">${rowsHtml}</div>
  </div>`
}


export function impRowStatusHtml(it) {
  const v = it.pick >= 0 && it.voices ? it.voices[it.pick] : null
  if (it.skip && it.err) return `<span class="imp-st warn" title="${esc(it.err)}">失败·${esc(it.err.slice(0, 12))}</span>`
  if (it.skip) return '<span class="imp-st skip">已跳过</span>'
  if (it.done) return '<span class="imp-st ok">已下载</span>'
  if (it.running) return '<span class="imp-st">下载中…</span>'
  if (it.matching) return '<span class="imp-st">匹配中…</span>'
  if (it.suspect) return `<span class="imp-st warn">${esc(it.suspectWhy || '待确认')}</span>`
  if (v) return '<span class="imp-st">已匹配</span>'
  if (it.err) return `<span class="imp-st warn">${esc(it.err)}</span>`
  return `<span class="imp-st warn">${imp.matching ? '待匹配' : '未找到'}</span>`
}


export function impRowSubHtml(it) {
  const v = it.pick >= 0 && it.voices ? it.voices[it.pick] : null
  if (v) {
    const cleanVt = String(v.title || '').replace(/^声音[:：]?\s*/, '')
    const subMeta = [v.dj ? `by ${v.dj}` : '', v.radio || '', fmt(v.duration), `原曲 ${fmt(it.song.duration)}`].filter(Boolean).join(' · ')
    return `<div class="imp-v">${esc(cleanVt)}<span class="imp-v-sub">${esc(subMeta)}</span></div>`
  }
  if (it.err) return `<div class="imp-v muted" style="color:var(--red)">错误：${esc(it.err)}</div>`
  return `<div class="imp-v muted">${imp.matching && !it._matchedOnce ? '等待搜索匹配播客声源…' : '没有可用候选项（点右侧「换源」手动搜索匹配）'}</div>`
}


export function importRowHtml(it, i) {
  if (i == null) i = it._idx != null ? it._idx : imp.items.indexOf(it)
  const row = `<div class="imp-row" id="improw-${i}">
    <div class="imp-main">
      <div class="imp-name">${i + 1}. ${esc(it.song.name)}<span class="imp-artist">${esc(it.song.artist || '')}</span></div>
      <div id="impsub-${i}">${impRowSubHtml(it)}</div>
    </div>
    <div class="imp-right"><span id="impst-${i}">${impRowStatusHtml(it)}</span>
      <button class="btn-sm" id="impswap-${i}" data-imp-swap="${i}" ${it.running || it.done ? 'disabled' : ''}>${imp.open === i ? '收起' : '换源'}</button>
      <button class="btn-sm" id="impskip-${i}" data-imp-skip="${i}" ${it.done ? 'disabled' : ''}>${it.skip ? '恢复' : '跳过'}</button>
    </div>
  </div>`
  return imp.open === i ? row + candStripHtml(it, i) : row
}


export function isImpItemPending(x) {
  return !x.done && (x.skip || x.suspect || x.pick < 0 || !x.voices || !x.voices.length)
}


export function updateSingleImpRow(i) {
  if (location.hash !== '#/import') return
  const it = imp.items[i]
  if (!it) return
  const stEl = document.getElementById('impst-' + i)
  if (stEl) stEl.innerHTML = impRowStatusHtml(it)
  const subEl = document.getElementById('impsub-' + i)
  if (subEl) subEl.innerHTML = impRowSubHtml(it)
  const swBtn = document.getElementById('impswap-' + i)
  if (swBtn) swBtn.disabled = !!(it.running || it.done)
  const skBtn = document.getElementById('impskip-' + i)
  if (skBtn) {
    skBtn.disabled = !!it.done
    skBtn.textContent = it.skip ? '恢复' : '跳过'
  }
  updateImpHeaderInPlace()
}


export function updateImpHeaderInPlace() {
  if (location.hash !== '#/import') return
  const total = imp.items.length
  const usable = imp.items.filter((x) => !x.skip && !x.done && !x.suspect && x.pick >= 0 && x.voices && x.voices[x.pick]).length
  const suspectCnt = imp.items.filter(isImpItemPending).length
  const doneCnt = imp.items.filter((x) => x.done).length
  const subEl = document.getElementById('impPageSub')
  if (subEl && imp.name) {
    subEl.textContent = `${imp.name} · 共 ${total} 首 · 可直接下载 ${usable} 首${suspectCnt ? ` · 待确认/未匹配 ${suspectCnt} 首（点「换源」搜索或挑选）` : ''}`
  }
  const allBtn = document.getElementById('impAll')
  if (allBtn) {
    allBtn.textContent = `下载全部（${usable}）`
    allBtn.style.display = (usable && !imp.busy) ? '' : 'none'
  }
  const fAll = document.querySelector('[data-imp-filter="all"]')
  if (fAll) fAll.textContent = `全部 (${total})`
  const fSus = document.querySelector('[data-imp-filter="suspect"]')
  if (fSus) fSus.textContent = `待确认 (${suspectCnt})`
  const fRdy = document.querySelector('[data-imp-filter="ready"]')
  if (fRdy) fRdy.textContent = `可下载 (${usable})`
  const fDone = document.querySelector('[data-imp-filter="done"]')
  if (fDone) fDone.textContent = `已下载 (${doneCnt})`
  const mBar = document.getElementById('impMatchBar')
  const mTxt = document.getElementById('impMatchTxt')
  if (mBar && imp.matchTotal > 0) mBar.style.width = Math.round((imp.matchDone * 100) / imp.matchTotal) + '%'
  if (mTxt) mTxt.textContent = `正在匹配播客声源 ${imp.matchDone} / ${imp.matchTotal}…`
  const dBar = document.getElementById('impDlBar')
  const dTxt = document.getElementById('impDlTxt')
  if (dBar && imp.total > 0) dBar.style.width = Math.round((imp.done * 100) / imp.total) + '%'
  if (dTxt) dTxt.textContent = `正在批量下载音频 ${imp.done} / ${imp.total}…`
}


export function filteredDeskImportItems() {
  const f = imp.filter || 'all'
  if (f === 'suspect') return imp.items.filter(isImpItemPending)
  if (f === 'ready') return imp.items.filter((x) => !x.skip && !x.done && !x.suspect && x.pick >= 0 && x.voices && x.voices[x.pick])
  if (f === 'done') return imp.items.filter((x) => x.done)
  if (f === 'err') return imp.items.filter((x) => x.err)
  return imp.items
}


export const DESK_IMP_FIRST_CHUNK = 35

export const DESK_IMP_NEXT_CHUNK = 45


export function viewImport() {
  const total = imp.items.length
  const usable = imp.items.filter((x) => !x.skip && !x.done && !x.suspect && x.pick >= 0 && x.voices && x.voices[x.pick]).length
  const suspectCnt = imp.items.filter(isImpItemPending).length
  const doneCnt = imp.items.filter((x) => x.done).length
  const errCnt = imp.items.filter((x) => x.err).length
  const list = filteredDeskImportItems()
  const firstSlice = list.slice(0, DESK_IMP_FIRST_CHUNK)
  const body = imp.loading
    ? '<div class="imp-q"><div class="imp-q-track"><div class="imp-q-bar" style="width:45%"></div></div><div class="imp-q-text">正在解析分享链接与歌单曲目…</div></div>'
    : imp.err ? `<div class="search-hint" style="color:var(--red)">${esc(imp.err)}</div>`
    : total ? `<div class="imp-list" id="impListBox">${firstSlice.map((it) => importRowHtml(it, it._idx)).join('')}</div>`
    : '<div class="search-hint">粘贴网易云歌单/歌曲分享链接，自动匹配播客声音</div>'
  const subTxt = imp.name
    ? `${imp.name} · 共 ${total} 首 · 可直接下载 ${usable} 首${suspectCnt ? ` · 待确认/未匹配 ${suspectCnt} 首（点「换源」挑选）` : ''}`
    : '粘贴分享链接（歌单或单曲），自动比对标题与时长并过滤翻唱/片段'
  const matchProg = imp.matching
    ? `<div class="imp-q" id="impMatchWrap">
        <div class="imp-q-track"><div class="imp-q-bar" id="impMatchBar" style="width:${imp.matchTotal ? Math.round((imp.matchDone * 100) / imp.matchTotal) : 0}%"></div></div>
        <div class="imp-q-text" id="impMatchTxt">正在匹配播客声源 ${imp.matchDone} / ${imp.matchTotal}…</div>
      </div>`
    : ''
  const dlProg = imp.busy
    ? `<div class="imp-q" id="impDlWrap">
        <div class="imp-q-track"><div class="imp-q-bar" id="impDlBar" style="width:${imp.total ? Math.round((imp.done * 100) / imp.total) : 0}%"></div></div>
        <div class="imp-q-text" id="impDlTxt">正在批量下载音频 ${imp.done} / ${imp.total}…</div>
      </div>`
    : ''
  const filters = total ? `<div class="imp-filter-bar">
      <button class="sort-pill${imp.filter === 'all' ? ' on' : ''}" data-imp-filter="all">全部 (${total})</button>
      <button class="sort-pill${imp.filter === 'suspect' ? ' on' : ''}" data-imp-filter="suspect">待确认 (${suspectCnt})</button>
      <button class="sort-pill${imp.filter === 'ready' ? ' on' : ''}" data-imp-filter="ready">可下载 (${usable})</button>
      <button class="sort-pill${imp.filter === 'done' ? ' on' : ''}" data-imp-filter="done">已下载 (${doneCnt})</button>
      ${errCnt ? `<button class="sort-pill${imp.filter === 'err' ? ' on' : ''}" data-imp-filter="err">异常 (${errCnt})</button>` : ''}
    </div>` : ''
  return `<div class="page-head">
      <div>
        <div class="page-title">批量导入</div>
        <div class="page-sub" id="impPageSub">${esc(subTxt)}</div>
      </div>
    </div>
    <div class="imp-bar">
      <input id="impLink" value="${esc(imp.link)}" placeholder="https://music.163.com/playlist?id=...">
      <button id="impParse" class="btn-sm primary" ${imp.loading ? 'disabled' : ''}>${total ? '重新解析' : '解析'}</button>
      <button id="impAll" class="btn-sm primary" style="${usable && !imp.busy ? '' : 'display:none'}">下载全部（${usable}）</button>
      ${imp.matching ? `<button id="impMatchStop" class="btn-sm">暂停匹配</button>` : ''}
      ${!imp.matching && suspectCnt > 0 && !imp.busy ? `<button id="impMatchResume" class="btn-sm" title="使用优化后的匹配引擎重新匹配所有待确认/未找到/已跳过的歌曲">重匹待确认 (${suspectCnt})</button>` : ''}
      ${imp.busy ? `<button id="impStop" class="btn-sm">停止下载 (${imp.done}/${imp.total})</button>` : ''}
      ${total && !imp.busy && !imp.matching ? `<button id="impClear" class="btn-sm">清空列表</button>` : ''}
    </div>
    ${matchProg}
    ${dlProg}
    ${filters}
    ${body}`
}


export function mountImportRowsChunked() {
  cancelImpChunks()
  const box = document.getElementById('impListBox')
  if (!box) return
  const list = filteredDeskImportItems()
  if (list.length <= DESK_IMP_FIRST_CHUNK) return
  let offset = DESK_IMP_FIRST_CHUNK
  const step = () => {
    if (location.hash !== '#/import') { setImpChunkRaf(0); return }
    const b = document.getElementById('impListBox')
    if (!b) { setImpChunkRaf(0); return }
    const slice = list.slice(offset, offset + DESK_IMP_NEXT_CHUNK)
    if (!slice.length) { setImpChunkRaf(0); return }
    b.insertAdjacentHTML('beforeend', slice.map((it) => importRowHtml(it, it._idx)).join(''))
    offset += slice.length
    if (offset < list.length) {
      setImpChunkRaf(requestAnimationFrame(step))
    } else {
      setImpChunkRaf(0)
    }
  }
  setImpChunkRaf(requestAnimationFrame(step))
}


export async function doImportParse() {
  const link = ($('#impLink')?.value || imp.link || '').trim()
  const parsed = parseShareLink(link)
  window.__deskImpMatchStop = true
  imp.link = link
  imp.items = []
  imp.err = ''
  imp.open = -1
  imp.filter = 'all'
  if (!parsed) {
    imp.err = '没识别出歌单/歌曲 ID，请检查链接格式'
    startTask('impparse', '解析链接失败', imp.err, 1, false)
    recordTaskError(link || '空链接', imp.err)
    finishTask('解析链接失败', imp.err)
    render()
    return
  }
  imp.loading = true
  startTask('impparse', '正在解析分享链接…', `正在拉取 ${parsed.type === 'playlist' ? '歌单' : '单曲'} (${parsed.id}) 详情`, 0, true)
  render()
  try {
    let songs = []
    if (parsed.type === 'playlist') {
      const pl = await window.api.playlist(parsed.id)
      imp.name = pl.name
      songs = pl.songs || []
    } else {
      songs = await window.api.songDetail(parsed.id)
      imp.name = songs[0] ? songs[0].name : ''
    }
    if (!songs.length) {
      imp.err = '这个链接里没有歌曲（可能为空或私有歌单）'
      recordTaskError(parsed.id, imp.err)
      finishTask('歌单解析异常', imp.err)
    } else {
      imp.items = songs.map((sg, idx) => ({
        _idx: idx, song: sg, voices: [], pick: 0,
        skip: false, done: false, suspect: false, suspectWhy: '', err: '',
      }))
      scheduleSaveImpState(true)
    }
  } catch (e) {
    imp.err = '解析失败：' + (e.message || e)
    recordTaskError(parsed.id, imp.err)
    finishTask('歌单解析失败', imp.err)
  }
  imp.loading = false
  render()
  if (imp.items.length) matchAllImport()
}


export async function matchAllImport(rematchPending = false) {
  if (imp.matching) return
  const total = imp.items.length
  if (!total) return
  imp.matching = true
  window.__deskImpMatchStop = false
  if (rematchPending) {
    imp.items.forEach((x) => {
      if (!x.done && !x.manual && (x.skip || x.suspect || x.pick < 0 || !x.voices || !x.voices.length)) {
        x.voices = []
        x._matchedOnce = false
      }
    })
  }
  imp.matchTotal = total
  imp.matchDone = imp.items.filter((x) => x._matchedOnce || (x.voices && x.voices.length)).length
  startTask('impmatch', '正在匹配播客声源', `共 ${total} 首 · 已匹配 ${imp.matchDone} 首`, total, false, '暂停')
  if (location.hash === '#/import') render()

  for (let i = 0; i < imp.items.length; i++) {
    if (window.__deskImpMatchStop) break
    const it = imp.items[i]
    if (!it || it.done || (it.voices && it.voices.length)) continue
    await waitNavYield()
    it.matching = true
    it.err = ''
    updateSingleImpRow(i)
    try {
      it.voices = await window.api.searchVoices({ name: it.song.name, artist: it.song.artist, duration: it.song.duration })
      evaluateImpItem(it)
      if (it.pick >= 0 && !it.suspect) {
        it.skip = false
      }
    } catch (e) {
      it.voices = []
      it.pick = -1
      it.err = '匹配接口异常：' + (e.message || e)
    }
    it.matching = false
    it._matchedOnce = true
    imp.matchDone = imp.items.filter((x) => x._matchedOnce || (x.voices && x.voices.length)).length
    if (it.pick >= 0 && !it.suspect) {
      // matched cleanly
    } else if (it.suspect) {
      recordTaskError(it.song.name, `候选需人工确认（${it.suspectWhy || '时长或标题不符'}）`)
    } else {
      recordTaskError(it.song.name, it.err || '网易云未搜到可用播客声源')
    }
    stepTask(imp.matchDone, `正在匹配 (${imp.matchDone}/${total})：${it.song.name}`)
    updateSingleImpRow(i)
    scheduleSaveImpState(false)
  }
  imp.matching = false
  scheduleSaveImpState(true)
  const usable = imp.items.filter((x) => !x.skip && !x.done && !x.suspect && x.pick >= 0 && x.voices && x.voices[x.pick]).length
  const suspectCnt = imp.items.filter(isImpItemPending).length
  finishTask(
    window.__deskImpMatchStop ? '声源匹配已暂停' : '播客声源匹配完成',
    `可直接下载 ${usable} 首${suspectCnt ? ` · 待确认/未找到 ${suspectCnt} 首` : ''}`,
    5000
  )
  if (location.hash === '#/import') render()
}


export function refreshOpenImpPanel(i) {
  const it = imp.items[i]
  if (!it) return
  const pEl = document.querySelector(`[data-panel="${i}"]`)
  if (pEl) pEl.outerHTML = candStripHtml(it, i)
}


export async function importInlineSearch(i, kw, useSmart = false) {
  const it = imp.items[i]
  if (!it || it.searching) return
  const cleanKw = String(kw || '').trim()
  if (cleanKw) it.customKw = cleanKw
  it.searching = true
  it.err = ''
  refreshOpenImpPanel(i)
  try {
    let list = []
    if (useSmart || !cleanKw) {
      list = await window.api.searchVoices({ name: it.song.name, artist: it.song.artist, duration: it.song.duration })
    } else {
      list = await window.api.searchVoices(cleanKw)
    }
    it.voices = list || []
    evaluateImpItem(it)
    if (it.pick >= 0 && !it.suspect) {
      it.skip = false
    }
    scheduleSaveImpState(false)
  } catch (e) {
    it.err = '搜索失败：' + (e.message || e)
  }
  it.searching = false
  updateSingleImpRow(i)
  refreshOpenImpPanel(i)
}


export async function importSwap(i) {
  const prevOpen = imp.open
  imp.open = imp.open === i ? -1 : i
  if (prevOpen >= 0) {
    document.querySelector(`[data-panel="${prevOpen}"]`)?.remove()
    const oldBtn = document.getElementById('impswap-' + prevOpen)
    if (oldBtn) oldBtn.textContent = '换源'
  }
  if (imp.open === i && imp.items[i]) {
    const it = imp.items[i]
    const curRow = document.getElementById('improw-' + i)
    const curBtn = document.getElementById('impswap-' + i)
    if (curBtn) curBtn.textContent = '收起'
    if (curRow) {
      curRow.insertAdjacentHTML('afterend', candStripHtml(it, i))
      if (!it.voices || !it.voices.length) {
        importInlineSearch(i, '', true)
      }
      return
    }
  }
  render()
}


export async function importRekw(i) {
  const it = imp.items[i]
  if (!it) return
  const inEl = document.getElementById('impkw-' + i)
  if (inEl) {
    await importInlineSearch(i, inEl.value, false)
    return
  }
  const kw = await askText('换个关键词重新搜声音', it.song.name)
  if (!kw) return
  await importInlineSearch(i, kw, false)
}


export async function importAll() {
  const byNorm = new Map()
  state.tracks.forEach((t) => byNorm.set(normKey(cleanTitle(t.title)), t))
  for (const it of imp.items) {
    if (it.done || it.skip) continue
    const exist = byNorm.get(normKey(it.song.name))
    if (exist && Math.abs((exist.duration || 0) - (it.song.duration || 0)) <= 25) {
      it.done = true
    }
  }
  const todo = imp.items.filter((x) => !x.skip && !x.done && !x.suspect && x.pick >= 0 && x.voices && x.voices[x.pick])
  if (!todo.length) { scheduleSaveImpState(true); render(); toast('没有待下载的曲目'); return }
  imp.busy = true
  imp.done = 0
  imp.total = todo.length
  window.__deskImpStop = false
  startTask('impdl', '正在批量下载音频…', `共 ${todo.length} 首待下载`, todo.length, false, '停止')
  if (location.hash === '#/import') render()
  for (const it of todo) {
    if (window.__deskImpStop) break
    await waitNavYield()
    const v = it.voices[it.pick]
    if (!v) continue
    it.running = true
    it.err = ''
    updateSingleImpRow(it._idx)
    stepTask(imp.done, `正在下载 (${imp.done + 1}/${imp.total})：${it.song.name}`)
    try {
      await window.api.downloadVoice({ voice: v, song: it.song })
      it.done = true
      imp.done++
    } catch (e) {
      it.skip = true
      it.err = e.message || String(e)
      recordTaskError(it.song.name, '下载失败：' + it.err)
    }
    it.running = false
    updateSingleImpRow(it._idx)
    scheduleSaveImpState(false)
  }
  imp.busy = false
  scheduleSaveImpState(true)
  await rescan()
  finishTask(
    window.__deskImpStop ? '批量下载已停止' : '批量下载完成',
    `成功下载 ${imp.done} / ${imp.total} 首${state.task.errors.length ? ` · 失败 ${state.task.errors.length} 首` : ''}`,
    5500
  )
  if (location.hash === '#/import') render()
  toast(window.__deskImpStop ? '已停止批量下载' : '批量下载完成')
}
