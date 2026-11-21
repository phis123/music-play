/**
 * 语法守门：对仓库里「直接跑在 Node / Chromium 里、没有构建/打包转换」的 JS 逐个做
 * `node --check`。它抓的是「语法都过不了」的低级错误（漏括号、拼错关键字、被误提交的
 * 半成品 diff），不替代单测。
 *
 * 用法：npm run lint:syntax
 *
 * 注意：`node --check` 一次只接受一个文件，且 Windows 的 cmd/npm run 不会展开通配符，
 * 所以这里用 fs 自己展开 `目录/*.ext`，再逐个 spawn `process.execPath --check`。
 * 用 process.execPath 而不是 'node'：保证与当前运行测试的是同一个 Node（CI 里 setup-node
 * 选的版本），也不依赖 PATH。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 明确的文件 + 通配目录（与任务约定的检查范围一致；Android 侧脚本一并纳入，
// 因为它是普通 script、没有语法检查就只会在真机上炸）
const TARGETS = [
  'main.js',
  'preload.js',
  'netapi.js',
  'lib/*.js',
  'renderer/js/*.js',
  'android/app/assets/js/*.js',
  'tools/*.mjs',
]

function expand(target) {
  const star = target.indexOf('*')
  if (star < 0) {
    const abs = path.join(ROOT, target)
    return fs.existsSync(abs) ? [abs] : []
  }
  // 只支持 `dir/*.ext` 这种单层通配（仓库里没有更深的层级）
  const dir = path.join(ROOT, path.dirname(target))
  const suffix = target.slice(star + 1) // 形如 ".js"
  let names
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((name) => name.endsWith(suffix))
    .sort()
    .map((name) => path.join(dir, name))
}

const files = []
for (const target of TARGETS) {
  const hit = expand(target)
  if (!hit.length) {
    console.error(`[lint:syntax] 没有匹配到任何文件：${target}`)
    process.exitCode = 1
  }
  files.push(...hit)
}

let failed = 0
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  const rel = path.relative(ROOT, file).split(path.sep).join('/')
  if (r.status === 0) {
    console.log(`ok   ${rel}`)
  } else {
    failed++
    console.error(`FAIL ${rel}`)
    if (r.stderr) console.error(r.stderr.trim())
  }
}

console.log(`\n[lint:syntax] ${files.length - failed}/${files.length} 个文件语法通过`)
if (failed) {
  console.error(`[lint:syntax] ${failed} 个文件未通过`)
  process.exit(1)
}
