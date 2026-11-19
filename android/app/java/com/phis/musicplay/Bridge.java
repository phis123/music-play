package com.phis.musicplay;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;

/** JS <-> 原生 桥 */
public class Bridge {

    private final Activity act;
    private final WebView web;
    private final PlayerBridge player;
    private final SharedPreferences sp;
    private final android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());

    public Bridge(Activity act, WebView web, PlayerBridge player) {
        this.act = act;
        this.web = web;
        this.player = player;
        this.sp = act.getSharedPreferences("musicplay", Context.MODE_PRIVATE);
        PlaybackService.setListener(new PlaybackService.Listener() {
            @Override public void onState(final boolean playing, final int posSec, final int durSec) {
                mainHandler.post(() -> {
                    if (web == null) return;
                    web.evaluateJavascript("window.onTick&&window.onTick(" + posSec + ")", null);
                    if (playing) {
                        web.evaluateJavascript("window.onPlaying&&window.onPlaying(" + durSec + ")", null);
                    }
                });
            }
            @Override public void onComplete() {
                mainHandler.post(() -> {
                    if (web != null) web.evaluateJavascript("window.onEnded&&window.onEnded()", null);
                });
            }
        });
        String savedRoot = sp.getString("custom_root_dir", null);
        if (savedRoot != null && !savedRoot.isEmpty()) {
            AudioStore.setCustomRootDir(savedRoot);
        }
    }

    // ---------------- 曲库 ----------------
    @JavascriptInterface
    public String listAudio() {
        return AudioStore.listJson(act);
    }

    // ---------------- 路径边界校验（P0-2） ----------------
    // WebView 注入时，JS 传入的任意路径都不可信：读/删只允许发生在曲库枚举
    // 过的根目录内。白名单 = AudioStore.listJson() 枚举的三个根（公共 Music
    // 目录、Music/music-play、私有外部目录）；私有外部目录同时覆盖
    // getExternalFilesDir(null)/lyrics 下的私有歌词缓存（loadLyric 经
    // readText 读取）。只比较规范路径（getCanonicalFile），符号链接到
    // 白名单外的目标会被拒绝。
    private boolean isInsideAllowedRoot(File f) {
        try {
            if (f == null) return false;
            File canon = f.getCanonicalFile();
            File pubMusic = android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_MUSIC);
            File[] roots = new File[]{
                    AudioStore.rootDir(),   // 含用户在设置里改过的自定义曲库根
                    new File(pubMusic, "music-play"),
                    pubMusic,
                    act.getExternalFilesDir(null),
            };
            for (File r : roots) {
                if (r == null) continue;
                File rc = r.getCanonicalFile();
                if (canon.equals(rc)) return true;
                String rp = rc.getAbsolutePath();
                if (!rp.endsWith(File.separator)) rp += File.separator;
                if (canon.getAbsolutePath().startsWith(rp)) return true;
            }
        } catch (Exception ignored) { }
        return false;
    }

    /** 读取歌词等文本文件（UTF-8 / BOM 兼容） */
    @JavascriptInterface
    public String readText(String path) {
        try {
            File f = new File(path);
            if (!isInsideAllowedRoot(f)) return null; // 越界按“无此文件”处理，返回值约定不变
            if (!f.exists()) return null;
            BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            boolean first = true;
            while ((line = r.readLine()) != null) {
                if (first) {
                    first = false;
                    if (line.startsWith("\uFEFF")) line = line.substring(1);
                }
                sb.append(line).append('\n');
            }
            r.close();
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    @JavascriptInterface
    public boolean lrcExists(String audioPath) {
        try {
            File f = new File(audioPath.replaceAll("\\.[^.]+$", "") + ".lrc");
            return isInsideAllowedRoot(f) && f.exists();
        } catch (Exception e) {
            return false;
        }
    }

    /** 内嵌封面 → data URL（带 LRU 容量上限缓存，防止大歌单内存膨胀） */
    private static final int MAX_COVER_CACHE = 160;
    private final java.util.LinkedHashMap<String, String> coverCache =
            new java.util.LinkedHashMap<String, String>(200, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(java.util.Map.Entry<String, String> eldest) {
                    return size() > MAX_COVER_CACHE;
                }
            };

    @JavascriptInterface
    public String cover(String path) {
        if (path == null) return "";
        synchronized (coverCache) {
            if (coverCache.containsKey(path)) return coverCache.get(path);
        }
        try {
            if (!isInsideAllowedRoot(new File(path))) return "";
        } catch (Exception e) {
            return "";
        }
        String out = "";
        android.media.MediaMetadataRetriever mmr = new android.media.MediaMetadataRetriever();
        try {
            mmr.setDataSource(path);
            byte[] pic = mmr.getEmbeddedPicture();
            if (pic != null && pic.length > 0) {
                out = "data:image/jpeg;base64," + android.util.Base64.encodeToString(pic, android.util.Base64.NO_WRAP);
            }
        } catch (Exception ignored) {
        } finally {
            try { mmr.release(); } catch (Exception ignored) { }
        }
        if (out.isEmpty()) {
            try {
                File sideJpg = new File(path.replaceAll("\\.[^.]+$", "") + ".jpg");
                if (sideJpg.exists() && isInsideAllowedRoot(sideJpg) && sideJpg.length() > 0 && sideJpg.length() < 10 * 1024 * 1024) {
                    byte[] buf = new byte[(int) sideJpg.length()];
                    java.io.FileInputStream fis = new java.io.FileInputStream(sideJpg);
                    int read = 0;
                    while (read < buf.length) {
                        int n = fis.read(buf, read, buf.length - read);
                        if (n <= 0) break;
                        read += n;
                    }
                    fis.close();
                    out = "data:image/jpeg;base64," + android.util.Base64.encodeToString(buf, 0, read, android.util.Base64.NO_WRAP);
                }
            } catch (Exception ignored) { }
        }
        synchronized (coverCache) {
            coverCache.put(path, out);
        }
        return out;
    }

    // ---------------- 播放（走前台 Service） ----------------
    private static final String TAG = "MusicPlay";

    private PlaybackService svc() {
        if (PlaybackService.instance == null) PlaybackService.start(act);
        return PlaybackService.instance;
    }

    // ---------------- 现场诊断 ----------------
    /** 把关键事件写进 App 外部目录，logcat 被刷掉也能事后取证：
     *  /sdcard/Android/data/com.phis.musicplay/files/diag.log（无需任何权限） */
    @JavascriptInterface public void diag(String msg) {
        try {
            java.io.File dir = act.getExternalFilesDir(null);
            if (dir == null) return;
            java.io.File f = new java.io.File(dir, "diag.log");
            if (f.length() > 512 * 1024) {
                java.io.File old = new java.io.File(dir, "diag.old.log");
                if (old.exists()) old.delete();
                f.renameTo(old);
                f = new java.io.File(dir, "diag.log");
            }
            java.text.SimpleDateFormat fmt = new java.text.SimpleDateFormat("MM-dd HH:mm:ss.SSS", java.util.Locale.US);
            String line = fmt.format(new java.util.Date()) + "  " + msg + "\n";
            java.io.FileOutputStream out = new java.io.FileOutputStream(f, true);
            out.write(line.getBytes("UTF-8"));
            out.close();
        } catch (Throwable ignored) { }
        android.util.Log.i(TAG, "diag: " + msg);
    }

    /** 界面发现「显示在播但实际没声」时，主动让原生按上次数据源重开一次 */
    @JavascriptInterface public void recover() {
        android.util.Log.i(TAG, "JS recover");
        PlaybackService s = svc();
        if (s != null) s.recover(); else notifyServiceMissing("recover");
    }

    /** Service 还没就绪：以前这里静默丢弃命令，界面就是「点了没反应」 */
    private void notifyServiceMissing(String what) {
        android.util.Log.w(TAG, "播放服务未就绪，命令被丢弃: " + what);
        mainHandler.post(() -> {
            if (web != null) web.evaluateJavascript("window.onPlayerError&&window.onPlayerError(-2,0)", null);
        });
    }

    @JavascriptInterface
    public void playEx(String path, String title, String artist, String cover) {
        PlaybackService.play(act, path, title, artist, path, cover);
    }

    @JavascriptInterface
    public void playEx(String path, String title, String artist) {
        playEx(path, title, artist, null);
    }

    /** 在线试听（不落盘） */
    @JavascriptInterface
    public void preview(String url, String title) { preview(url, title, null); }

    @JavascriptInterface
    public void preview(String url, String title, String cover) {
        previewEx(url, title, "在线试听", cover);
    }

    /** 带歌手的试听：通知栏与锁屏显示真实歌手，而不是统一的「在线试听」 */
    @JavascriptInterface
    public void previewEx(String url, String title, String artist, String cover) {
        android.util.Log.i(TAG, "JS previewEx title=" + title + " artist=" + artist + " url=" + url);
        PlaybackService.play(act, url,
                title == null || title.isEmpty() ? "试听" : title,
                artist == null || artist.isEmpty() ? "在线试听" : artist,
                "", cover);
    }

    /** 重新扫描曲库目录（媒体库漏扫时兜底） */
    @JavascriptInterface
    public int rescan() {
        try { return AudioStore.rescan(act); } catch (Exception e) { return 0; }
    }

    // ---------------- 诊断（日志导出 / 快照） ----------------
    /** JS 侧写一条诊断日志（会落盘 + logcat） */
    @JavascriptInterface
    public void diagLog(String tag, String msg) {
        try { Diag.writeApp(act, tag == null ? "js" : tag, msg == null ? "" : msg); } catch (Throwable ignored) { }
    }

    /** 读取当前快照文本（JS 可直接展示/复制） */
    @JavascriptInterface
    public String diagSnapshot() {
        try { return Diag.snapshot(act); } catch (Throwable t) { return "snapshot failed: " + t; }
    }

    /** 生成的诊断包绝对路径，供前端提示用户位置 */
    @JavascriptInterface
    public String diagExport() {
        try { return Diag.export(act); } catch (Throwable t) { return ""; }
    }

    @JavascriptInterface
    public String diagLastExport() {
        try { return Diag.lastExportPath(); } catch (Throwable t) { return ""; }
    }

    /** 前端状态（localStorage 摘要等），会写进导出包的 state.json */
    @JavascriptInterface
    public void diagState(String json) {
        try { Diag.writeState(act, json == null ? "{}" : json); } catch (Throwable ignored) { }
    }

    @JavascriptInterface
    public void diagClear() {
        try { Diag.clear(act); } catch (Throwable ignored) { }
    }

    /** 上一次扫描时系统媒体库是否可用（false = 缺 READ_MEDIA_AUDIO 权限或索引为空） */
    @JavascriptInterface
    public boolean mediaStoreOk() {
        try { return AudioStore.mediaStoreOk(); } catch (Exception e) { return false; }
    }

    /** 清空 ID3 标签缓存，下次扫描强制重新读取歌手/专辑/标题 */
    @JavascriptInterface
    public void clearTagCache() {
        try { AudioStore.clearTagCache(act); } catch (Exception e) { }
    }

    @JavascriptInterface public void play(String path) { playEx(path, "", ""); }
    @JavascriptInterface public void pause() {
        android.util.Log.i(TAG, "JS pause");
        PlaybackService s = svc(); if (s != null) s.pause(); else notifyServiceMissing("pause");
    }
    @JavascriptInterface public void resume() {
        android.util.Log.i(TAG, "JS resume");
        PlaybackService s = svc(); if (s != null) s.resume(); else notifyServiceMissing("resume");
    }
    @JavascriptInterface public void toggle() {
        android.util.Log.i(TAG, "JS toggle");
        PlaybackService s = svc(); if (s != null) s.toggle(); else notifyServiceMissing("toggle");
    }
    @JavascriptInterface public void stop() { PlaybackService s = svc(); if (s != null) s.pause(); }
    @JavascriptInterface public void seek(int ms) { PlaybackService s = svc(); if (s != null) s.seek(ms); }
    @JavascriptInterface public int position() { PlaybackService s = svc(); return s != null ? s.positionSec() : 0; }
    @JavascriptInterface public boolean isPlaying() { PlaybackService s = svc(); return s != null && s.isPlaying(); }

    // ---------------- 我喜欢的音乐（存路径） ----------------
    @JavascriptInterface
    public String favList() {
        return sp.getString("favs", "[]");
    }

    @JavascriptInterface
    public void favSet(String json) {
        sp.edit().putString("favs", json).apply();
    }

    // ---------------- 歌单 ----------------
    @JavascriptInterface
    public String playlists() {
        return sp.getString("playlists", "[]");
    }

    @JavascriptInterface
    public void savePlaylists(String json) {
        sp.edit().putString("playlists", json).apply();
    }

    // ---------------- 杂项 ----------------
    @JavascriptInterface
    public void toast(String msg) {
        act.runOnUiThread(() -> Toast.makeText(act, msg, Toast.LENGTH_SHORT).show());
    }

    // ---------------- 网络（weapi 用） ----------------
    private static String readAll(java.io.InputStream is) throws java.io.IOException {
        java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
        return new String(bos.toByteArray(), "UTF-8");
    }

    private java.net.HttpURLConnection openConn(String url, String method) throws java.io.IOException {
        java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
        c.setRequestProperty("Referer", "https://music.163.com");
        c.setRequestProperty("Accept", "*/*");
        c.setInstanceFollowRedirects(true);
        return c;
    }

    @JavascriptInterface
    public String httpPost(String url, String body) {
        try {
            java.net.HttpURLConnection c = openConn(url, "POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            byte[] data = body.getBytes("UTF-8");
            c.setFixedLengthStreamingMode(data.length);
            c.getOutputStream().write(data);
            int code = c.getResponseCode();
            java.io.InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String txt = is == null ? "" : readAll(is);
            c.disconnect();
            return txt;
        } catch (Exception e) {
            return "{\"code\":-1,\"message\":\"" + String.valueOf(e.getMessage()).replace("\"", " ") + "\"}";
        }
    }

    @JavascriptInterface
    public String httpGet(String url) {
        try {
            java.net.HttpURLConnection c = openConn(url, "GET");
            int code = c.getResponseCode();
            java.io.InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String txt = is == null ? "" : readAll(is);
            c.disconnect();
            return txt;
        } catch (Exception e) {
            return "{\"code\":-1}";
        }
    }

    /** 同步下载到 Music 目录（保留兼容） */
    @JavascriptInterface
    public String download(String url, String fileName, String lrcText) {
        try {
            java.io.File dir = android.os.Environment.getExternalStoragePublicDirectory(
                    android.os.Environment.DIRECTORY_MUSIC);
            if (!dir.exists()) dir.mkdirs();
            String safe = fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
            if (safe.length() > 100) {
                int dot = safe.lastIndexOf('.');
                safe = dot > 0 ? safe.substring(0, 96) + safe.substring(dot) : safe.substring(0, 100);
            }
            java.io.File out = new java.io.File(dir, safe);
            java.net.HttpURLConnection c = openConn(url, "GET");
            java.io.InputStream is = c.getInputStream();
            java.io.FileOutputStream fos = new java.io.FileOutputStream(out);
            byte[] buf = new byte[65536];
            int n;
            while ((n = is.read(buf)) > 0) fos.write(buf, 0, n);
            fos.close();
            is.close();
            c.disconnect();
            if (lrcText != null && lrcText.length() > 0) {
                String baseName = safe.replaceAll("\\.[^.]+$", "");
                java.io.File lrc = new java.io.File(dir, baseName + ".lrc");
                java.io.FileOutputStream lf = new java.io.FileOutputStream(lrc);
                lf.write(lrcText.getBytes("UTF-8"));
                lf.close();
            }
            android.media.MediaScannerConnection.scanFile(act, new String[]{out.getAbsolutePath()}, null, null);
            return "{\"ok\":true,\"path\":\"" + out.getAbsolutePath().replace("\"", " ") + "\"}";
        } catch (Exception e) {
            return "{\"ok\":false}";
        }
    }


    /** 异步下载 + 进度回调 */
    @JavascriptInterface
    public void downloadAsync(final String url, final String fileName, final String lrcText) {
        new Thread(() -> {
            String safe = fileName.replaceAll("[\\\\/:*?\"<>|]", "_");
            java.io.File dir = AudioStore.pickWritableDir(act);
            java.io.File out = new java.io.File(dir, safe);
            long got = 0, total = 0;
            try {
                // 最多两次：CDN 偶尔抽风，换一次连接往往就好了
                for (int attempt = 0; attempt < 2; attempt++) {
                    got = 0;
                    total = 0;
                    java.net.HttpURLConnection c = null;
                    try {
                        c = openConn(url, "GET");
                        c.connect();
                        int code = c.getResponseCode();
                        if (code >= 400) {
                            throw new java.io.IOException("HTTP " + code + " " + c.getResponseMessage());
                        }
                        String ct = String.valueOf(c.getContentType()).toLowerCase();
                        if (ct.contains("text/html") || ct.contains("json")) {
                            throw new java.io.IOException("服务器返回的不是音频（" + ct + "），可能需要会员或已下架");
                        }
                        total = c.getContentLengthLong();
                        java.io.InputStream is = c.getInputStream();
                        java.io.FileOutputStream fos;
                        try {
                            fos = new java.io.FileOutputStream(out);
                        } catch (Exception we) {
                            // 公共 Music 目录写不进（Android 11+ 没有「所有文件访问」很常见）→ 退到 App 私有目录
                            dir = AudioStore.privateDir(act);
                            out = new java.io.File(dir, safe);
                            fos = new java.io.FileOutputStream(out);
                        }
                        byte[] buf = new byte[65536];
                        int n;
                        long last = 0;
                        while ((n = is.read(buf)) > 0) {
                            fos.write(buf, 0, n);
                            got += n;
                            long now = System.currentTimeMillis();
                            if (now - last > 220) {
                                last = now;
                                int pct = total > 0 ? (int) (got * 100 / total) : -1;
                                js("window.onDownload&&window.onDownload(" + pct + "," + jsStr(safe) + "," + got + "," + total + ")");
                            }
                        }
                        fos.flush();
                        fos.close();
                        is.close();
                        c.disconnect();
                        if (total > 0 && got < total) {
                            throw new java.io.IOException("下载不完整 " + got + "/" + total + " 字节");
                        }
                        if (got < 20000) {
                            throw new java.io.IOException("只拿到 " + got + " 字节（像是试听片段或出错页）");
                        }
                        break;
                    } catch (Exception e1) {
                        try { if (c != null) c.disconnect(); } catch (Exception ig) { }
                        if (attempt >= 1) throw e1;
                        try { Thread.sleep(800); } catch (InterruptedException ig) { }
                    }
                }
                if (lrcText != null && lrcText.length() > 0) {
                    String baseName = safe.replaceAll("\\.[^.]+$", "");
                    java.io.File lrc = new java.io.File(dir, baseName + ".lrc");
                    java.io.FileOutputStream lf = new java.io.FileOutputStream(lrc);
                    lf.write(lrcText.getBytes("UTF-8"));
                    lf.close();
                }
                android.media.MediaScannerConnection.scanFile(act, new String[]{out.getAbsolutePath()}, null, null);
                js("window.onDownloadDone&&window.onDownloadDone(true," + jsStr(out.getAbsolutePath()) + ")");
            } catch (final Exception e) {
                // 半截文件直接删掉，免得曲库里留一条打不开的
                try { if (out.exists()) out.delete(); } catch (Exception ig) { }
                js("window.onDownloadDone&&window.onDownloadDone(false," + jsStr(String.valueOf(e.getMessage())) + ")");
            }
        }).start();
    }

    @JavascriptInterface
    public boolean saveLyric(String audioPath, String text) {
        try {
            java.io.File dir = new java.io.File(act.getExternalFilesDir(null), "lyrics");
            if (!dir.exists()) dir.mkdirs();
            String key = Integer.toHexString(audioPath.hashCode());
            java.io.File f = new java.io.File(dir, key + ".lrc");
            java.io.FileOutputStream fo = new java.io.FileOutputStream(f);
            fo.write(text.getBytes("UTF-8"));
            fo.close();
            return true;
        } catch (Exception e) { return false; }
    }

    /** 按文件名兜底找私有歌词（目录变更后 hash 会变） */
    @JavascriptInterface
    public String loadLyricByBase(String audioPath) {
        try {
            java.io.File dir = new java.io.File(act.getExternalFilesDir(null), "lyrics");
            if (!dir.exists()) return null;
            String base = audioPath.substring(audioPath.lastIndexOf('/') + 1).replaceAll("\\.[^.]+$", "");
            java.io.File[] files = dir.listFiles();
            if (files == null) return null;
            for (java.io.File f : files) {
                String saved = sp.getString("lrcpath:" + f.getName(), "");
                if (saved.isEmpty()) continue;
                String sb = saved.substring(saved.lastIndexOf('/') + 1).replaceAll("\\.[^.]+$", "");
                if (sb.equals(base)) return readText(f.getAbsolutePath());
            }
            return null;
        } catch (Exception e) { return null; }
    }

    @JavascriptInterface
    public String loadLyric(String audioPath) {
        try {
            java.io.File dir = new java.io.File(act.getExternalFilesDir(null), "lyrics");
            String key = Integer.toHexString(audioPath.hashCode());
            java.io.File f = new java.io.File(dir, key + ".lrc");
            if (!f.exists()) return null;
            return readText(f.getAbsolutePath());
        } catch (Exception e) { return null; }
    }


    /** 存储诊断：给前端排查「下完了看不到」用 */
    @JavascriptInterface
    public String storageInfo() {
        JSONObject o = new JSONObject();
        try {
            java.io.File pub = AudioStore.rootDir();
            java.io.File pri = AudioStore.privateDir(act);
            o.put("public", pub.getAbsolutePath());
            o.put("publicExists", pub.exists());
            o.put("publicPick", AudioStore.pickWritableDir(act).getAbsolutePath());
            o.put("private", pri.getAbsolutePath());
            o.put("privateExists", pri.exists());
            List2 c1 = countAudio(pub), c2 = countAudio(pri);
            o.put("publicAudio", c1.n);
            o.put("privateAudio", c2.n);
            o.put("publicListable", c1.listable);
            o.put("privateListable", c2.listable);
            o.put("allFiles", hasAllFiles());
            o.put("sdk", android.os.Build.VERSION.SDK_INT);
        } catch (Exception e) {
            try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        }
        return o.toString();
    }

    private static class List2 { int n; boolean listable; }

    private static List2 countAudio(java.io.File d) {
        List2 r = new List2();
        try {
            java.io.File[] fs = d.listFiles();
            if (fs == null) return r;
            r.listable = true;
            for (java.io.File f : fs) {
                String n = f.getName().toLowerCase();
                if (n.endsWith(".mp3") || n.endsWith(".flac") || n.endsWith(".m4a")
                        || n.endsWith(".wav") || n.endsWith(".ogg") || n.endsWith(".aac")
                        || n.endsWith(".opus")) r.n++;
            }
        } catch (Exception ignored) { }
        return r;
    }

    /** 是否已拿到「所有文件访问权限」（Android 11+ 在共享存储里删/写别人的文件必须要它） */
    @JavascriptInterface
    public boolean hasAllFiles() {
        try {
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                return android.os.Environment.isExternalStorageManager();
            }
            return true;
        } catch (Throwable t) { return true; }
    }

    /** 跳系统「所有文件访问权限」设置页 */
    @JavascriptInterface
    public boolean openAllFilesSettings() {
        try {
            if (android.os.Build.VERSION.SDK_INT < 30) return false;
            android.content.Intent i = new android.content.Intent(
                    android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
            i.setData(android.net.Uri.parse("package:" + act.getPackageName()));
            i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
            return true;
        } catch (Exception e) {
            try {
                android.content.Intent i2 = new android.content.Intent(
                        android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                i2.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                act.startActivity(i2);
                return true;
            } catch (Exception e2) { return false; }
        }
    }

    @JavascriptInterface
    public String removeFile(String path) {
        JSONObject o = new JSONObject();
        try {
            java.io.File f = new java.io.File(path);
            if (!isInsideAllowedRoot(f)) {
                // 越界拒绝：JSON 结构与原失败返回一致（ok + reason），调用方按原有逻辑提示
                o.put("ok", false);
                o.put("reason", "路径不在曲库目录内");
                return o.toString();
            }
            // 只允许删除音频文件与它自己的旁挂派生物（.lrc/.jpg），
            // 避免「在曲库目录内」就等于可以删任意文件（例如同目录下别人的图片/文档）
            String lower = path.toLowerCase();
            boolean isAudio = lower.endsWith(".mp3") || lower.endsWith(".flac") || lower.endsWith(".m4a")
                    || lower.endsWith(".wav") || lower.endsWith(".ogg") || lower.endsWith(".aac")
                    || lower.endsWith(".opus") || lower.endsWith(".wma") || lower.endsWith(".ape");
            if (!isAudio) {
                o.put("ok", false);
                o.put("reason", "只允许删除曲库中的音频文件");
                return o.toString();
            }
            boolean existed = f.exists();
            boolean ok = existed ? f.delete() : true;
            if (ok) {
                String base = path.replaceAll("\\.[^.]+$", "");
                java.io.File lrc = new java.io.File(base + ".lrc");
                if (lrc.exists() && isInsideAllowedRoot(lrc)) lrc.delete(); // 派生歌词是库外符号链接时不删
                try {
                    act.getContentResolver().delete(
                        android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                        android.provider.MediaStore.MediaColumns.DATA + "=?", new String[]{path});
                } catch (Throwable t) {
                    Diag.write("bridge", "MediaStore 删除失败（文件已删，索引可能残留）: " + t);
                }
                android.media.MediaScannerConnection.scanFile(act, new String[]{path}, null, null);
            }
            o.put("ok", ok);
            if (!ok) {
                boolean need = !hasAllFiles();
                o.put("needPerm", need);
                o.put("reason", need ? "需要「所有文件访问权限」" : "文件删不掉（可能被其他程序占用）");
            }
            return o.toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"reason\":\"删除异常\"}";
        }
    }


    @JavascriptInterface
    public int bitrate(String path) {
        android.media.MediaMetadataRetriever mmr = new android.media.MediaMetadataRetriever();
        try {
            mmr.setDataSource(path);
            String v = mmr.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_BITRATE);
            return v == null ? 0 : Math.round(Integer.parseInt(v) / 1000f);
        } catch (Exception e) { return 0; }
        finally { try { mmr.release(); } catch (Exception ignored) { } }
    }


    private void js(final String code) {
        if (web == null) return;
        mainHandler.post(() -> {
            if (web != null) web.evaluateJavascript(code, null);
        });
    }

    /** 原生主线程 Looper 延时回调（绕过 WebView 后台 setTimeout 节流） */
    @JavascriptInterface
    public void nativeDelay(final int id, final int ms) {
        mainHandler.postDelayed(() -> {
            if (web != null) web.evaluateJavascript("window.__onNativeDelay&&window.__onNativeDelay(" + id + ")", null);
        }, Math.max(0, ms));
    }

    /** 通知前台服务保持 CPU 唤醒锁并在通知栏展示后台匹配/下载进度 */
    @JavascriptInterface
    public void setBgTask(final boolean active, final String title, final String sub) {
        mainHandler.post(() -> {
            PlaybackService s = svc();
            if (s != null) s.setBgTaskState(active, title, sub);
        });
    }

    /** 把任意字符串安全地塞进 evaluateJavascript 的单引号字符串里 */
    private static String jsStr(String s) {
        if (s == null) return "''";
        StringBuilder b = new StringBuilder("'");
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '\'' || ch == '\\') { b.append('\\'); b.append(ch); }
            else if (ch == '\n' || ch == '\r') { b.append(' '); }
            else { b.append(ch); }
        }
        return b.append("'").toString();
    }

    // ---------------- 悬浮歌词 ----------------
    @JavascriptInterface
    public boolean overlayAllowed() { return LyricsOverlay.canDraw(act); }

    @JavascriptInterface
    public void overlaySettings() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            android.content.Intent i = new android.content.Intent(
                    android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    android.net.Uri.parse("package:" + act.getPackageName()));
            i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        }
    }

    @JavascriptInterface
    public void showOverlay() { LyricsOverlay.get(act).show(); }

    @JavascriptInterface
    public void hideOverlay() { LyricsOverlay.get(act).hide(); }

    @JavascriptInterface
    public boolean overlayShown() { return LyricsOverlay.get(act).isShowing(); }

    @JavascriptInterface
    public void overlayLock(boolean v) { LyricsOverlay.get(act).setLocked(v); }

    @JavascriptInterface
    public boolean overlayLocked() { return LyricsOverlay.get(act).isLocked(); }

    @JavascriptInterface
    public void overlayColor(String hex) {
        try {
            int c = (int) Long.parseLong(hex.replace("#", ""), 16);
            if (hex.replace("#", "").length() <= 6) c |= 0xFF000000;
            LyricsOverlay.get(act).setColor(c);
        } catch (Exception ignored) { }
    }

    @JavascriptInterface
    public void overlaySetStyle(String hex, int fontSizeSp, int bgAlpha) {
        try {
            int c = 0xFFFFFFFF;
            if (hex != null && !hex.isEmpty()) {
                String clean = hex.replace("#", "").trim();
                c = (int) Long.parseLong(clean, 16);
                if (clean.length() <= 6) c |= 0xFF000000;
            }
            LyricsOverlay.get(act).setStyle(c, fontSizeSp, bgAlpha);
        } catch (Throwable ignored) { }
    }

    @JavascriptInterface
    public void overlayText(String a, String b) { LyricsOverlay.get(act).setText(a, b); }

    @JavascriptInterface
    public String rootDir() { return AudioStore.rootDir().getAbsolutePath(); }

    @JavascriptInterface
    public String setRootDir(String pathOrSub) {
        try {
            if (AudioStore.setCustomRootDir(pathOrSub)) {
                sp.edit().putString("custom_root_dir", pathOrSub == null ? "" : pathOrSub.trim()).apply();
            }
        } catch (Exception ignored) { }
        return AudioStore.rootDir().getAbsolutePath();
    }

    // ---------------- 音量平衡（MP3 快速响度测算 + 原生 LoudnessEnhancer） ----------------
    private final java.util.HashMap<String, Float> gainCache = new java.util.HashMap<>();
    private static final int[] BR_V1_L3 = {0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0};
    private static final int[] BR_V2_L3 = {0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0};
    private static final int[] SR_V1 = {44100, 48000, 32000, 0};
    private static final int[] SR_V2 = {22050, 24000, 16000, 0};
    private static final int[] SR_V25 = {11025, 12000, 8000, 0};

    private static int readBits(byte[] buf, int baseByte, int bitOffset, int nBits) {
        int val = 0;
        for (int i = 0; i < nBits; i++) {
            int totalBit = bitOffset + i;
            int byteIdx = baseByte + (totalBit >> 3);
            if (byteIdx >= buf.length) return 0;
            int bitInByte = 7 - (totalBit & 7);
            val = (val << 1) | (((buf[byteIdx] & 0xFF) >> bitInByte) & 1);
        }
        return val;
    }

    @JavascriptInterface
    public float estimateGainDb(String path) {
        if (path == null || path.isEmpty()) return 0f;
        synchronized (gainCache) {
            if (gainCache.containsKey(path)) return gainCache.get(path);
        }
        if (!path.toLowerCase().endsWith(".mp3")) return 0f;
        float result = 0f;
        java.io.RandomAccessFile raf = null;
        try {
            File f = new File(path);
            if (!isInsideAllowedRoot(f) || !f.isFile() || f.length() < 16384) return 0f;
            long size = f.length();
            raf = new java.io.RandomAccessFile(f, "r");
            int chunk = 24576;
            byte[] buf = new byte[chunk];
            long[] offsets = { (long) (size * 0.25), (long) (size * 0.50), (long) (size * 0.75) };
            java.util.ArrayList<Integer> gains = new java.util.ArrayList<>(256);
            for (long off : offsets) {
                if (off + 1024 >= size) continue;
                raf.seek(off);
                int nRead = raf.read(buf, 0, (int) Math.min(chunk, size - off));
                if (nRead < 256) continue;
                int i = 0;
                int end = nRead - 40;
                while (i < end) {
                    if ((buf[i] & 0xFF) != 0xFF || (buf[i + 1] & 0xE0) != 0xE0) { i++; continue; }
                    int b1 = buf[i + 1] & 0xFF;
                    int b2 = buf[i + 2] & 0xFF;
                    int b3 = buf[i + 3] & 0xFF;
                    int ver = (b1 >> 3) & 0x03;
                    int lay = (b1 >> 1) & 0x03;
                    int prot = b1 & 0x01;
                    if (ver == 1 || lay != 1) { i++; continue; }
                    int brIdx = (b2 >> 4) & 0x0F;
                    int srIdx = (b2 >> 2) & 0x03;
                    int pad = (b2 >> 1) & 0x01;
                    if (brIdx == 0 || brIdx == 15 || srIdx == 3) { i++; continue; }
                    boolean isV1 = (ver == 3);
                    int br = (isV1 ? BR_V1_L3[brIdx] : BR_V2_L3[brIdx]) * 1000;
                    int sr = ver == 3 ? SR_V1[srIdx] : (ver == 2 ? SR_V2[srIdx] : SR_V25[srIdx]);
                    if (br == 0 || sr == 0) { i++; continue; }
                    int frameLen = (isV1 ? (144 * br) / sr : (72 * br) / sr) + pad;
                    if (frameLen < 24 || frameLen > 2880 || i + frameLen + 2 >= nRead) { i++; continue; }
                    if ((buf[i + frameLen] & 0xFF) != 0xFF || (buf[i + frameLen + 1] & 0xFE) != (b1 & 0xFE)) { i++; continue; }
                    int sideStart = i + 4 + (prot == 0 ? 2 : 0);
                    int nch = ((b3 >> 6) == 3) ? 1 : 2;
                    int sideLen = isV1 ? (nch == 1 ? 17 : 32) : (nch == 1 ? 9 : 17);
                    if (sideStart + sideLen + 4 > nRead) break;
                    if (isV1) {
                        int bitPos = nch == 1 ? 18 : 20;
                        for (int gr = 0; gr < 2; gr++) {
                            for (int ch = 0; ch < nch; ch++) {
                                int p23 = readBits(buf, sideStart, bitPos, 12);
                                int gg = readBits(buf, sideStart, bitPos + 21, 8);
                                if (p23 > 32 && gg >= 115 && gg <= 250) gains.add(gg);
                                bitPos += 59;
                            }
                        }
                    }
                    i += frameLen;
                }
            }
            if (gains.size() >= 8) {
                java.util.Collections.sort(gains);
                int p80 = gains.get(Math.min(gains.size() - 1, (int) (gains.size() * 0.80)));
                double rawDiff = (171.0 - p80) * 1.50515 * 0.65;
                rawDiff = Math.max(-8.5, Math.min(8.5, rawDiff));
                result = Math.round(rawDiff * 10f) / 10f;
            }
        } catch (Exception ignored) {
        } finally {
            if (raf != null) { try { raf.close(); } catch (Exception ignored) { } }
        }
        synchronized (gainCache) {
            gainCache.put(path, result);
        }
        return result;
    }

    @JavascriptInterface
    public void setPlaybackGainDb(final float gainDb) {
        mainHandler.post(() -> {
            PlaybackService s = svc();
            if (s != null) s.setGainDb(gainDb);
        });
    }

    /** 新建歌单子文件夹 */
    @JavascriptInterface
    public boolean mkdir(String name) {
        try {
            java.io.File d = new java.io.File(AudioStore.rootDir(), name.replaceAll("[\\\\/:*?\"<>|]", "_"));
            return d.exists() || d.mkdirs();
        } catch (Exception e) { return false; }
    }

    @JavascriptInterface
    public String buildTag() { return PlaybackService.buildTagText; }

    @JavascriptInterface
    public String deviceInfo() {
        try {
            JSONObject o = new JSONObject();
            o.put("model", android.os.Build.MODEL);
            o.put("sdk", android.os.Build.VERSION.SDK_INT);
            float w = act.getResources().getConfiguration().screenWidthDp;
            float h = act.getResources().getConfiguration().screenHeightDp;
            o.put("dpWidth", w);
            o.put("dpHeight", h);
            o.put("smallestDp", act.getResources().getConfiguration().smallestScreenWidthDp);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }
}
