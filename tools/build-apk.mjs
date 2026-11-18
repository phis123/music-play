// music-play Android APK 打包脚本（aapt2 + javac + d8 + zipalign + apksigner）
// 关键修复：aapt2 在 Windows 上用 -A 打入子目录资产时，会把路径分隔符写成反斜杠
// （assets/css\mobile.css），Android WebView 按正斜杠找不到文件 → CSS/JS 全部 404、界面裸样式。
// 因此这里改为：aapt2 link 不带 -A，随后重新打包 zip 时统一用正斜杠写入 assets。
// 用法: node build-apk.mjs <repoRoot> <outApk> <versionName> <versionCode>
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const repoRoot = path.resolve(process.argv[2] || '.')
const outApk = path.resolve(process.argv[3] || 'music-play.apk')
const versionName = process.argv[4] || '1.0.0'
const versionCode = process.argv[5] || '100'

const SDK = process.env.ANDROID_SDK_ROOT || 'E:/android-toolchain/android-sdk'
const BT = path.join(SDK, 'build-tools/34.0.0')
const ANDROID_JAR = path.join(SDK, 'platforms/android-34/android.jar')
const JAVA_HOME = process.env.JAVA_HOME || 'E:/android-toolchain/jdk/jdk-17.0.20.1+1'
const PYTHON = process.env.PYTHON || 'python'
const KEYSTORE = process.env.APK_KEYSTORE || 'E:/dsh/work3/keys/music-play-release.jks'
const KS_PASS = process.env.APK_KS_PASS || 'musicplay2026'
const KS_ALIAS = process.env.APK_KS_ALIAS || 'musicplay'

const appDir = path.join(repoRoot, 'android/app')
const work = path.resolve(process.env.APK_WORK_DIR || '.apk-work')
const exe = (n) => path.join(BT, n)
const sh = (cmd, args, opts = {}) => {
  process.stdout.write(`  > ${path.basename(cmd)} ${args.slice(0, 4).join(' ')}\n`)
  const useShell = /\.bat$/i.test(cmd)
  return execFileSync(useShell ? 'cmd.exe' : cmd, useShell ? ['/c', cmd, ...args] : args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, JAVA_HOME, PATH: `${JAVA_HOME}/bin;${BT};${process.env.PATH}` },
    ...opts,
  })
}

fs.rmSync(work, { recursive: true, force: true })
fs.mkdirSync(work, { recursive: true })
const gen = path.join(work, 'gen')
const classes = path.join(work, 'classes')
const dexout = path.join(work, 'dex')
for (const d of [gen, classes, dexout]) fs.mkdirSync(d, { recursive: true })

// 1) aapt2 compile
const resZip = path.join(work, 'res.zip')
console.log('== 1/7 aapt2 compile ==')
sh(exe('aapt2.exe'), ['compile', '--dir', path.join(appDir, 'res'), '-o', resZip])

// 2) aapt2 link（注意：不带 -A，资产稍后自己打包，避免反斜杠条目名）
console.log('== 2/7 aapt2 link ==')
const baseApk = path.join(work, 'base.apk')
sh(exe('aapt2.exe'), [
  'link', '-o', baseApk,
  '-I', ANDROID_JAR,
  '--manifest', path.join(appDir, 'AndroidManifest.xml'),
  '--java', gen,
  '--min-sdk-version', '24',
  '--target-sdk-version', '34',
  '--version-code', versionCode,
  '--version-name', versionName,
  '--auto-add-overlay',
  resZip,
])

// 3) javac
console.log('== 3/7 javac ==')
const javaFiles = []
const walk = (d, ext, out) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p, ext, out)
    else if (e.name.endsWith(ext)) out.push(p)
  }
  return out
}
walk(path.join(appDir, 'java'), '.java', javaFiles)
walk(gen, '.java', javaFiles)
sh(path.join(JAVA_HOME, 'bin/javac.exe'), [
  '-nowarn', '-encoding', 'UTF-8', '-source', '8', '-target', '8',
  // 必须用 -classpath：android.jar 的 LambdaMetafactory stub 缺 metafactory 方法
  '-classpath', ANDROID_JAR,
  '-d', classes,
  ...javaFiles,
])

// 4) d8
console.log('== 4/7 d8 ==')
const classFiles = walk(classes, '.class', [])
sh(exe('d8.bat'), ['--lib', ANDROID_JAR, '--min-api', '24', '--output', dexout, ...classFiles])

// 5) 重新打包 zip：保留 aapt2 产物（resources.arsc 必须 STORED），assets 一律正斜杠
console.log('== 5/7 打包 assets + dex（正斜杠路径）==')
const packaged = path.join(work, 'packaged.apk')
const assetsDir = path.join(appDir, 'assets')
const packPy = path.join(work, 'pack.py')
fs.writeFileSync(packPy, `
import zipfile, os, sys
base, assets_dir, dex, out = sys.argv[1:5]
def rel(p, root):
    return os.path.relpath(p, root).replace(os.sep, '/').replace('\\\\', '/')
with zipfile.ZipFile(base) as zin, zipfile.ZipFile(out, 'w') as zout:
    for it in zin.infolist():
        data = zin.read(it.filename)
        zi = zipfile.ZipInfo(it.filename, it.date_time)
        zi.compress_type = it.compress_type
        zi.external_attr = it.external_attr
        zout.writestr(zi, data)
    for root, dirs, files in os.walk(assets_dir):
        dirs.sort(); files.sort()
        for f in files:
            p = os.path.join(root, f)
            arc = 'assets/' + rel(p, assets_dir)
            zi = zipfile.ZipInfo(arc, (1980, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zout.writestr(zi, open(p, 'rb').read())
    zi = zipfile.ZipInfo('classes.dex', (1980, 1, 1, 0, 0, 0))
    zi.compress_type = zipfile.ZIP_DEFLATED
    zout.writestr(zi, open(dex, 'rb').read())
print('packed', out)
`)
sh(PYTHON, [packPy, baseApk, assetsDir, path.join(dexout, 'classes.dex'), packaged])

// 5b) 校验：任何条目名仍含反斜杠即失败
const checkPy = path.join(work, 'check.py')
fs.writeFileSync(checkPy, `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
bad = [n for n in z.namelist() if '\\\\' in n]
names = z.namelist()
need = ['assets/index.html', 'assets/css/mobile.css', 'assets/js/mobile.js', 'assets/js/neta.js', 'classes.dex', 'resources.arsc']
missing = [n for n in need if n not in names]
if bad or missing:
    print('BAD ENTRIES:', bad, 'MISSING:', missing); sys.exit(1)
if z.getinfo('resources.arsc').compress_type != 0:
    print('resources.arsc 必须 STORED'); sys.exit(1)
print('entries ok:', len(names))
`)
sh(PYTHON, [checkPy, packaged], { stdio: 'inherit' })

// 6) zipalign + 签名
console.log('== 6/7 zipalign + 签名 ==')
const aligned = path.join(work, 'aligned.apk')
sh(exe('zipalign.exe'), ['-f', '-p', '4', packaged, aligned])
fs.mkdirSync(path.dirname(outApk), { recursive: true })
if (fs.existsSync(outApk)) fs.unlinkSync(outApk)
sh(exe('apksigner.bat'), [
  'sign', '--ks', KEYSTORE, '--ks-pass', `pass:${KS_PASS}`, '--ks-key-alias', KS_ALIAS,
  '--key-pass', `pass:${KS_PASS}`, '--v1-signing-enabled', 'true', '--v2-signing-enabled', 'true',
  '--out', outApk, aligned,
])

// 7) 最终校验（签名后条目名仍需正确）
console.log('== 7/7 校验 ==')
sh(exe('apksigner.bat'), ['verify', '--print-certs', outApk], { stdio: 'inherit' })
sh(PYTHON, [checkPy, outApk], { stdio: 'inherit' })
console.log(`OK: ${outApk} (${(fs.statSync(outApk).size / 1024).toFixed(1)} KB, versionName=${versionName}, versionCode=${versionCode})`)
