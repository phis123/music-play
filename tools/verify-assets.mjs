#!/usr/bin/env node
// 资产一致性守门（本地跑 / CI 都调这一个脚本）。
//
// 为什么需要它：APK 的 WebView 不认识「构建期符号链接」，所以手机端用的是
// 桌面端文件的**人工同步副本**（例如 android/app/assets/js/random.js 是
// lib/random.js 的逐字节副本）。这类副本一旦漂移，桌面端单测全绿、手机端却跑
// 旧实现，只有用户投诉才发现。本脚本把「必须逐字节相同」的关系写成清单并逐字节
// 校验，同时校验 assets 页面里的本地引用都真实存在（防止改了文件名忘记同步）。
//
// 用法：
//   node tools/verify-assets.mjs            # 全绿 exit 0，任何问题 exit 1
//   node tools/verify-assets.mjs --json     # 机器可读结果（CI 日志/调试用）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根（本文件在 tools/ 下） */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 必须逐字节相同的「源 → 副本」清单。
 * 新增共用文件时在这里加一条即可，CI 与本地共用同一份规则。
 */
export const SYNC_PAIRS = [
  {
    src: 'lib/random.js',
    dst: 'android/app/assets/js/random.js',
    why: '随机播放三策略桌面端 / Android 共用同一份 UMD 实现（assets 侧是同步副本）',
  },
]

/** 需要校验本地引用（src/href）都存在的 assets 页面 */
export const ASSET_PAGES = ['android/app/assets/index.html']

/** 读取文件为 Buffer；不存在/不可读返回 null（由调用方判为问题） */
export function readMaybe(abs) {
  try {
    return fs.readFileSync(abs)
  } catch {
    return null
  }
}

/**
 * 找出两个 Buffer 的第一处差异（用于打印「哪一行开始漂移」）。
 * @returns {{offset: number, line: number, srcLine: string, dstLine: string}|null} 完全相同返回 null
 */
export function firstDiff(a, b) {
  if (!a || !b) return null
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  if (i === n && a.length === b.length) return null
  const lineOf = (buf, at) => {
    let line = 1
    for (let k = 0; k < at && k < buf.length; k++) if (buf[k] === 0x0a) line++
    return line
  }
  const lineText = (buf, at) => {
    // 取差异处所在行的可读文本（可能截断在行中，这里从行首取到行尾）
    let start = Math.max(0, at - 1)
    while (start > 0 && buf[start - 1] !== 0x0a) start--
    let end = Math.min(buf.length, at)
    while (end < buf.length && buf[end] !== 0x0a) end++
    const raw = buf.subarray(start, end).toString('utf8').replace(/\r$/, '')
    return raw.length > 120 ? raw.slice(0, 117) + '...' : raw
  }
  return {
    offset: i,
    line: lineOf(a, i),
    srcLine: lineText(a, i),
    dstLine: lineText(b, i),
  }
}

/**
 * 逐字节校验同步副本。
 * @param {{root?: string, pairs?: typeof SYNC_PAIRS}} [options]
 * @returns {{ok: boolean, problems: string[], results: Array<{src: string, dst: string, ok: boolean, bytes: number|null, reason?: string, diff?: object}>}}
 */
export function compareSyncPairs(options = {}) {
  const root = options.root || ROOT
  const pairs = options.pairs || SYNC_PAIRS
  const problems = []
  const results = []
  for (const pair of pairs) {
    const srcAbs = path.join(root, pair.src)
    const dstAbs = path.join(root, pair.dst)
    const src = readMaybe(srcAbs)
    const dst = readMaybe(dstAbs)
    if (!src) {
      problems.push(`缺少源文件：${pair.src}`)
      results.push({ src: pair.src, dst: pair.dst, ok: false, bytes: null, reason: '源文件不存在' })
      continue
    }
    if (!dst) {
      problems.push(`缺少同步副本：${pair.dst}（应由 ${pair.src} 同步而来，${pair.why || ''}）`)
      results.push({ src: pair.src, dst: pair.dst, ok: false, bytes: null, reason: '副本不存在' })
      continue
    }
    if (src.length !== dst.length) {
      // 最常见的漂移形态是「副本末尾被追加/删掉几行」，这里把多出来的尾巴直接打出来
      const longerIsDst = dst.length > src.length
      const common = Math.min(src.length, dst.length)
      const tail = JSON.stringify((longerIsDst ? dst : src).subarray(common, common + 160).toString('utf8'))
      const kind = longerIsDst ? '副本比源多' : '副本比源少'
      problems.push(
        `${pair.dst} 与 ${pair.src} 长度不一致（${dst.length} vs ${src.length} 字节，${kind} ${Math.abs(dst.length - src.length)} 字节` +
          (tail ? `：末尾 ${tail}` : '') + '）',
      )
      results.push({
        src: pair.src,
        dst: pair.dst,
        ok: false,
        bytes: dst.length,
        reason: '长度不一致',
        diff: firstDiff(src, dst),
      })
      continue
    }
    const diff = firstDiff(src, dst)
    if (diff) {
      problems.push(
        `${pair.dst} 与 ${pair.src} 内容漂移（首个差异在第 ${diff.line} 行，offset ${diff.offset}）`,
      )
      results.push({ src: pair.src, dst: pair.dst, ok: false, bytes: dst.length, reason: '内容漂移', diff })
      continue
    }
    results.push({ src: pair.src, dst: pair.dst, ok: true, bytes: dst.length })
  }
  return { ok: problems.length === 0, problems, results }
}

/** 页面里需要忽略的引用前缀（远程/内联/锚点） */
const SKIP_REF = /^(?:[a-z]+:|\/\/|#|data:)/i

/**
 * 校验 assets 页面里的相对 src/href 都真实存在（改了文件名却没同步页面时立刻变红）。
 * @param {{root?: string, pages?: string[]}} [options]
 * @returns {{ok: boolean, problems: string[], checked: number, results: Array<{page: string, ref: string, ok: boolean}>}}
 */
export function checkPageReferences(options = {}) {
  const root = options.root || ROOT
  const pages = options.pages || ASSET_PAGES
  const problems = []
  const results = []
  for (const rel of pages) {
    const abs = path.join(root, rel)
    const buf = readMaybe(abs)
    if (!buf) {
      problems.push(`缺少 assets 页面：${rel}`)
      continue
    }
    const html = buf.toString('utf8')
    const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi
    let m
    while ((m = re.exec(html))) {
      const ref = m[1].trim()
      if (!ref || SKIP_REF.test(ref)) continue
      const target = path.resolve(path.dirname(abs), ref.split('?')[0].split('#')[0])
      const ok = fs.existsSync(target)
      results.push({ page: rel, ref, ok })
      if (!ok) problems.push(`${rel} 引用了不存在的文件：${ref}`)
    }
  }
  return { ok: problems.length === 0, problems, checked: results.length, results }
}

/**
 * 跑全部检查（CI / 本地唯一入口）。
 * @param {{root?: string, pairs?: typeof SYNC_PAIRS, pages?: string[]}} [options]
 * @returns {{ok: boolean, problems: string[], stats: {pairs: number, bytes: number, refs: number}, pairs: object, pages: object}}
 */
export function runVerify(options = {}) {
  const pairs = compareSyncPairs(options)
  const pages = checkPageReferences(options)
  const bytes = pairs.results.reduce((n, r) => n + (r.ok ? r.bytes || 0 : 0), 0)
  return {
    ok: pairs.ok && pages.ok,
    problems: [...pairs.problems, ...pages.problems],
    stats: { pairs: pairs.results.length, bytes, refs: pages.checked },
    pairs,
    pages,
  }
}

/** 独立的 CLI 入口判断（被 import 时不自动执行） */
function isMain() {
  if (!process.argv[1]) return false
  try {
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isMain()) {
  const json = process.argv.includes('--json')
  const result = runVerify()
  if (json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    for (const r of result.pairs.results) {
      if (r.ok) {
        console.log(`ok   ${r.src} == ${r.dst} (${r.bytes} 字节)`)
      } else {
        console.error(`FAIL ${r.src} != ${r.dst}：${r.reason}`)
        // 只在「内容漂移」（同长度）时打印首个差异行；长度不一致时上面的尾巴已经说明问题
        if (r.diff && r.reason === '内容漂移') {
          console.error(`     ${r.src}:${r.diff.line}  ${r.diff.srcLine}`)
          console.error(`     ${r.dst}:${r.diff.line}  ${r.diff.dstLine}`)
        }
      }
    }
    console.log(
      `\n[verify-assets] 同步副本 ${result.pairs.results.filter((r) => r.ok).length}/${result.stats.pairs} 逐字节一致，` +
        `页面引用 ${result.stats.refs} 处全部存在`,
    )
    if (!result.ok) {
      console.error(`[verify-assets] ${result.problems.length} 个问题：`)
      for (const p of result.problems) console.error(`  - ${p}`)
      console.error('[verify-assets] 修复方式：把源文件同步到副本（逐字节一致），或修正页面引用。')
    }
  }
  process.exit(result.ok ? 0 : 1)
}
