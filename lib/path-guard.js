'use strict'
const path = require('path')
const fs = require('fs')

// ---------- IPC 路径边界校验（P0-1 / P0-2） ----------
// 渲染层被注入时，IPC 传入的任意路径都不可信：所有读写删 handler 只允许
// 操作「用户明确授权过的目录」内的文件。授权目录 = 当前曲库根 + 用户经
// 系统对话框（dialog:pickFolder）或 library:scan 明确选过的目录（只增不减，
// 避免多目录场景下换过曲库根后旧曲库的收藏/删歌被误伤）。
const authorizedDirs = new Set()

function _normForCompare(p) {
  return process.platform === 'win32' ? String(p).toLowerCase() : String(p)
}

function _canonicalize(p) {
  const abs = path.resolve(p)
  try {
    return fs.realpathSync(abs)
  } catch {
    let cur = abs
    const rest = []
    for (;;) {
      const parent = path.dirname(cur)
      if (parent === cur) return abs
      rest.unshift(path.basename(cur))
      cur = parent
      try {
        return path.join(fs.realpathSync(cur), ...rest)
      } catch { /* 继续向上找存在的祖先 */ }
    }
  }
}

function _isInside(dir, file) {
  const d = _normForCompare(path.resolve(dir))
  const f = _normForCompare(file)
  return f === d || f.startsWith(d + path.sep)
}

function authorizeDir(dir) {
  if (typeof dir !== 'string' || !dir) return
  try {
    authorizedDirs.add(_canonicalize(dir))
  } catch { /* 授权失败时不抛错 */ }
}

function resetAuthorizedDirs() {
  authorizedDirs.clear()
}

// 兼容两种调用形式：
// 1. assertInsideLibrary(filePath, { allowUserData, userDataDir }) —— 生产环境对照 authorizedDirs 集合
// 2. assertInsideLibrary(filePath, explicitRootString) —— 单测或指定根目录校验
function assertInsideLibrary(filePath, rootOrOpts = {}) {
  if (typeof filePath !== 'string' || !filePath) {
    throw Object.assign(new Error('PATH_OUTSIDE_LIBRARY：路径不在曲库授权目录内'), { code: 'PATH_OUTSIDE_LIBRARY' })
  }
  const resolved = _canonicalize(filePath)
  if (typeof rootOrOpts === 'string') {
    if (!rootOrOpts) {
      throw Object.assign(new Error('PATH_OUTSIDE_LIBRARY：路径不在曲库授权目录内'), { code: 'PATH_OUTSIDE_LIBRARY' })
    }
    const canonRoot = _canonicalize(rootOrOpts)
    if (_isInside(canonRoot, resolved)) return resolved
    throw Object.assign(new Error('PATH_OUTSIDE_LIBRARY：路径不在曲库授权目录内'), { code: 'PATH_OUTSIDE_LIBRARY' })
  }
  const { allowUserData = false, userDataDir = '' } = rootOrOpts || {}
  for (const dir of authorizedDirs) {
    if (_isInside(dir, resolved)) return resolved
  }
  if (allowUserData && userDataDir) {
    try {
      if (_isInside(_canonicalize(userDataDir), resolved)) return resolved
    } catch { }
  }
  throw Object.assign(new Error('PATH_OUTSIDE_LIBRARY：路径不在曲库授权目录内'), { code: 'PATH_OUTSIDE_LIBRARY' })
}

function isInsideLibrary(filePath, rootOrOpts) {
  try {
    assertInsideLibrary(filePath, rootOrOpts)
    return true
  } catch {
    return false
  }
}

/**
 * 派生文件（.lrc / .jpg / .downloading 等）安全写入校验：
 * - 校验最终目标路径在授权曲库内（含父目录 realpath 校验）；
 * - 若目标路径已存在且本身是符号链接（含指向库外尚未存在目标的断链 symlink），直接拒绝写入。
 */
function assertSafeWriteTarget(filePath, rootOrOpts = {}) {
  if (typeof filePath !== 'string' || !filePath) {
    throw Object.assign(new Error('PATH_OUTSIDE_LIBRARY：写入路径无效'), { code: 'PATH_OUTSIDE_LIBRARY' })
  }
  const abs = path.resolve(filePath)
  try {
    const lst = fs.lstatSync(abs)
    if (lst.isSymbolicLink()) {
      throw Object.assign(new Error('PATH_OUTSIDE_LIBRARY：拒绝向符号链接目标写入文件'), { code: 'PATH_OUTSIDE_LIBRARY' })
    }
  } catch (e) {
    if (e && e.code === 'PATH_OUTSIDE_LIBRARY') throw e
    // ENOENT 表示目标文件尚不存在，继续做曲库边界与祖先 realpath 校验
  }
  return assertInsideLibrary(abs, rootOrOpts)
}

/**
 * 普通下载（net:download）参数校验：
 * - 普通下载只能写入授权曲库目录（rootDir）；
 * - 严禁透传 overwritePath 或 targetPath（防止通过 overwritePath 绕过 targetPath 校验写任意路径）；
 * - 返回干净白名单字段 { voice, song, dir }，绝不原样展开 ...payload。
 */
function validateDownloadPayload(payload, rootDir) {
  if (!payload || typeof payload !== 'object') {
    throw Object.assign(new Error('INVALID_PAYLOAD：下载参数无效'), { code: 'INVALID_PAYLOAD' })
  }
  if (payload.overwritePath !== undefined || payload.targetPath !== undefined) {
    throw Object.assign(
      new Error('PATH_OUTSIDE_LIBRARY：普通下载禁止指定覆盖路径（overwritePath/targetPath），只能写入授权曲库目录'),
      { code: 'PATH_OUTSIDE_LIBRARY' }
    )
  }
  const checkedDir = rootDir ? assertInsideLibrary(rootDir) : undefined
  return {
    voice: payload.voice,
    song: payload.song,
    dir: checkedDir,
  }
}

/**
 * 替换音源（net:replaceSource）参数校验：
 * - 统一接收 targetPath（兼容旧字段 overwritePath，但若两者同时存在且不一致则直接拒绝）；
 * - 目标文件必须为非空字符串且通过 assertInsideLibrary 曲库白名单校验；
 * - 返回统一后的 { voice, song, dir, targetPath }。
 */
function validateReplaceSourcePayload(payload, rootDir) {
  if (!payload || typeof payload !== 'object') {
    throw Object.assign(new Error('INVALID_PAYLOAD：替换音源参数无效'), { code: 'INVALID_PAYLOAD' })
  }
  if (
    payload.targetPath !== undefined &&
    payload.overwritePath !== undefined &&
    payload.targetPath !== payload.overwritePath
  ) {
    throw Object.assign(
      new Error('PATH_OUTSIDE_LIBRARY：targetPath 与 overwritePath 字段不一致，已拒绝'),
      { code: 'PATH_OUTSIDE_LIBRARY' }
    )
  }
  const rawTarget = payload.targetPath !== undefined ? payload.targetPath : payload.overwritePath
  const checkedTarget = assertInsideLibrary(rawTarget)
  const checkedDir = rootDir ? assertInsideLibrary(rootDir) : path.dirname(checkedTarget)
  return {
    voice: payload.voice,
    song: payload.song,
    dir: checkedDir,
    targetPath: checkedTarget,
  }
}

module.exports = {
  authorizeDir,
  resetAuthorizedDirs,
  assertInsideLibrary,
  isInsideLibrary,
  assertSafeWriteTarget,
  validateDownloadPayload,
  validateReplaceSourcePayload,
}
