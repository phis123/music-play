/*
 * core/bus.js — 事件总线（MP.bus）：跨模块只发事件/订阅，不互相直接改状态。
 * 本轮严格保持行为不变：现有回调仍走原路径，总线为后续把「状态变更 → 视图刷新」解耦预留。
 * 约束：emit 里不得抛出（监听器异常被吞并入 diag 日志，避免打断播放主流程）。
 */
'use strict';
window.MP = window.MP || {};
(function () {
  var handlers = Object.create(null);
  function on(evt, fn) {
    if (typeof fn !== 'function' || !evt) return function () { };
    (handlers[evt] || (handlers[evt] = [])).push(fn);
    return function off() { var a = handlers[evt] || []; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
  }
  function off(evt, fn) {
    var a = handlers[evt];
    if (!a) return;
    if (!fn) { handlers[evt] = []; return; }
    var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
  }
  function emit(evt, data) {
    var a = handlers[evt];
    if (!a || !a.length) return;
    for (var i = 0; i < a.length; i++) {
      try { a[i](data); } catch (e) {
        try { if (window.MP && MP.bus && MP.bus._log) MP.bus._log(evt, e); } catch (e2) { }
      }
    }
  }
  window.MP.bus = { on: on, off: off, emit: emit, _handlers: handlers };
})();
