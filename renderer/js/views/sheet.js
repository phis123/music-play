/**
 * views/sheet.js — 播放队列抽屉与换声源弹窗
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { $, audio, cleanTitle, esc, fmt, fmtPlays } from '../core/dom.js'
import { state } from '../core/state.js'
import { toast } from '../core/ui.js'
import { coverCache } from '../library/cover.js'
import { stopPreview } from '../library/search.js'
import { firstArtistClean } from '../library/import.js'
import { playTrack, trackByPath } from '../player/queue.js'


/* ---------------- 播放队列抽屉 & 播放页「更换声源」模态框 ---------------- */
export function normKeyRaw(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/^声音[:：]?\s*/, '')
    .replace(/^\d{1,3}\s*[-._、)\]]\s*/, '')
    .replace(/^\d{2}\s+(?=[a-z\u4e00-\u9fa5])/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export function normKey(s) {
  const stripped = String(s || '')
    .replace(/^声音[:：]?\s*/, '')
    .replace(/^\d{1,3}\s*[-._、)\]]\s*/, '')
    .replace(/^\d{2}\s+(?=[a-z\u4e00-\u9fa5])/i, '')
    .replace(/\s+[【\[（(][^】\]）)]*[】\]）)]/g, ' ')
    .replace(/^[【\[（(][^】\]）)]*[】\]）)]\s*/g, ' ')
    .replace(/[（(][^）)]*(?:feat\.?|ver\.?|version|edit|mix|ost|op|ed|inst|off\s*vocal)[^）)]*[）)]/gi, ' ')
  const k = normKeyRaw(stripped)
  return k.length >= 2 ? k : normKeyRaw(s)
}

export function isVariantTitle(vt, sn) {
  const re = /伴奏|纯音乐|inst(rumental)?\b|off\s*vocal|karaoke|钢琴版|吉他版|八音盒|铃声|片段|试听|[×x]\s*0\.\d+|0\.\d+\s*[×x]|slowed|nightcore|倍速/i
  return re.test(String(vt || '')) && !re.test(String(sn || ''))
}

export function scoreVoiceCand(song, v) {
  const sName = String((song && song.name) || '')
  const vTitle = String((v && v.title) || '').replace(/^声音[:：]?\s*/, '').trim()
  const nsRaw = normKeyRaw(sName)
  const nsLoose = normKey(sName)
  const nvRaw = normKeyRaw(vTitle)
  const nvLoose = normKey(vTitle)
  const fa = normKeyRaw(firstArtistClean((song && song.artist) || ''))

  let tScore = 0
  if (!nsRaw && sName.trim()) {
    const sym = sName.trim()
    if (vTitle.includes(sym) || vTitle.includes('_') || vTitle.includes('-')) {
      tScore = (fa && nvRaw.includes(fa)) ? 60 : 40
    }
  } else {
    const candsS = [nsRaw, nsLoose]
    if (song && Array.isArray(song.alias)) {
      song.alias.forEach((al) => { const k = normKeyRaw(al); if (k) candsS.push(k) })
    }
    const candsV = [nvRaw, nvLoose]
    for (const ks of candsS) {
      for (const kv of candsV) {
        if (!ks || !kv) continue
        if (kv === ks) tScore = Math.max(tScore, 60)
        else if (kv.includes(ks)) tScore = Math.max(tScore, 48)
        else if (ks.includes(kv) && kv.length >= Math.max(2, Math.floor(ks.length * 0.45))) tScore = Math.max(tScore, 40)
      }
    }
  }
  if (fa && fa.length >= 2 && (nvRaw.includes(fa) || normKeyRaw(v.dj || '').includes(fa) || normKeyRaw(v.radio || '').includes(fa))) {
    tScore += 8
  }

  const a = +((song && song.duration) || 0), b = +((v && v.duration) || 0)
  const gap = (a && b) ? (b - a) : null
  let dScore = 0
  if (gap != null) {
    const ad = Math.abs(gap)
    if (ad <= 3) dScore = 50
    else if (ad <= 6) dScore = 38
    else if (ad <= 15) dScore = 15
    else if (ad > 28) dScore = -30
  }
  const isVar = isVariantTitle(vTitle, sName)
  if (isVar) dScore -= 30

  const bad = tScore < 30 || isVar || (gap != null && Math.abs(gap) > 28)
  const why = tScore < 30 ? '标题可能不符' : isVar ? '疑似非原曲版本' : (gap != null && Math.abs(gap) > 28 ? `时长差 ${fmt(Math.abs(gap))}` : '')
  return { v, score: tScore + dScore, gap, bad, why }
}


export function sheetDialogHtml() {
  if (state.sheetKind === 'queue') {
    const modeLabel = state.mode === 'shuffle' ? '🔀 随机播放' : state.mode === 'one' ? '🔂 单曲循环' : '🔁 顺序循环'
    const paused = !audio || audio.paused
    const items = state.queuePaths.map((p, i) => {
      const t = trackByPath(p)
      if (!t) return ''
      const isCur = i === state.qPos
      const eq = isCur ? `<span class="eq-bars${paused ? ' paused' : ''}"><i></i><i></i><i></i></span>` : ''
      return `<div class="q-item${isCur ? ' cur' : ''}" data-q-jump="${i}">
        <div class="q-item-main">
          <div class="q-item-title">${eq}${i + 1}. ${esc(cleanTitle(t.title))}</div>
          <div class="q-item-sub">${esc(t.artist || '未知艺人')} · ${fmt(t.duration || 0)}</div>
        </div>
        <button class="q-item-rm" data-q-rm="${i}" title="从队列移除">✕</button>
      </div>`
    }).join('')
    return `<div class="sheet-panel">
      <div class="sheet-head-row">
        <div class="sheet-title">播放队列 (${state.queuePaths.length})</div>
        <div style="display:flex;gap:8px">
          <button class="sheet-sub-btn" data-q-mode="1">${modeLabel}</button>
          <button class="sheet-sub-btn danger" data-q-clear="1">清空</button>
        </div>
      </div>
      <div class="q-list" id="qListBox">
        ${items || '<div class="search-hint">播放队列为空</div>'}
      </div>
      <div style="display:flex;justify-content:flex-end">
        <button class="ask-btn ghost" data-sheet-close="1">关闭</button>
      </div>
    </div>`
  }
  if (state.sheetKind === 'source') {
    const sw = state.srcSwitch
    const t = sw.track || {}
    const curDur = fmt(t.duration || 0)
    const listHtml = sw.loading
      ? '<div class="search-hint">正在搜索匹配播客声源…</div>'
      : sw.err
        ? `<div class="search-hint" style="color:var(--red)">${esc(sw.err)}</div>`
        : !sw.cands.length
          ? '<div class="search-hint">未找到可用声源，可修改上方关键词重试</div>'
          : sw.cands.map((c, i) => {
              const v = c.v
              const isPv = sw.prevId && String(sw.prevId) === String(v.mainTrackId)
              const busy = sw.busyId && String(sw.busyId) === String(v.mainTrackId)
              const gapAbs = c.gap == null ? 999 : Math.abs(c.gap)
              const tagHtml = c.bad
                ? `<span class="src-tag warn">${esc(c.why || '时长不符')}</span>`
                : gapAbs <= 3
                  ? '<span class="src-tag">时长一致 · 推荐</span>'
                  : `<span class="src-tag">差 ${fmt(gapAbs)}</span>`
              return `<div class="src-item${i === 0 && !c.bad ? ' best' : ''}">
                <div class="src-cover" style="background-image:url('${esc(v.cover || '')}')"></div>
                <div class="src-main">
                  <div class="src-title">${esc(String(v.title || '未命名声源').replace(/^声音[:：]?\s*/, ''))}</div>
                  <div class="src-sub">
                    <span>${esc([v.dj ? 'by ' + v.dj : '', v.radio || '未知电台'].filter(Boolean).join(' · '))}</span>
                    <span>· ${fmt(v.duration)}</span>
                    <span>· ${fmtPlays(v.plays)}播放</span>
                    ${tagHtml}
                  </div>
                </div>
                <div class="src-acts">
                  <button class="src-pv${isPv ? ' on' : ''}" data-src-pv="${i}">${isPv ? '❚❚ 停止' : '▶ 试听'}</button>
                  <button class="src-use" data-src-use="${i}" ${busy ? 'disabled' : ''}>${busy ? '替换中…' : '选用替换'}</button>
                </div>
              </div>`
            }).join('')
    return `<div class="sheet-panel">
      <div class="sheet-head-row">
        <div>
          <div class="sheet-title">更换声源</div>
          <div class="sheet-sub" style="margin-top:2px">${esc(cleanTitle(t.title || '未知歌曲'))} — ${esc(t.artist || '未知艺人')}（当前时长 ${curDur}）</div>
        </div>
        ${sw.prevId ? '<button class="sheet-sub-btn" data-src-restore="1">恢复原曲</button>' : ''}
      </div>
      <div class="src-search">
        <input id="srcKwInput" type="search" value="${esc(sw.kw || '')}" placeholder="输入歌名 / 歌手重新搜索声源">
        <button class="ask-btn" id="srcKwGo">搜索</button>
      </div>
      <div id="srcDlBox" class="imp-q" style="${sw.busyId || sw.dlErr ? 'margin:0 0 8px' : 'display:none'}">
        <div class="imp-q-track"><div class="imp-q-bar" id="srcDlBar" style="width:${sw.dlPct || 40}%"></div></div>
        <div class="imp-q-text" id="srcDlText" style="${sw.dlErr ? 'color:var(--red)' : ''}">${esc(sw.dlErr || sw.dlText || '正在下载高音质声源并替换本地音频…')}</div>
      </div>
      <div class="src-list">${listHtml}</div>
      <div style="display:flex;justify-content:flex-end">
        <button class="ask-btn ghost" data-sheet-close="1">关闭</button>
      </div>
    </div>`
  }
  if (state.sheetKind === 'taskerr') {
    const errs = (state.task && state.task.errors) || []
    const rows = errs.map((er, i) => `
      <div class="err-item">
        <div class="err-item-t">${i + 1}. ${esc(er.name)}</div>
        <div class="err-item-s">${esc(er.reason)}</div>
      </div>`).join('')
    return `<div class="sheet-panel">
      <div class="sheet-head-row">
        <div>
          <div class="sheet-title">任务报错与异常详情 (${errs.length})</div>
          <div class="sheet-sub" style="margin-top:2px">${esc(state.task.title || '')}</div>
        </div>
      </div>
      <div class="err-list">${rows || '<div class="search-hint">暂无报错记录</div>'}</div>
      <div style="display:flex;justify-content:flex-end">
        <button class="ask-btn ghost" data-sheet-close="1">关闭</button>
      </div>
    </div>`
  }
  return ''
}


export function renderSheetDialog() {
  const dlg = $('#sheetDlg')
  if (!dlg || !state.sheetKind) return
  dlg.innerHTML = sheetDialogHtml()
  if (!dlg.open) dlg.showModal()
}


export function closeSheetDialog() {
  const dlg = $('#sheetDlg')
  if (state.sheetKind === 'source' && state.srcSwitch.prevId) {
    restoreSourceOriginal()
  }
  state.sheetKind = ''
  if (dlg && dlg.open) dlg.close()
}


export function openQueueDialog() {
  state.sheetKind = 'queue'
  renderSheetDialog()
  setTimeout(() => {
    const curEl = document.querySelector('#qListBox .q-item.cur')
    if (curEl && curEl.scrollIntoView) curEl.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, 50)
}


export async function openSourceDialog() {
  const t = state.tracks[state.cur]
  if (!t) { toast('请先播放一首本地歌曲'); return }
  const kw = [cleanTitle(t.title), t.artist].filter(Boolean).join(' ').trim()
  state.srcSwitch = {
    track: t,
    kw,
    loading: true,
    cands: [],
    err: '',
    prevId: '',
    busyId: '',
    savedTime: audio.currentTime || 0,
    wasPlaying: !audio.paused,
  }
  state.sheetKind = 'source'
  renderSheetDialog()
  await searchSourceDialogCands(kw, true)
}


export async function searchSourceDialogCands(kw, initialSmart) {
  const sw = state.srcSwitch
  const t = sw.track
  if (!t) return
  kw = String(kw || '').trim()
  sw.kw = kw
  sw.loading = true
  sw.err = ''
  renderSheetDialog()
  try {
    let raw = []
    if (initialSmart) {
      raw = await window.api.searchVoices({ name: cleanTitle(t.title), artist: t.artist, duration: t.duration })
    } else {
      raw = await window.api.searchVoices(kw || cleanTitle(t.title))
    }
    const songObj = { name: cleanTitle(t.title) || kw, duration: t.duration || 0 }
    sw.cands = (raw || []).map((v) => scoreVoiceCand(songObj, v)).sort((a, b) => b.score - a.score)
    sw.loading = false
  } catch (e) {
    sw.loading = false
    sw.err = '搜索声源失败：' + (e.message || e)
  }
  renderSheetDialog()
}


export async function previewSourceDialogCand(idx) {
  const sw = state.srcSwitch
  const item = sw.cands[idx]
  if (!item || !item.v) return
  const v = item.v
  const id = String(v.mainTrackId)
  if (sw.prevId === id) {
    restoreSourceOriginal()
    return
  }
  try {
    sw.prevId = id
    renderSheetDialog()
    toast('正在获取试听：' + (v.title || ''))
    const url = await window.api.preview(v.mainTrackId)
    if (!url) {
      sw.prevId = ''
      renderSheetDialog()
      toast('该声源暂不可试听')
      return
    }
    if (!audio.paused) audio.pause()
    const pa = $('#previewAudio')
    pa.src = url
    await pa.play()
    renderSheetDialog()
  } catch (e) {
    sw.prevId = ''
    renderSheetDialog()
    toast('试听失败：' + (e.message || e))
  }
}


export function restoreSourceOriginal() {
  const sw = state.srcSwitch
  sw.prevId = ''
  stopPreview()
  if (sw.wasPlaying) audio.play().catch(() => {})
  if (state.sheetKind === 'source') renderSheetDialog()
}


export async function applySourceDialogCand(idx) {
  const sw = state.srcSwitch
  const item = sw.cands[idx]
  const t = sw.track
  if (!item || !item.v || !t) return
  const v = item.v
  sw.busyId = String(v.mainTrackId)
  sw.dlPct = 45
  sw.dlText = `正在下载声源《${v.title || ''}》并替换本地音频…`
  sw.dlErr = ''
  renderSheetDialog()
  try {
    stopPreview()
    audio.pause()
    const r = await window.api.replaceSource({
      targetPath: t.path,
      voice: v,
      song: { name: cleanTitle(t.title), artist: t.artist, album: t.album, cover: '' },
    })
    t.duration = v.duration || t.duration
    if (r && r.br) t.bitrate = Math.round(r.br / 1000)
    coverCache.delete(t.path)
    sw.busyId = ''
    sw.prevId = ''
    sw.dlErr = ''
    state.sheetKind = ''
    $('#sheetDlg')?.close()
    await playTrack(t, state.cur, { keepQueue: true, bustCache: true, restoreSec: sw.savedTime })
    toast('已更换声源：' + (v.title || ''))
  } catch (e) {
    sw.busyId = ''
    sw.dlErr = '更换声源失败：' + (e.message || e)
    renderSheetDialog()
    toast(sw.dlErr)
  }
}
