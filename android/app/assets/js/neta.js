/* neta.js —— 网易云 weapi 纯 JS 实现（AES-CBC + RSA），不依赖 Node */
(function (root) {
  'use strict';

  const PRESET_KEY = '0CoJUm6Qyw8W8jud';
  const IV = '0102030405060708';
  const PUBKEY = '010001';
  const MODULUS =
    '00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a8' +
    '76aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c' +
    '9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d5' +
    '46b8e289dc6935b3ece0462db0a22b8e7';

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

  function bytesToB64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      out += B64[b0 >> 2];
      out += B64[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
      out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
      out += b2 === undefined ? '=' : B64[b2 & 63];
    }
    return out;
  }

  function hexToBytes(hex) {
    const n = hex.length / 2;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }

  const enc = new TextEncoder();

  async function aesEncrypt(text, key, iv) {
    const subtle = (root.crypto && root.crypto.subtle) || null;
    if (!subtle) throw new Error('需要 WebCrypto');
    const ck = await subtle.importKey('raw', enc.encode(key), { name: 'AES-CBC' }, false, ['encrypt']);
    const buf = await subtle.encrypt({ name: 'AES-CBC', iv: enc.encode(iv) }, ck, enc.encode(text));
    return bytesToB64(new Uint8Array(buf));
  }

  // 原始 RSA：密文 = reverse(secretKey) ^ e mod n
  function rsaEncrypt(text) {
    const rev = text.split('').reverse().join('');
    let hex = '';
    for (let i = 0; i < rev.length; i++) {
      hex += rev.charCodeAt(i).toString(16).padStart(2, '0');
    }
    const m = BigInt('0x' + hex);
    const e = BigInt('0x' + PUBKEY);
    const n = BigInt('0x' + MODULUS);
    let c = 1n;
    let base = m % n;
    let exp = e;
    while (exp > 0n) {
      if (exp & 1n) c = (c * base) % n;
      base = (base * base) % n;
      exp >>= 1n;
    }
    return c.toString(16).padStart(256, '0');
  }

  const RAND = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  function randomKey(len) {
    let s = '';
    const buf = new Uint8Array(len);
    root.crypto.getRandomValues(buf);
    for (let i = 0; i < len; i++) s += RAND[buf[i] % RAND.length];
    return s;
  }

  /** 生成 weapi 请求体 */
  async function weapiBody(data) {
    const text = JSON.stringify(data || {});
    const secret = randomKey(16);
    const params = await aesEncrypt(await aesEncrypt(text, PRESET_KEY, IV), secret, IV);
    const encSecKey = rsaEncrypt(secret);
    return 'params=' + encodeURIComponent(params) + '&encSecKey=' + encodeURIComponent(encSecKey);
  }

  const UA_PC =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/126.0.0.0 Safari/537.36';

  /** 容错解析：偶尔会拿到「两个 JSON 粘在一起」的响应，取第一个完整对象 */
  function parseLoose(txt) {
    const s = String(txt == null ? '' : txt);
    try { return JSON.parse(s); } catch (e) {
      const i = s.indexOf('{');
      if (i >= 0) {
        let depth = 0, inStr = false, esc2 = false;
        for (let j = i; j < s.length; j++) {
          const c = s.charAt(j);
          if (inStr) {
            if (esc2) esc2 = false;
            else if (c === '\\') esc2 = true;
            else if (c === '"') inStr = false;
            continue;
          }
          if (c === '"') inStr = true;
          else if (c === '{') depth++;
          else if (c === '}') { depth--; if (depth === 0) return JSON.parse(s.slice(i, j + 1)); }
        }
      }
      throw e;
    }
  }

  /** 发送请求：优先用原生 HTTP 桥（无 CORS 问题） */
  async function post(path, data) {
    const body = await weapiBody(data);
    const url = 'https://music.163.com/weapi' + path;
    if ((!root.Android || !root.Android.httpPost) && typeof fetch !== 'function') {
      throw new Error('当前是旧版 App（缺少联网桥），请安装最新 APK');
    }
    if (root.Android && root.Android.httpPost) {
      const txt = root.Android.httpPost(url, body);
      return parseLoose(txt);
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://music.163.com',
        'User-Agent': UA_PC,
        Cookie: 'os=pc; appver=8.9.70; osver=; deviceId=musicplay',
      },
      body,
    });
    return parseLoose(await res.text());
  }

  // ---------------- 业务接口 ----------------
  async function searchSongs(kw, limit) {
    const d = await post('/cloudsearch/pc', { s: kw, type: 1, limit: limit || 20, offset: 0, total: true });
    const r = d.result || {};
    return (r.songs || []).map(function (s) {
      const ar = (s.ar || s.artists || [])[0];
      const al = s.al || s.album || {};
      return {
        id: s.id,
        name: s.name,
        artist: ar ? ar.name : '',
        album: al.name || '',
        duration: Math.round((s.dt || s.duration || 0) / 1000),
        cover: (al.picUrl || '').replace(/^http:/, 'https:'),
        fee: s.fee,
        // 别名/译名：本地检索靠它认「rolling girl」这种译文
        alias: [].concat(s.alia || [], s.tns || [], s.alias || []).filter(function (v, i, a) { return v && a.indexOf(v) === i; }),
      };
    });
  }

  /** 搜索播客声音（/search/voice/get） */
  async function searchVoices(kw, limit) {
    const d = await post('/search/voice/get', { keyword: kw, scene: 'normal', limit: limit || 20, offset: 0 });
    const list = (d.data && (d.data.resources || d.data.list)) || [];
    return list.map(function (x) {
      const bi = x.baseInfo || {};
      const ms = bi.mainSong || {};
      const radio = bi.radio || {};
      const dj = bi.dj || (radio && radio.dj) || {};
      const ui = x.uiElement || {};
      let title = (ui.mainTitle && ui.mainTitle.title) || ms.name || '';
      title = String(title).replace(/^声音[:：]?\s*/, '').trim();
      return {
        voiceId: x.resourceId || ms.id,
        mainTrackId: bi.mainTrackId || ms.id || 0,
        title: title,
        radio: radio.name || '',
        dj: dj.nickname || '',
        plays: bi.listenerCount || bi.adjustedPlayCount || 0,
        duration: Math.round((bi.duration || ms.duration || 0) / 1000),
        cover: (ui.image && ui.image.imageUrl) || bi.coverUrl || (radio && radio.picUrl) || '',
      };
    }).filter(function (v) { return v.mainTrackId; });
  }
  async function songDetail(ids) {
    const d = await post('/v3/song/detail', { c: JSON.stringify([{ id: ids }]) });
    const list = (d.songs || []).map(function (s) {
      const ar = (s.ar || [])[0];
      const al = s.al || {};
      return {
        id: s.id,
        name: s.name,
        artist: ar ? ar.name : '',
        album: al.name || '',
        duration: Math.round((s.dt || 0) / 1000),
        cover: (al.picUrl || '').replace(/^http:/, 'https:'),
        alias: [].concat(s.alia || [], s.tns || [], s.alias || []).filter(function (v, i, a) { return v && a.indexOf(v) === i; }),
      };
    });
    return list;
  }


  /** 解析分享链接里的 ID */
  function parseShareLink(text) {
    const t = String(text || '');
    const mp = t.match(/playlist[^0-9]{0,12}(\d{5,})/);
    const ms = t.match(/song[^0-9]{0,12}(\d{5,})/);
    if (mp) return { type: 'playlist', id: mp[1] };
    if (ms) return { type: 'song', id: ms[1] };
    const m = t.match(/(\d{6,})/);
    if (m) return { type: 'playlist', id: m[1] };
    return null;
  }

  function normSongOf(x) {
    const ar = (x.ar || x.artists || []).map(function (a) { return a && a.name; }).filter(Boolean).join(' / ');
    const al = x.al || x.album || {};
    return {
      id: x.id,
      name: x.name || '',
      artist: ar,
      album: al.name || '',
      duration: Math.round((x.dt || x.duration || 0) / 1000),
      cover: al.picUrl || '',
      alias: [].concat(x.alia || [], x.tns || [], x.alias || []).filter(function (v, i, a) { return v && a.indexOf(v) === i; }),
    };
  }

  /** 歌单曲目：先拿 trackIds，再分批取详情（tracks 字段只给前几首） */
  async function playlistSongs(id, max) {
    const d = await post('/v6/playlist/detail', { id: id, n: 1000, s: 8 });
    const pl = (d.playlist) || {};
    const name = pl.name || '';
    const ids = (pl.trackIds || []).map(function (x) { return x.id; });
    const limit = Math.min(max || 1000, ids.length);
    if (!limit) {
      return { name: name, songs: (pl.tracks || []).map(normSongOf) };
    }
    const out = [];
    for (let i = 0; i < limit; i += 100) {
      const chunk = ids.slice(i, Math.min(i + 100, limit));
      try {
        const r = await post('/v3/song/detail', {
          c: JSON.stringify(chunk.map(function (x) { return { id: x }; })),
        });
        (r.songs || []).forEach(function (s) { out.push(normSongOf(s)); });
      } catch (e) { }
      if (root.bgSleep) await root.bgSleep(150);
      else await new Promise(function (res) { setTimeout(res, 150); });
    }
    return { name: name, songs: out };
  }

  /** 单曲详情 */
  async function songDetail(id) {
    const d = await post('/v3/song/detail', { c: JSON.stringify([{ id: id }]) });
    return (d.songs || []).map(normSongOf);
  }

  async function lyric(songId) {
    const d = await post('/song/lyric', {
      id: songId, lv: -1, kv: -1, tv: -1, rv: -1, cp: false, cs: false, lrcType: 1,
    });
    const lrc = (d.lrc && d.lrc.lyric) || '';
    const tr = (d.tlyric && d.tlyric.lyric) || '';
    return { lrc: lrc, tlyric: tr };
  }

  /** 把翻译按时间戳并进原文（同时间戳两行） */
  function mergeLrc(main, trans) {
    if (!trans) return main || '';
    const map = {};
    String(trans).split(/\r?\n/).forEach(function (l) {
      const m = l.match(/^\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
      if (!m) return;
      const t = (+m[1]) * 60000 + (+m[2]) * 1000 + (m[3] ? +(m[3].padEnd(2, '0').slice(0, 2)) * 10 : 0);
      const body = (m[4] || '').trim();
      if (body) map[t] = body;
    });
    const out = [];
    String(main || '').split(/\r?\n/).forEach(function (l) {
      const m = l.match(/^(\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\])\s*(.*)$/);
      if (!m) return;
      const tag = m[1];
      const body = (m[2] || '').trim();
      if (!body) return;
      const t = parseTimeOf(tag);
      out.push(tag + body);
      if (map[t] && map[t] !== body) out.push(tag + map[t]);
    });
    return out.join('\n');
  }

  function parseTimeOf(tag) {
    const m = tag.match(/\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/);
    if (!m) return -1;
    return (+m[1]) * 60000 + (+m[2]) * 1000 + (m[3] ? +(m[3].padEnd(2, '0').slice(0, 2)) * 10 : 0);
  }

  /** v1 接口：音质档位可指定，CDN 与老接口不是一套，拿不到地址时兜底用 */
  async function songUrlV1(id, level) {
    try {
      const d = await post('/song/enhance/player/url/v1', {
        ids: '[' + id + ']', level: level || 'exhigh', encodeType: 'aac'
      });
      const x = (d.data || [])[0] || {};
      return { url: x.url || '', br: x.br || 0, size: x.size || 0 };
    } catch (e) { return { url: '', br: 0, size: 0 }; }
  }

  async function songUrl(id) {
    const d = await post('/song/enhance/player/url', { ids: '[' + id + ']', br: 320000 });
    const arr = d.data || [];
    const x = arr[0] || {};
    return { url: x.url || '', br: x.br || 0, size: x.size || 0 };
  }

  root.neta = {
    parseShareLink: parseShareLink,
    playlistSongs: playlistSongs,
    songDetail: songDetail,
    mergeLrc: mergeLrc,
    searchVoices: searchVoices,
    weapiBody: weapiBody,
    post: post,
    searchSongs: searchSongs,
    songDetail: songDetail,
    lyric: lyric,
    songUrl: songUrl,
    songUrlV1: songUrlV1,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
