/*
 * library/covers.js — 封面队列、JNI 取封面与懒加载观察器。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

let _jniCoverQueue = [];

let _jniCoverRaf = 0;
/** 本次会话内已确认取不到封面的曲目（不再反复排队；「重建歌手/封面」会清空） */

/** 本次会话内已确认取不到封面的曲目（不再反复排队；「重建歌手/封面」会清空） */
const _coverMiss = new Set();

function pumpJniCoverQueue() {
  _jniCoverRaf = 0;
  let budget = 2; // 每帧最多提取 2 张内嵌封面，防止低频 SoC 卡顿
  while (_jniCoverQueue.length && budget > 0) {
    const item = _jniCoverQueue.shift();
    if (!item || !item.el || !item.el.isConnected) continue;
    const t = item.t;
    const key = t.path;
    if (S.covers.has(key)) {
      const v = S.covers.get(key);
      if (v) item.el.style.backgroundImage = `url("${v}")`;
      continue;
    }
    let data = '';
    try { data = A && A.cover ? A.cover(key) : ''; } catch (e) { data = ''; }
    if (data) {
      S.covers.set(key, data);
      item.el.style.backgroundImage = `url("${data}")`;
    } else {
      // 取不到就先记下来，不写进 S.covers（避免空串把「以后可能成功」永久锁死）
      _coverMiss.add(key);
    }
    budget--;
  }
  if (_jniCoverQueue.length) {
    _jniCoverRaf = requestAnimationFrame(pumpJniCoverQueue);
  }
}

function coverFor(t, el) {
  if (!t || !el) return;
  const key = t.path;
  if (S.covers.has(key)) {
    const v = S.covers.get(key);
    if (v) el.style.backgroundImage = `url("${v}")`;
    return;
  }
  if (t.cover) {
    S.covers.set(key, t.cover);
    el.style.backgroundImage = `url("${t.cover}")`;
    return;
  }
  if (_coverMiss.has(key)) return;
  _jniCoverQueue.push({ t, el });
  if (!_jniCoverRaf) _jniCoverRaf = requestAnimationFrame(pumpJniCoverQueue);
}

let _coverIo = null;

function ensureCoverObserver() {
  if (_coverIo || typeof IntersectionObserver !== 'function') return _coverIo;
  _coverIo = new IntersectionObserver((entries) => {
    for (const ent of entries) {
      if (!ent.isIntersecting) continue;
      const el = ent.target;
      _coverIo.unobserve(el);
      const t = S.tracks[+el.dataset.cover];
      if (t) coverFor(t, el);
    }
  }, { rootMargin: '260px 0px' });
  return _coverIo;
}
