'use strict'
const fs = require('fs')
const path = require('path')

// 标准目标流媒体响度基准：-14 LUFS（对应 MPEG-1 Layer III Joint Stereo P80 global_gain 中位数 171）
const DEFAULT_TARGET_LUFS = -14
const REF_MP3_GLOBAL_GAIN = 171
const DB_PER_GAIN_STEP = 1.505149978319906 // 20 * log10(2^(1/4))
const MAX_AUTO_GAIN_DB = 8.5
const MIN_AUTO_GAIN_DB = -8.5

// 从二进制缓冲区读取从 bitOffset 开始的 nBits 位（大端位序）
function readBits(buf, baseByte, bitOffset, nBits) {
  let val = 0
  for (let i = 0; i < nBits; i++) {
    const totalBit = bitOffset + i
    const byteIdx = baseByte + (totalBit >> 3)
    if (byteIdx >= buf.length) return 0
    const bitInByte = 7 - (totalBit & 7)
    val = (val << 1) | ((buf[byteIdx] >> bitInByte) & 1)
  }
  return val
}

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
const SRATES_V1 = [44100, 48000, 32000, 0]
const SRATES_V2 = [22050, 24000, 16000, 0]
const SRATES_V25 = [11025, 12000, 8000, 0]

/**
 * 从 MP3 切片缓冲区中提取有效音频帧的 SideInfo global_gain 列表
 */
function extractMp3GlobalGainsFromBuffer(buf) {
  const gains = []
  if (!Buffer.isBuffer(buf) || buf.length < 64) return gains
  let i = 0
  const end = buf.length - 40
  while (i < end) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) {
      i++
      continue
    }
    const b1 = buf[i + 1]
    const b2 = buf[i + 2]
    const b3 = buf[i + 3]
    const versionBits = (b1 >> 3) & 0x03
    const layerBits = (b1 >> 1) & 0x03
    const protectionBit = b1 & 0x01
    if (versionBits === 1 || layerBits !== 1) {
      i++
      continue
    }
    const brIdx = (b2 >> 4) & 0x0f
    const srIdx = (b2 >> 2) & 0x03
    const padding = (b2 >> 1) & 0x01
    if (brIdx === 0 || brIdx === 15 || srIdx === 3) {
      i++
      continue
    }
    const isV1 = versionBits === 3
    const bitrate = (isV1 ? BITRATES_V1_L3[brIdx] : BITRATES_V2_L3[brIdx]) * 1000
    const srate = versionBits === 3 ? SRATES_V1[srIdx] : versionBits === 2 ? SRATES_V2[srIdx] : SRATES_V25[srIdx]
    if (!bitrate || !srate) {
      i++
      continue
    }
    const frameLen = isV1
      ? Math.floor((144 * bitrate) / srate) + padding
      : Math.floor((72 * bitrate) / srate) + padding
    if (frameLen < 24 || frameLen > 2880) {
      i++
      continue
    }
    // 强制校验下一帧同步头与版本/层一致（彻底排除音频载荷中偶发的 0xFFE0 伪同步字节）
    if (
      i + frameLen + 2 >= buf.length ||
      buf[i + frameLen] !== 0xff ||
      (buf[i + frameLen + 1] & 0xfe) !== (b1 & 0xfe)
    ) {
      i++
      continue
    }
    const sideStart = i + 4 + (protectionBit === 0 ? 2 : 0)
    const sideLen = isV1 ? ((b3 >> 6) === 3 ? 17 : 32) : ((b3 >> 6) === 3 ? 9 : 17)
    if (sideStart + sideLen + 4 > buf.length) break

    // 跳过 Xing / Info / VBRI 头帧
    const tagOff = sideStart + sideLen
    if (tagOff + 4 <= buf.length) {
      const tag = buf.toString('ascii', tagOff, tagOff + 4)
      if (tag === 'Xing' || tag === 'Info' || tag === 'VBRI') {
        i += frameLen
        continue
      }
    }

    const nch = (b3 >> 6) === 3 ? 1 : 2
    if (isV1) {
      // MPEG-1 Layer III: main_data_begin(9) + private(5 or 3) + scfsi(4 or 8) = 18(mono) or 20(stereo) bits
      let bitPos = nch === 1 ? 18 : 20
      for (let gr = 0; gr < 2; gr++) {
        for (let ch = 0; ch < nch; ch++) {
          const part23 = readBits(buf, sideStart, bitPos, 12)
          const gg = readBits(buf, sideStart, bitPos + 21, 8)
          if (part23 > 32 && gg >= 115 && gg <= 250) {
            gains.push(gg)
          }
          bitPos += 59
        }
      }
    } else {
      // MPEG-2/2.5 Layer III: main_data_begin(8) + private(1 or 2) = 9(mono) or 10(stereo) bits
      let bitPos = nch === 1 ? 9 : 10
      for (let ch = 0; ch < nch; ch++) {
        const part23 = readBits(buf, sideStart, bitPos, 12)
        const gg = readBits(buf, sideStart, bitPos + 21, 8)
        if (part23 > 32 && gg >= 115 && gg <= 250) {
          gains.push(gg)
        }
        bitPos += 63
      }
    }
    i += frameLen
  }
  return gains
}

/**
 * 解析 ReplayGain 字符串或数值（如 "-3.25 dB" 或 { dB: -3.25 }）
 */
function parseReplayGainTag(raw) {
  if (raw == null) return null
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(-15, Math.min(15, Math.round(raw * 10) / 10))
  }
  if (typeof raw === 'object' && typeof raw.dB === 'number' && Number.isFinite(raw.dB)) {
    return Math.max(-15, Math.min(15, Math.round(raw.dB * 10) / 10))
  }
  if (typeof raw === 'string') {
    const m = raw.match(/([+-]?\d+(?:\.\d+)?)/)
    if (m) {
      const v = parseFloat(m[1])
      if (Number.isFinite(v)) return Math.max(-15, Math.min(15, Math.round(v * 10) / 10))
    }
  }
  return null
}

/**
 * 快速估算音频文件的标准补偿增益 gainDb（相对于 -14 LUFS 基准）：
 * - 只抽样文件 25% / 50% / 75% 三个位置的 32KB 块（单曲 I/O 仅 96KB，耗时 <0.5ms）；
 * - 返回值单位 dB（正值代表原曲偏轻需要放大，负值代表原曲偏响需要压低）。
 */
function estimateFileGainDbSync(filePath, existingTagGain = null) {
  const tagVal = parseReplayGainTag(existingTagGain)
  if (tagVal !== null) return tagVal
  if (typeof filePath !== 'string' || !filePath) return 0
  const ext = path.extname(filePath).toLowerCase()
  if (ext !== '.mp3') return 0

  let fd = null
  try {
    const st = fs.statSync(filePath)
    if (!st.isFile() || st.size < 16384) return 0
    fd = fs.openSync(filePath, 'r')
    const chunkSize = 32768
    const offsets = [
      Math.floor(st.size * 0.25),
      Math.floor(st.size * 0.50),
      Math.floor(st.size * 0.75),
    ]
    const allGains = []
    const buf = Buffer.allocUnsafe(chunkSize)
    for (const off of offsets) {
      if (off + 1024 >= st.size) continue
      const bytesRead = fs.readSync(fd, buf, 0, Math.min(chunkSize, st.size - off), off)
      if (bytesRead > 256) {
        const sub = bytesRead === buf.length ? buf : buf.subarray(0, bytesRead)
        const gs = extractMp3GlobalGainsFromBuffer(sub)
        for (let k = 0; k < gs.length; k++) allGains.push(gs[k])
      }
    }
    if (allGains.length < 8) return 0
    allGains.sort((a, b) => a - b)
    // 取 P80 分位代表主歌/副歌稳定响度区间（排除间奏弱音与个别尖峰）
    const p80 = allGains[Math.min(allGains.length - 1, Math.floor(allGains.length * 0.80))]
    // 阻尼系数 0.65：平抑帧增益波动，避免过度拉升底噪
    const rawDiffDb = (REF_MP3_GLOBAL_GAIN - p80) * DB_PER_GAIN_STEP * 0.65
    const clamped = Math.max(MIN_AUTO_GAIN_DB, Math.min(MAX_AUTO_GAIN_DB, rawDiffDb))
    return Math.round(clamped * 10) / 10
  } catch {
    return 0
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd) } catch { }
    }
  }
}

/**
 * 合成最终应用的增益（dB）：
 * @param {object} opts
 * @param {boolean} opts.enabled - 是否开启全局音量平衡
 * @param {'standard'|'night'|'vocal'} [opts.preset='standard'] - 全局预设（standard=-14LUFS, night=-17LUFS）
 * @param {number} [opts.autoGainDb=0] - 曲目自动测算补偿值
 * @param {number} [opts.userTrackGainDb=0] - 用户在播放页针对该单曲手动微调的增益（-12 ~ +12 dB，始终生效）
 */
function computeEffectiveGainDb({
  enabled = true,
  preset = 'standard',
  autoGainDb = 0,
  userTrackGainDb = 0,
} = {}) {
  const manual = Number.isFinite(Number(userTrackGainDb)) ? Number(userTrackGainDb) : 0
  if (!enabled) {
    return Math.max(-15, Math.min(15, Math.round(manual * 10) / 10))
  }
  const auto = Number.isFinite(Number(autoGainDb)) ? Number(autoGainDb) : 0
  const presetOffset = preset === 'night' ? -2.5 : preset === 'boost' ? 2.0 : 0
  const total = auto + presetOffset + manual
  return Math.max(-15, Math.min(15, Math.round(total * 10) / 10))
}

module.exports = {
  DEFAULT_TARGET_LUFS,
  extractMp3GlobalGainsFromBuffer,
  parseReplayGainTag,
  estimateFileGainDbSync,
  computeEffectiveGainDb,
}
