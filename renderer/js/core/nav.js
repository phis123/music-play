/**
 * core/nav.js — 路由切换的让出调度（避免切换时阻塞帧）
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */


/* ---------------- 换页主线程让出 + 全局任务进度与报错中心 (0.4.3) ---------------- */
export let _navYieldUntil = 0

let _impChunkRaf = 0

/** 取消「批量导入分片渲染」占用的 rAF（切页时调用，避免旧列表继续往新视图里追加） */
export function cancelImpChunks() {
  if (_impChunkRaf) { cancelAnimationFrame(_impChunkRaf); _impChunkRaf = 0 }
}
/** 记录/清空分片渲染的 rAF 句柄（跨模块只能通过访问器读，不能直接写 import 绑定） */
export function setImpChunkRaf(id) { _impChunkRaf = id }

export function markNavTransition() {
  _navYieldUntil = Date.now() + 240
  cancelImpChunks()
}

export async function waitNavYield() {
  const rem = _navYieldUntil - Date.now()
  if (rem > 0) await new Promise((r) => setTimeout(r, rem))
}
