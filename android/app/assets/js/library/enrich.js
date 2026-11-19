/*
 * library/enrich.js — 曲目补全（补标签/歌词/封面）与删除。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

/* ---------------- 本地扫描与曲目补全（带进度条、局部更新与错误反馈） ---------------- */
let enriching = false;

async function manualRescan() {
  grabBridge();
  const prevCount = S.tracks.length;
  startTask('scan', '正在扫描本地音乐…', '正在遍历 /sdcard/Music 与应用私有目录', 3, false);
  stepTask(1, '触发系统媒体库扫描 (MediaScanner)…');
  try {
    if (A && A.rescan) A.rescan();
  } catch (e) {
    recordTaskError('系统媒体库触发', e.message || String(e));
  }
  await new Promise((r) => setTimeout(r, 450));
  stepTask(2, '正在读取音频文件列表与缓存标签…');
  try {
    loadLibrary();
  } catch (e) {
    recordTaskError('读取本地音频列表', e.message || String(e));
  }
  await new Promise((r) => setTimeout(r, 350));
  loadLibrary();
  // 检查权限与目录可读性诊断
  try {
    if (A && A.storageInfo) {
      const d = JSON.parse(A.storageInfo() || '{}');
      if (!d.allFiles) {
        recordTaskError('存储权限提醒', '尚未开启「所有文件访问权限」，Android 11+ 可能无法读写公共 Music 目录（可在「我的 → 存储权限」开启）');
      }
      if (!d.publicListable && d.privateAudio === 0) {
        recordTaskError('公共音乐目录不可读', '无法列出公共 Music 目录文件，请检查存储权限');
      }
    }
  } catch (e) { }
  const nowCount = S.tracks.length;
  const diff = nowCount - prevCount;
  const diffTxt = diff > 0 ? `新增 ${diff} 首` : diff < 0 ? `减少 ${Math.abs(diff)} 首` : '曲目数无变化';
  if (nowCount === 0 && !S.task.errors.length) {
    recordTaskError('扫描结果为空', '未在 /sdcard/Music 或 /sdcard/Music/music-play 发现音频文件');
  }
  finishTask(
    `本地音乐扫描完成（共 ${nowCount} 首）`,
    `${diffTxt}${S.task.errors.length ? ` · 发现 ${S.task.errors.length} 项提醒` : ' · 全部正常'}`,
    4500
  );
  render();
}

function updateTrackDomInPlace(t) {
  if (!t || !t.path) return;
  const idx = S.tracks.indexOf(t);
  if (idx < 0) return;
  document.querySelectorAll(`[data-song="${idx}"]`).forEach((row) => {
    const cov = row.querySelector('[data-cover]');
    if (cov) coverFor(t, cov);
    const sub = row.querySelector('.row-sub');
    if (sub) sub.textContent = `${t.artist || '未知艺人'} · ${fmt(t.duration)}${t.hasLrc ? ' · 词' : ''}`;
  });
}

async function addToPlaylist(t) {
  if (!t) return;
  openSheet('addpl', t);
}

function deleteTrack(t) {
  if (!t) return;
  openSheet('del', t);
}

async function enrichTracks(manual) {
  if (enriching) {
    if (manual) toast('正在后台匹配封面与歌词，请稍候…');
    return;
  }
  if (!window.neta) {
    if (manual) {
      startTask('enrich', '匹配封面与歌词失败', '当前处于离线模式或网络组件未就绪', 1, false);
      recordTaskError('网络模块', 'window.neta 不可用');
      finishTask('匹配封面与歌词失败', '请检查网络连接');
    }
    return;
  }
  const todo = S.tracks.filter((t) => {
    if (manual) {
      return !t.hasLrc || !t.artist || (!t.cover && !S.covers.get(t.path));
    }
    if (t._enriched) return false;
    const cached = localStorage.getItem('meta:' + t.path);
    if (cached) {
      try {
        const m = JSON.parse(cached);
        t.artist = m.artist || t.artist || '';
        t.cover = m.cover || '';
        t.hasLrc = t.hasLrc || !!m.hasLrc;
        if (m.alias) t.alias = String(m.alias).split('|');
        if (m.title && (!t.title || t.title.length > 40)) t.title = m.title;
        if (m.v === 2) { t._enriched = true; return false; }
      } catch (e) { }
      return true;
    }
    return true;
  }).slice(0, manual ? Infinity : 12);

  if (!todo.length) {
    if (manual) {
      startTask('enrich', '封面与歌词检查完成', '所有本地曲目均已有封面、歌手与歌词', 1, false);
      finishTask('无需补齐', '所有曲目均已有完整封面与歌词', 3200);
    }
    return;
  }

  enriching = true;
  window.__enrichStop = false;
  startTask('enrich', '正在匹配封面与歌词', `准备处理 ${todo.length} 首曲目…`, todo.length, false, '停止');
  let done = 0, okCnt = 0;
  try {
    for (const t of todo) {
      if (window.__enrichStop) break;
      await waitNavYield();
      done++;
      stepTask(done, `正在匹配 (${done}/${todo.length})：${t.title || '未知'}`);
      try {
        const q = (t.title + ' ' + (t.artist || '')).trim();
        const list = await window.neta.searchSongs(q, 5);
        const hit = (list || []).find((x) => x.name && t.title && (x.name.includes(t.title) || t.title.includes(x.name))) || (list && list[0]);
        if (!hit) {
          t._enriched = true;
          recordTaskError(t.title || t.path, `未搜到匹配歌曲（关键词：${q}）`);
          continue;
        }
        if (!t.artist) t.artist = hit.artist || '';
        if (hit.cover) {
          t.cover = hit.cover;
          S.covers.set(t.path, hit.cover);
        }
        let hasLrc = t.hasLrc;
        let lrcErr = '';
        if (!hasLrc) {
          try {
            const ly = await window.neta.lyric(hit.id);
            const merged = ly ? (window.neta.mergeLrc ? window.neta.mergeLrc(ly.lrc || '', ly.tlyric || '') : (ly.lrc || '')) : '';
            if (merged && merged.length > 30 && A && A.saveLyric) {
              hasLrc = A.saveLyric(t.path, merged);
              t.hasLrc = hasLrc;
              if (!hasLrc) lrcErr = '写入本地 .lrc 失败（请检查存储权限）';
            } else {
              lrcErr = '网易云该曲目暂无滚动歌词';
            }
          } catch (e2) {
            lrcErr = '拉取歌词失败：' + (e2.message || e2);
          }
        }
        try { t.kbps = A && A.bitrate ? A.bitrate(t.path) : 0; } catch (e) { }
        t._enriched = true;
        if (!t.alias || !t.alias.length) t.alias = hit.alias || [];
        localStorage.setItem('meta:' + t.path, JSON.stringify({
          artist: t.artist, cover: t.cover, hasLrc: hasLrc,
          alias: (t.alias || []).join('|'), title: t.title || hit.name || '', v: 2,
        }));
        if (lrcErr && manual) {
          recordTaskError(t.title, lrcErr);
        } else {
          okCnt++;
        }
        updateTrackDomInPlace(t);
        if (S.page.name === 'health') render();
        await bgSleep(180);
      } catch (e) {
        t._enriched = true;
        recordTaskError(t.title || t.path, '网络或接口异常：' + (e.message || e));
      }
    }
  } finally {
    enriching = false;
    const stopMsg = window.__enrichStop ? '（已手动停止）' : '';
    finishTask(
      `封面与歌词匹配完成${stopMsg}`,
      `成功更新 ${okCnt} 首${S.task.errors.length ? ` · 异常/未匹配 ${S.task.errors.length} 首` : ''}`,
      5000
    );
  }
}

const enrichMissing = () => enrichTracks(true);
