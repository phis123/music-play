'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

async function loadVerifyAssets() {
  return import('../tools/verify-assets.mjs')
}

test('firstDiff：相同 Buffer 返回 null，差异返回首个不同偏移与行号', async () => {
  const { firstDiff } = await loadVerifyAssets()
  assert.equal(firstDiff(Buffer.from('a\nb\nc'), Buffer.from('a\nb\nc')), null)
  const diff = firstDiff(Buffer.from('line1\nhello\nline3'), Buffer.from('line1\nworld\nline3'))
  assert.ok(diff)
  assert.equal(diff.line, 2)
  assert.equal(diff.srcLine, 'hello')
  assert.equal(diff.dstLine, 'world')
})

test('compareSyncPairs：一致通过、漂移与缺文件均准确报错', async () => {
  const { compareSyncPairs } = await loadVerifyAssets()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-verify-pairs-'))
  try {
    fs.writeFileSync(path.join(tmp, 'a.js'), 'const x = 1\n')
    fs.writeFileSync(path.join(tmp, 'b.js'), 'const x = 1\n')
    fs.writeFileSync(path.join(tmp, 'c.js'), 'const x = 2\n')

    const okRes = compareSyncPairs({ root: tmp, pairs: [{ src: 'a.js', dst: 'b.js', why: 'ok' }] })
    assert.equal(okRes.ok, true)
    assert.equal(okRes.problems.length, 0)

    const driftRes = compareSyncPairs({ root: tmp, pairs: [{ src: 'a.js', dst: 'c.js', why: 'drift' }] })
    assert.equal(driftRes.ok, false)
    assert.equal(driftRes.results[0].reason, '内容漂移')
    assert.equal(driftRes.results[0].diff.line, 1)

    const missRes = compareSyncPairs({ root: tmp, pairs: [{ src: 'a.js', dst: 'missing.js', why: 'miss' }] })
    assert.equal(missRes.ok, false)
    assert.equal(missRes.results[0].reason, '副本不存在')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('checkPageReferences & runVerify：检测缺失页面引用与真实仓库全绿', async () => {
  const { checkPageReferences, runVerify } = await loadVerifyAssets()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-verify-refs-'))
  try {
    fs.writeFileSync(path.join(tmp, 'ok.js'), '')
    fs.writeFileSync(
      path.join(tmp, 'index.html'),
      '<script src="ok.js"></script><script src="missing.js"></script><a href="https://example.com">x</a>',
    )
    const refs = checkPageReferences({ root: tmp, pages: ['index.html'] })
    assert.equal(refs.ok, false)
    assert.equal(refs.checked, 2)
    assert.equal(refs.problems.length, 1)
    assert.match(refs.problems[0], /missing\.js/)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  const real = runVerify()
  assert.equal(real.ok, true, `真实仓库 verify-assets 应全绿：${real.problems.join('; ')}`)
  assert.ok(real.stats.pairs >= 2, '应至少守护 random.js 与 lrc.js 两对同步副本')
})
