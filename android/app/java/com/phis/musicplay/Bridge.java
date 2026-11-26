package com.phis.musicplay;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * JS <-> 原生 薄门面：完整保持 64 个 @JavascriptInterface 契约不变，
 * 具体实现按职责下沉至 BridgeStorage / BridgeNet / Mp3LoudnessEstimator。
 */
public class Bridge {

    private static final String TAG = "MusicPlay";

    private final Activity act;
    private final WebView web;
    private final SharedPreferences sp;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final BridgeStorage storage;
    private final BridgeNet net;
    private final Mp3LoudnessEstimator loudness;

    public Bridge(Activity act, WebView web) {
        this.act = act;
        this.web = web;
        this.sp = act.getSharedPreferences("musicplay", Context.MODE_PRIVATE);
        this.storage = new BridgeStorage(act, sp);
        this.net = new BridgeNet(act, new BridgeNet.JsEval() {
            @Override
            public void eval(String code) {
                js(code);
            }
        });
        this.loudness = new Mp3LoudnessEstimator(storage);

        PlaybackService.setListener(new PlaybackService.Listener() {
            @Override
            public void onState(final boolean playing, final int posSec, final int durSec) {
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        if (Bridge.this.web == null) return;
                        Bridge.this.web.evaluateJavascript("window.onTick&&window.onTick(" + posSec + ")", null);
                        if (playing) {
                            Bridge.this.web.evaluateJavascript("window.onPlaying&&window.onPlaying(" + durSec + ")", null);
                        }
                    }
                });
            }

            @Override
            public void onComplete() {
                mainHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        if (Bridge.this.web != null) {
                            Bridge.this.web.evaluateJavascript("window.onEnded&&window.onEnded()", null);
                        }
                    }
                });
            }
        });

        String savedRoot = sp.getString("custom_root_dir", null);
        if (savedRoot != null && !savedRoot.isEmpty()) {
            AudioStore.setCustomRootDir(savedRoot);
        }
    }

    private PlaybackService svc() {
        if (PlaybackService.instance == null) PlaybackService.start(act);
        return PlaybackService.instance;
    }

    private void js(final String code) {
        if (web == null) return;
        mainHandler.post(() -> {
            if (web != null) web.evaluateJavascript(code, null);
        });
    }

    private void notifyServiceMissing(String what) {
        Log.w(TAG, "播放服务未就绪，命令被丢弃: " + what);
        mainHandler.post(() -> {
            if (web != null) web.evaluateJavascript("window.onPlayerError&&window.onPlayerError(-2,0)", null);
        });
    }

    // ---------------- 曲库与存储（委托 BridgeStorage） ----------------
    @JavascriptInterface public String listAudio() { return storage.listAudio(); }
    @JavascriptInterface public String readText(String path) { return storage.readText(path); }
    @JavascriptInterface public boolean lrcExists(String audioPath) { return storage.lrcExists(audioPath); }
    @JavascriptInterface public String cover(String path) { return storage.cover(path); }
    @JavascriptInterface public int rescan() { return storage.rescan(); }
    @JavascriptInterface public boolean mediaStoreOk() { return storage.mediaStoreOk(); }
    @JavascriptInterface public void clearTagCache() { storage.clearTagCache(); }
    @JavascriptInterface public boolean saveLyric(String audioPath, String text) { return storage.saveLyric(audioPath, text); }
    @JavascriptInterface public String loadLyricByBase(String audioPath) { return storage.loadLyricByBase(audioPath); }
    @JavascriptInterface public String loadLyric(String audioPath) { return storage.loadLyric(audioPath); }
    @JavascriptInterface public String storageInfo() { return storage.storageInfo(); }
    @JavascriptInterface public boolean hasAllFiles() { return storage.hasAllFiles(); }
    @JavascriptInterface public boolean openAllFilesSettings() { return storage.openAllFilesSettings(); }
    @JavascriptInterface public String removeFile(String path) { return storage.removeFile(path); }
    @JavascriptInterface public int bitrate(String path) { return storage.bitrate(path); }
    @JavascriptInterface public String rootDir() { return storage.rootDir(); }
    @JavascriptInterface public String setRootDir(String pathOrSub) { return storage.setRootDir(pathOrSub); }
    @JavascriptInterface public boolean mkdir(String name) { return storage.mkdir(name); }

    // ---------------- 播放控制（走前台 PlaybackService） ----------------
    @JavascriptInterface
    public void recover() {
        Log.i(TAG, "JS recover");
        PlaybackService s = svc();
        if (s != null) s.recover(); else notifyServiceMissing("recover");
    }

    @JavascriptInterface
    public void playEx(String path, String title, String artist, String cover) {
        PlaybackService.play(act, path, title, artist, path, cover);
    }

    @JavascriptInterface
    public void playEx(String path, String title, String artist) {
        playEx(path, title, artist, null);
    }

    @JavascriptInterface
    public void preview(String url, String title) {
        preview(url, title, null);
    }

    @JavascriptInterface
    public void preview(String url, String title, String cover) {
        previewEx(url, title, "在线试听", cover);
    }

    @JavascriptInterface
    public void previewEx(String url, String title, String artist, String cover) {
        Log.i(TAG, "JS previewEx title=" + title + " artist=" + artist + " url=" + url);
        PlaybackService.play(act, url,
                title == null || title.isEmpty() ? "试听" : title,
                artist == null || artist.isEmpty() ? "在线试听" : artist,
                "", cover);
    }

    @JavascriptInterface public void play(String path) { playEx(path, "", ""); }

    @JavascriptInterface
    public void pause() {
        Log.i(TAG, "JS pause");
        PlaybackService s = svc();
        if (s != null) s.pause(); else notifyServiceMissing("pause");
    }

    @JavascriptInterface
    public void resume() {
        Log.i(TAG, "JS resume");
        PlaybackService s = svc();
        if (s != null) s.resume(); else notifyServiceMissing("resume");
    }

    @JavascriptInterface
    public void toggle() {
        Log.i(TAG, "JS toggle");
        PlaybackService s = svc();
        if (s != null) s.toggle(); else notifyServiceMissing("toggle");
    }

    @JavascriptInterface public void stop() { PlaybackService s = svc(); if (s != null) s.pause(); }
    @JavascriptInterface public void seek(int ms) { PlaybackService s = svc(); if (s != null) s.seek(ms); }
    @JavascriptInterface public int position() { PlaybackService s = svc(); return s != null ? s.positionSec() : 0; }
    @JavascriptInterface public boolean isPlaying() { PlaybackService s = svc(); return s != null && s.isPlaying(); }

    // ---------------- 诊断 ----------------
    @JavascriptInterface
    public void diag(String msg) {
        try {
            File dir = act.getExternalFilesDir(null);
            if (dir == null) return;
            File f = new File(dir, "diag.log");
            if (f.length() > 512 * 1024) {
                File old = new File(dir, "diag.old.log");
                if (old.exists()) old.delete();
                f.renameTo(old);
                f = new File(dir, "diag.log");
            }
            SimpleDateFormat fmt = new SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US);
            String line = fmt.format(new Date()) + "  " + msg + "\n";
            FileOutputStream out = new FileOutputStream(f, true);
            try {
                out.write(line.getBytes("UTF-8"));
            } finally {
                try { out.close(); } catch (Exception ignored) { }
            }
        } catch (Throwable ignored) { }
        Log.i(TAG, "diag: " + msg);
    }

    @JavascriptInterface
    public void diagLog(String tag, String msg) {
        try { Diag.writeApp(act, tag == null ? "js" : tag, msg == null ? "" : msg); } catch (Throwable ignored) { }
    }

    @JavascriptInterface
    public String diagSnapshot() {
        try { return Diag.snapshot(act); } catch (Throwable t) { return "snapshot failed: " + t; }
    }

    @JavascriptInterface
    public String diagExport() {
        try { return Diag.export(act); } catch (Throwable t) { return ""; }
    }

    @JavascriptInterface
    public String diagLastExport() {
        try { return Diag.lastExportPath(); } catch (Throwable t) { return ""; }
    }

    @JavascriptInterface
    public void diagState(String json) {
        try { Diag.writeState(act, json == null ? "{}" : json); } catch (Throwable ignored) { }
    }

    @JavascriptInterface
    public void diagClear() {
        try { Diag.clear(act); } catch (Throwable ignored) { }
    }

    // ---------------- 收藏与歌单 ----------------
    @JavascriptInterface public String favList() { return sp.getString("favs", "[]"); }
    @JavascriptInterface public void favSet(String json) { sp.edit().putString("favs", json).apply(); }
    @JavascriptInterface public String playlists() { return sp.getString("playlists", "[]"); }
    @JavascriptInterface public void savePlaylists(String json) { sp.edit().putString("playlists", json).apply(); }

    // ---------------- 网络与下载（委托 BridgeNet） ----------------
    @JavascriptInterface public String httpPost(String url, String body) { return net.httpPost(url, body); }
    @JavascriptInterface public String httpGet(String url) { return net.httpGet(url); }
    @JavascriptInterface public String download(String url, String fileName, String lrcText) { return net.download(url, fileName, lrcText); }
    @JavascriptInterface public void downloadAsync(String url, String fileName, String lrcText) { net.downloadAsync(url, fileName, lrcText); }

    // ---------------- 杂项与后台调度 ----------------
    @JavascriptInterface
    public void toast(String msg) {
        act.runOnUiThread(() -> Toast.makeText(act, msg, Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface
    public void nativeDelay(final int id, final int ms) {
        mainHandler.postDelayed(() -> {
            if (web != null) web.evaluateJavascript("window.__onNativeDelay&&window.__onNativeDelay(" + id + ")", null);
        }, Math.max(0, ms));
    }

    @JavascriptInterface
    public void setBgTask(final boolean active, final String title, final String sub) {
        mainHandler.post(() -> {
            PlaybackService s = svc();
            if (s != null) s.setBgTaskState(active, title, sub);
        });
    }

    // ---------------- 悬浮歌词 ----------------
    @JavascriptInterface public boolean overlayAllowed() { return LyricsOverlay.canDraw(act); }

    @JavascriptInterface
    public void overlaySettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + act.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        }
    }

    @JavascriptInterface public void showOverlay() { LyricsOverlay.get(act).show(); }
    @JavascriptInterface public void hideOverlay() { LyricsOverlay.get(act).hide(); }
    @JavascriptInterface public boolean overlayShown() { return LyricsOverlay.get(act).isShowing(); }
    @JavascriptInterface public void overlayLock(boolean v) { LyricsOverlay.get(act).setLocked(v); }
    @JavascriptInterface public boolean overlayLocked() { return LyricsOverlay.get(act).isLocked(); }

    @JavascriptInterface
    public void overlayColor(String hex) {
        try {
            String clean = hex.replace("#", "");
            int c = (int) Long.parseLong(clean, 16);
            if (clean.length() <= 6) c |= 0xFF000000;
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

    @JavascriptInterface public void overlayText(String a, String b) { LyricsOverlay.get(act).setText(a, b); }

    // ---------------- 音量平衡与设备信息 ----------------
    @JavascriptInterface public float estimateGainDb(String path) { return loudness.estimateGainDb(path); }

    @JavascriptInterface
    public void setPlaybackGainDb(final float gainDb) {
        mainHandler.post(() -> {
            PlaybackService s = svc();
            if (s != null) s.setGainDb(gainDb);
        });
    }

    @JavascriptInterface public String buildTag() { return PlaybackService.buildTagText; }

    @JavascriptInterface
    public String deviceInfo() {
        try {
            JSONObject o = new JSONObject();
            o.put("model", Build.MODEL);
            o.put("sdk", Build.VERSION.SDK_INT);
            o.put("dpWidth", (float) act.getResources().getConfiguration().screenWidthDp);
            o.put("dpHeight", (float) act.getResources().getConfiguration().screenHeightDp);
            o.put("smallestDp", act.getResources().getConfiguration().smallestScreenWidthDp);
            return o.toString();
        } catch (Exception e) {
            return "{}";
        }
    }
}
