/**
 * player/audio.js — WebAudio 音量平衡管线（增益节点 + 软限幅器）
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */
import { $, audio } from '../core/dom.js'
import { state } from '../core/state.js'
import { getUserTrackGain } from '../core/store.js'


/* ---------------- 音量平衡 WebAudio 管线 + 单曲增益/播放计数/歌词外观 ---------------- */
export let _audioCtx = null

export let _gainNode = null

export let _compNode = null


export function ensureWebAudioGraph() {
  if (_audioCtx && _gainNode) return true
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC || !audio) return false
    _audioCtx = new AC()
    const src = _audioCtx.createMediaElementSource(audio)
    _gainNode = _audioCtx.createGain()
    _compNode = _audioCtx.createDynamicsCompressor()
    // 透明防破音软限幅器参数（仅在放大偏小音源遇到瞬态鼓点峰值时防削波）
    _compNode.threshold.value = -2.5
    _compNode.knee.value = 6.0
    _compNode.ratio.value = 12.0
    _compNode.attack.value = 0.003
    _compNode.release.value = 0.16
    src.connect(_gainNode)
    _gainNode.connect(_compNode)
    _compNode.connect(_audioCtx.destination)
    return true
  } catch (e) {
    console.warn('WebAudio 管线初始化失败:', e)
    return false
  }
}


export function getCurrentTrackEffectiveGain() {
  const t = state.tracks[state.cur]
  if (!t) return { autoDb: 0, manualDb: 0, totalDb: 0 }
  const autoDb = Number.isFinite(Number(t.gainDb)) ? Number(t.gainDb) : 0
  const manualDb = getUserTrackGain(t.path)
  if (!state.normEnabled) {
    const tot = Math.max(-15, Math.min(15, Math.round(manualDb * 10) / 10))
    return { autoDb, manualDb, totalDb: tot }
  }
  const presetOff = state.normPreset === 'night' ? -2.5 : state.normPreset === 'boost' ? 2.0 : 0
  const tot = Math.max(-15, Math.min(15, Math.round((autoDb + presetOff + manualDb) * 10) / 10))
  return { autoDb, manualDb, totalDb: tot }
}


export function applyCurrentTrackGain() {
  const { autoDb, manualDb, totalDb } = getCurrentTrackEffectiveGain()
  const linear = Math.pow(10, totalDb / 20)
  if (ensureWebAudioGraph() && _gainNode) {
    if (_audioCtx && _audioCtx.state === 'suspended' && !audio.paused) {
      _audioCtx.resume().catch(() => {})
    }
    try {
      _gainNode.gain.setTargetAtTime(linear, _audioCtx.currentTime, 0.03)
    } catch {
      _gainNode.gain.value = linear
    }
  }
  const badge = $('#lpGainBadge')
  if (badge) {
    const sign = totalDb > 0 ? '+' : ''
    badge.textContent = (state.normEnabled || manualDb !== 0)
      ? `均衡 ${sign}${totalDb.toFixed(1)}dB`
      : '均衡 关闭'
    badge.style.color = manualDb !== 0 ? 'var(--red)' : ''
  }
  const t = state.tracks[state.cur]
  if (t && $('#pbArtist')) {
    const eqTxt = (state.normEnabled && Math.abs(totalDb) >= 0.1) || manualDb !== 0
      ? ` · 均衡 ${totalDb > 0 ? '+' : ''}${totalDb.toFixed(1)}dB`
      : ''
    $('#pbArtist').textContent = (t.artist || '未知艺人') + (t.bitrate ? ` · ${t.bitrate}k` : '') + eqTxt
  }
  return { autoDb, manualDb, totalDb }
}
