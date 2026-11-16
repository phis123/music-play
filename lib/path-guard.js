'use strict'
const path = require('path')
const fs = require('fs')

// ---------- IPC 路径边界校验（P0-2） ----------
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
// 2. assertInsideLibrary(filePath, explicitRootString) —— 单测环境直接传入期望曲库根字符串
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

module.exports = {
  authorizeDir,
  resetAuthorizedDirs,
  assertInsideLibrary,
  isInsideLibrary,
}
