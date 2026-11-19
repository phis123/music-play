/*
 * core/bridge.js — Android JS 桥门面（window.Android 的获取与刷新）。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

let A = window.Android || null;

function grabBridge() { if (!A) A = window.Android || null; return !!A; }

window.MP.bridge = { grab: grabBridge, get android() { return A; } };
