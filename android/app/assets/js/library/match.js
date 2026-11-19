/*
 * library/match.js — 本地检索与「歌名/时长」匹配打分（纯函数）。
 * 依赖：window.MP（本文件自行初始化）；无打包器，按 index.html 顺序加载。
 */
'use strict';
window.MP = window.MP || {};

/* ---------------- 本地检索：标题/歌手/专辑/别名/文件名都认 ---------------- */
/** 去掉空白与标点后小写，给「rolling girl」→「rollinggirl」这种比较用 */
function idNorm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[\s\-_—–·・.,，。:：;；!！?？'"“”‘’\/\\|~`+*#@&^%$=<>{}\[\]()（）【】「」]/g, '');
}
/** 曲目的别名/译名（存在 meta 缓存里） */

/** 曲目的别名/译名（存在 meta 缓存里） */
function trackAliases(t) {
  if (Array.isArray(t.alias) && t.alias.length) return t.alias;
  if (typeof t.alias === 'string' && t.alias) return t.alias.split('|');
  try {
    const meta = JSON.parse(localStorage.getItem('meta:' + t.path) || 'null');
    if (meta && meta.alias) return String(meta.alias).split('|');
  } catch (e) { }
  return [];
}
/** 一个曲目的可检索文本 */

/** 一个曲目的可检索文本 */
function trackHay(t) {
  const base = String(t.path || '').split('/').pop().replace(/\.[^.]+$/, '');
  return idNorm([t.title, t.artist, t.album, base, trackAliases(t).join(' ')].join(' '));
}
/** 本地检索：空关键词算命中 */

/** 本地检索：空关键词算命中 */
function matchTrack(t, kw) {
  const nq = idNorm(kw);
  if (!nq) return true;
  return trackHay(t).indexOf(nq) >= 0;
}

/* ---------------- 标题 / 时长比对（匹配纠错） ---------------- */
function firstArtistClean(a) {
  const raw = String(a || '').split(/[\/、,&]|feat\.?\s*/i).map((x) => x.trim()).filter(Boolean)[0] || '';
  return raw.replace(/\s*[（(【\[].*?[）)】\]]\s*/g, ' ').trim() || raw;
}

function unwrapSongQuotes(s) {
  return String(s == null ? '' : s).replace(/^[『「《【]+|[』」》】]+$/g, '').replace(/\s+/g, ' ').trim();
}

function looseSongName(s) {
  const raw = unwrapSongQuotes(s);
  const stripped = raw
    .replace(/\s+[（(【\[][^）)】\]]*[）)】\]]/g, '')
    .replace(/^[（(【\[][^）)】\]]*[）)】\]]\s+/g, '')
    .replace(/[（(][^）)]*(?:feat\.?|ver\.?|version|edit|mix|ost|op|ed|inst|off\s*vocal)[^）)]*[）)]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 2 ? stripped : raw;
}

function normNameRaw(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/^声音[:：]?\s*/, '')
    .replace(/^\d{1,3}\s*[-._、)\]]\s*/, '')
    .replace(/^\d{2}\s+(?=[a-z\u4e00-\u9fa5])/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function normName(s) {
  const stripped = String(s == null ? '' : s)
    .replace(/^声音[:：]?\s*/, '')
    .replace(/^\d{1,3}\s*[-._、)\]]\s*/, '')
    .replace(/^\d{2}\s+(?=[a-z\u4e00-\u9fa5])/i, '')
    .replace(/\s+[【\[（(][^】\]）)]*[】\]）)]/g, ' ')
    .replace(/^[【\[（(][^】\]）)]*[】\]）)]\s*/g, ' ')
    .replace(/[（(][^）)]*(?:feat\.?|ver\.?|version|edit|mix|ost|op|ed|inst|off\s*vocal)[^）)]*[）)]/gi, ' ');
  const k = normNameRaw(stripped);
  return k.length >= 2 ? k : normNameRaw(s);
}

function durGap(songDur, voiceDur) {
  const a = +(songDur || 0), b = +(voiceDur || 0);
  if (!a || !b) return null;
  return b - a;
}

function scoreVoice(song, v) {
  const sName = String((song && song.name) || '');
  const vTitle = String((v && v.title) || '').replace(/^声音[:：]?\s*/, '').trim();
  const nsRaw = normNameRaw(sName), ns = normName(sName);
  const nvRaw = normNameRaw(vTitle), nv = normName(vTitle);
  const fa = normNameRaw(firstArtistClean((song && song.artist) || ''));
  let tScore = 0, tKind = 'none';
  if (!nsRaw && sName.trim()) {
    const sym = sName.trim();
    if (vTitle.indexOf(sym) >= 0 || vTitle.indexOf('_') >= 0 || vTitle.indexOf('-') >= 0) {
      tScore = (fa && nvRaw.indexOf(fa) >= 0) ? 60 : 40;
      tKind = 'exact';
    }
  } else {
    const candsS = [nsRaw, ns];
    if (song && Array.isArray(song.alias)) {
      song.alias.forEach((al) => { const k = normNameRaw(al); if (k) candsS.push(k); });
    }
    const candsV = [nvRaw, nv];
    for (const ks of candsS) {
      for (const kv of candsV) {
        if (!ks || !kv) continue;
        if (kv === ks) { if (tScore < 60) { tScore = 60; tKind = 'exact'; } }
        else if (kv.indexOf(ks) >= 0) { if (tScore < 46) { tScore = 46; tKind = 'contains'; } }
        else if (ks.indexOf(kv) >= 0 && kv.length >= Math.max(2, Math.floor(ks.length * 0.45))) {
          if (tScore < 40) { tScore = 40; tKind = 'contains'; }
        }
      }
    }
    if (tKind === 'none' && ns && nv) {
      let k = 0;
      while (k < ns.length && k < nv.length && ns[k] === nv[k]) k++;
      const ratio = k / Math.max(ns.length, 1);
      tScore = Math.round(30 * ratio);
      if (ratio >= 0.6) tKind = 'prefix';
    }
  }
  if (fa && fa.length >= 2 && (nvRaw.indexOf(fa) >= 0 || normNameRaw(v.dj || '').indexOf(fa) >= 0 || normNameRaw(v.radio || '').indexOf(fa) >= 0)) {
    tScore += 8;
  }
  const g = durGap(song.duration, v.duration);
  let score = tScore;
  let bad = false, badKind = '';
  if (tKind === 'none') { bad = true; badKind = 'title'; }
  if (g === null) {
    score += 8;
  } else {
    const ag = Math.abs(g);
    if (ag <= 3) score += 55;
    else if (ag <= 10) score += 34;
    else if (ag <= 20) score += 12;
    else if (ag <= 30) score -= 10;
    else score -= 70;
    if (ag > 30) { bad = true; if (!badKind) badKind = 'dur'; }
  }
  const varRe = /伴奏|纯音乐|inst(rumental)?\b|off\s*vocal|karaoke|钢琴版|吉他版|八音盒|铃声|片段|试听|[×x]\s*0\.\d+|0\.\d+\s*[×x]|slowed|nightcore|倍速/i;
  if (varRe.test(vTitle) && !varRe.test(sName)) {
    score -= 28; bad = true; if (!badKind) badKind = 'variant';
  }
  const why = badKind === 'title' ? '标题对不上' : badKind === 'dur' ? '时长差 ' + fmt(Math.abs(g)) : badKind === 'variant' ? '疑似非原曲版本' : '';
  return { score: score, gap: g, bad: bad, badKind: badKind, why: why, tKind: tKind };
}

function pickVoice(song, cands) {
  let best = null;
  const scored = [];
  (cands || []).forEach(function (v) {
    const s = scoreVoice(song, v);
    const one = { v: v, score: s.score, gap: s.gap, bad: s.bad, badKind: s.badKind, why: s.why };
    scored.push(one);
    if (!best || one.score > best.score) best = one;
  });
  return { best: best && !best.bad ? best : null, top: best, scored: scored };
}
