/*
 * core/task.js — 后台调度（bgSchedule/bgSleep）、导航让出、全局任务进度中心。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

/* ---------------- 页面切换主线程让出 + 原生后台防冻结定时器 + 全局任务进度中心 (b73) ---------------- */
let _navYieldUntil = 0;

let _impChunkRaf = 0;

let _songChunkToken = 0;

let _currentShownTracks = [];

let _nativeDelaySeq = 1;

const _nativeDelayMap = new Map();
window.__onNativeDelay = function (id) {
  const fn = _nativeDelayMap.get(id);
  if (fn) {
    _nativeDelayMap.delete(id);
    try { fn(); } catch (e) { }
  }
};

function bgSchedule(fn, ms) {
  const d = Math.max(0, +(ms || 0));
  if (A && typeof A.nativeDelay === 'function') {
    const id = _nativeDelaySeq++;
    _nativeDelayMap.set(id, fn);
    try {
      A.nativeDelay(id, d);
      return id;
    } catch (e) {
      _nativeDelayMap.delete(id);
    }
  }
  return setTimeout(fn, d);
}

function bgSleep(ms) {
  return new Promise((r) => bgSchedule(r, ms));
}

window.bgSleep = bgSleep;

let _lastBgNotiAt = 0;

function syncNativeBgTask(active, title, sub, force) {
  if (!A || typeof A.setBgTask !== 'function') return;
  const now = Date.now();
  if (active && !force && now - _lastBgNotiAt < 700) return;
  _lastBgNotiAt = now;
  try { A.setBgTask(!!active, String(title || ''), String(sub || '')); } catch (e) { }
}

function markNavTransition() {
  _navYieldUntil = Date.now() + 260;
  _songChunkToken++;
  if (_impChunkRaf) { cancelAnimationFrame(_impChunkRaf); _impChunkRaf = 0; }
}

async function waitNavYield() {
  const rem = _navYieldUntil - Date.now();
  if (rem > 0) await bgSleep(rem);
}

let _taskAutoHideTimer = null;

function startTask(kind, title, sub, total, indet, stopLabel) {
  clearTimeout(_taskAutoHideTimer);
  S.task = {
    active: true,
    kind: kind || '',
    title: title || '正在处理…',
    sub: sub || '',
    done: 0,
    total: total || 0,
    ok: 0,
    fail: 0,
    errors: [],
    indet: !!indet,
    stopLabel: stopLabel || '',
  };
  syncNativeBgTask(true, S.task.title, S.task.sub, true);
  updateTaskBanner();
}

function stepTask(done, sub, okDelta, failDelta) {
  const tk = S.task;
  if (done != null) tk.done = done;
  if (sub != null) tk.sub = sub;
  if (okDelta) tk.ok += okDelta;
  if (failDelta) tk.fail += failDelta;
  syncNativeBgTask(true, tk.title, tk.sub, false);
  updateTaskBanner();
}

function recordTaskError(name, reason) {
  const tk = S.task;
  tk.fail = (tk.fail || 0) + 1;
  tk.errors.push({ name: String(name || '未知项'), reason: String(reason || '未知错误') });
  updateTaskBanner();
}

function finishTask(title, sub, autoHideMs) {
  const tk = S.task;
  tk.active = false;
  tk.indet = false;
  tk.done = tk.total || 1;
  tk.total = tk.total || 1;
  if (title) tk.title = title;
  if (sub != null) tk.sub = sub;
  syncNativeBgTask(false, '', '', true);
  updateTaskBanner();
  clearTimeout(_taskAutoHideTimer);
  if (!tk.errors.length && autoHideMs !== 0) {
    _taskAutoHideTimer = setTimeout(() => {
      if (!S.task.active && !S.task.errors.length) dismissTask();
    }, autoHideMs || 4200);
  }
}

function dismissTask() {
  clearTimeout(_taskAutoHideTimer);
  syncNativeBgTask(false, '', '', true);
  S.task = { active: false, kind: '', title: '', sub: '', done: 0, total: 0, ok: 0, fail: 0, errors: [], indet: false, stopLabel: '' };
  const box = document.getElementById('taskBanner');
  if (box) { box.classList.add('hidden'); box.innerHTML = ''; }
}

function updateTaskBanner() {
  const box = document.getElementById('taskBanner');
  if (!box) return;
  const tk = S.task;
  if (!tk.active && !tk.title) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  box.classList.toggle('has-err', tk.errors.length > 0 && !tk.active);
  const pct = tk.total > 0 ? Math.min(100, Math.round((tk.done * 100) / tk.total)) : (tk.active ? 35 : 100);
  const errBtn = tk.errors.length
    ? `<button class="task-btn warn" data-task-err="1">报错详情 (${tk.errors.length})</button>`
    : '';
  const stopBtn = tk.active && tk.stopLabel
    ? `<button class="task-btn" data-task-stop="1">${esc(tk.stopLabel)}</button>`
    : '';
  const closeBtn = !tk.active
    ? `<button class="task-btn" data-task-dismiss="1">关闭</button>`
    : '';

  let topEl = box.querySelector('.task-top');
  if (!topEl) {
    box.innerHTML = `
      <div class="task-top">
        <div style="flex:1;min-width:0">
          <div class="task-title" id="tbTitle"></div>
          <div class="task-sub" id="tbSub"></div>
        </div>
        <div class="task-acts" id="tbActs"></div>
      </div>
      <div class="task-track"><div class="task-bar" id="tbBar"></div></div>`;
  }
  const tEl = document.getElementById('tbTitle');
  const sEl = document.getElementById('tbSub');
  const aEl = document.getElementById('tbActs');
  const bEl = document.getElementById('tbBar');
  if (tEl) tEl.textContent = tk.title + (tk.total > 0 && tk.active ? ` (${tk.done}/${tk.total})` : '');
  if (sEl) sEl.textContent = tk.sub || '';
  if (aEl) aEl.innerHTML = errBtn + stopBtn + closeBtn;
  if (bEl) {
    bEl.classList.toggle('indet', !!tk.indet && tk.active);
    bEl.style.width = pct + '%';
  }
}
