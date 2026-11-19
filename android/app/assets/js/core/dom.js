/*
 * core/dom.js — DOM 查询与格式化/提示等无状态工具。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

const $ = (s) => document.querySelector(s);

/* ---------------- 工具 ---------------- */
const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

function toast(m) { if (A) A.toast(m); }

/* ---------------- 存储权限（Android 11+ 删/写共享存储必需） ---------------- */
function storageOK() {
  try { return (A && A.hasAllFiles) ? !!A.hasAllFiles() : true; } catch (e) { return true; }
}

function askStorage() { openSheet('storage'); }

const mbStr = (got, total) => (got / 1048576).toFixed(1) + 'M' + (total > 0 ? '/' + (total / 1048576).toFixed(1) + 'M' : '');

window.MP.dom = { $: $, fmt: fmt, esc: esc, toast: toast };
