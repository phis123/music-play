/**
 * core/state.js — 全局状态对象（唯一可变真相，其它模块只读写它的字段）
 * 本文件由 renderer/js/app.js 阶段4 模块化拆分而来：函数体逐字保留，仅新增 import/export。
 */


export const state = {
  tracks: [],
  cur: -1,
  queuePaths: [],
  qPos: -1,
  hist: [],
  mode: (function () { try { return localStorage.getItem('desk:mode') || 'loop' } catch { return 'loop' } })(),
  vol: (function () { try { const v = parseFloat(localStorage.getItem('desk:vol')); return Number.isFinite(v) ? v : 1 } catch { return 1 } })(),
  muted: false,
  lines: [],
  activeIdx: -1,
  lastUserScrollAt: 0,
  floatOn: false,
  offsetMs: 0,
  searchTab: 'local',
  root: '',
  sheetKind: '',
  srcSwitch: { track: null, kw: '', loading: false, cands: [], err: '', prevId: '', busyId: '', savedTime: 0, wasPlaying: false },
  theme: (function () { try { return localStorage.getItem('desk:theme') || 'auto' } catch { return 'auto' } })(),
  listFilter: '',
  listSort: 'default',
  healthTab: 'dup',
  task: { active: false, kind: '', title: '', sub: '', done: 0, total: 0, ok: 0, fail: 0, errors: [], indet: false, stopLabel: '' },
  // 0.4.4：主设置（音量平衡 / 随机策略 / 歌词字号与配色）+ 悬浮歌词样式 + 单曲设置
  normEnabled: (function () { try { const v = localStorage.getItem('desk:normEnabled'); return v == null ? true : v === '1' } catch { return true } })(),
  normPreset: (function () { try { return localStorage.getItem('desk:normPreset') || 'standard' } catch { return 'standard' } })(),
  randomStrategy: (function () { try { return localStorage.getItem('desk:randomStrategy') || 'no-repeat' } catch { return 'no-repeat' } })(),
  shufflePlayed: new Set(),
  lrcSize: (function () { try { return Math.min(28, Math.max(14, +(localStorage.getItem('desk:lrcSize') || 18))) } catch { return 18 } })(),
  lrcColor: (function () { try { return localStorage.getItem('desk:lrcColor') || '#ec4141' } catch { return '#ec4141' } })(),
  floatColor: (function () { try { return localStorage.getItem('lyColor') || '#ffffff' } catch { return '#ffffff' } })(),
  floatSize: (function () { try { return Math.min(40, Math.max(14, +(localStorage.getItem('lySize') || 22))) } catch { return 22 } })(),
  floatBgOpacity: (function () { try { return Math.min(80, Math.max(0, +(localStorage.getItem('lyBgOpacity') || 0))) } catch { return 0 } })(),
  floatLocked: false,
  lpMiniOpen: false,
}
