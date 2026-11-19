/*
 * library/voices.js — 在线声源试听与下载。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

/* ---------------- 声音匹配 / 下载 ---------------- */
async function openVoices(songId) {
  const song = S.online.songs.find((x) => String(x.id) === String(songId));
  if (!song) return;
  S.voices = { song: song, list: [], loading: true, err: '', busy: {} };
  S.page = { name: 'voices', arg: songId };
  render();
  try {
    const list = await window.neta.searchVoices(song.name + ' ' + (song.artist || ''), 20);
    S.voices.list = list;
    S.voices.loading = false;
  } catch (e) {
    S.voices.err = '匹配失败：' + (e.message || e);
    S.voices.loading = false;
  }
  render();
}

async function previewVoice(i) {
  const v = S.voices.list[i];
  if (!v) return;
  try {
    const u = await window.neta.songUrl(v.mainTrackId);
    if (!u || !u.url) { toast('试听地址不可用'); return; }
    if (A && typeof A.previewEx === 'function') A.previewEx(u.url, (v.title || '试听'), voiceArtist(v), v.cover || '');
    else A.preview(u.url, (v.title || '试听'), v.cover || '');
    let started = true;
    try { if (typeof A.isPlaying === 'function') started = !!A.isPlaying(); } catch (e2) { }
    if (started) enterPreviewMode(v.title, voiceArtist(v), v.cover, v.duration);
    else { S.playing = false; paintPlayIcon(); }
    toast(started ? ('试听中：' + (v.title || '')) : '试听没能开始，音源可能已失效');
  } catch (e) {
    toast('试听失败：' + (e.message || e));
  }
}

/** 下一次下载并等它结束；桥那边用全局回调报结果，这里临时接管一下 */

/** 下一次下载并等它结束；桥那边用全局回调报结果，这里临时接管一下 */
function downloadOnce(url, name, lrc) {
  return new Promise((resolve) => {
    const orig = window.onDownloadDone;
    let done = false;
    const fin = (ok, p) => {
      if (done) return;
      done = true;
      window.onDownloadDone = orig;
      try { orig.call(window, ok, p); } catch (e) { }
      resolve({ ok: !!ok, p: p });
    };
    window.onDownloadDone = fin;
    try {
      A.downloadAsync(url, name, lrc);
    } catch (e) {
      fin(false, String((e && e.message) || e));
    }
  });
}

async function downloadVoice(i) {
  const v = S.voices.list[i];
  const song = S.voices.song;
  if (!v) return;
  S.voices.busy[v.mainTrackId] = '下载中';
  render();
  try {
    // 音频：来自匹配到的播客声音
    let firstUrl = '';
    try {
      const u = await window.neta.songUrl(v.mainTrackId);
      if (u && u.url) firstUrl = u.url;
    } catch (e) { }
    // 歌词：用【原歌曲】的，不用声音的
    let lrc = '';
    try {
      const ly = await window.neta.lyric(song.id);
      lrc = ly ? (window.neta.mergeLrc ? window.neta.mergeLrc(ly.lrc || '', ly.tlyric || '') : (ly.lrc || '')) : '';
    } catch (e) { }
    // 文件名与元数据：一律用原歌曲，声音不参与
    // 文件名：去非法字符、去首尾点空格、限长（部分机型对超长名会直接写失败）
    const safe = String(song.name || '未知歌曲').replace(/[\\/:*?"<>|]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 60) || '未知歌曲';
    window.__dlCtx = { song: song, voice: v, lrc: lrc };
    S.voices.activeKey = v.mainTrackId;
    S.voices.activeIdx = i;
    S.voices.busy[v.mainTrackId] = '0%';
    render();
    if (!A.downloadAsync) {
      // 兜底：老桥只有同步下载
      if (!firstUrl) throw new Error('拿不到音频地址（可能受版权限制）');
      const r2 = JSON.parse(A.download(firstUrl, safe + '.mp3', lrc));
      S.voices.busy[v.mainTrackId] = r2 && r2.ok ? '完成' : '失败';
      toast(r2 && r2.ok ? '已保存到 Music/' : '下载失败');
      loadLibrary();
      render();
      return;
    }
    let last = null;
    if (firstUrl) last = await downloadOnce(firstUrl, safe + '.mp3', lrc);
    // 失败就换地址重试：旧接口每次给的 CDN 节点不同，一首歌抽风换一个往往就好
    if (!last || !last.ok) {
      let u2 = null;
      try { u2 = await window.neta.songUrl(v.mainTrackId); } catch (e) { }
      if (u2 && u2.url && u2.url !== firstUrl) {
        S.voices.busy[v.mainTrackId] = '重试中';
        render();
        last = await downloadOnce(u2.url, safe + '.mp3', lrc);
      }
    }
    if ((!last || !last.ok) && window.neta.songUrlV1) {
      const u3 = await window.neta.songUrlV1(v.mainTrackId, 'exhigh');
      if (u3 && u3.url) {
        S.voices.busy[v.mainTrackId] = '重试中';
        render();
        last = await downloadOnce(u3.url, safe + '.mp3', lrc);
      }
    }
    if (!last || !last.ok) {
      throw new Error('下载失败：' + ((last && last.p) || '拿不到音频地址（可能受版权或会员限制）'));
    }
  } catch (e) {
    S.voices.busy[v.mainTrackId] = '失败';
    toast(e.message || '下载失败');
  }
  render();
}
