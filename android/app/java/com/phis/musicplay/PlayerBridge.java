package com.phis.musicplay;

import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

/** MediaPlayer 封装 + 进度回调到 WebView */
public class PlayerBridge {

    private final WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private MediaPlayer mp;
    private String currentPath = "";
    private boolean released = false;

    public PlayerBridge(android.content.Context ctx, WebView web) {
        this.web = web;
    }

    private void ensurePlayer() {
        if (mp == null) {
            mp = new MediaPlayer();
            mp.setOnCompletionListener(p -> {
                js("window.onEnded&&window.onEnded()");
                stopTicker();
            });
            mp.setOnErrorListener((p, what, extra) -> {
                js("window.onPlayerError&&window.onPlayerError(" + what + "," + extra + ")");
                stopTicker();
                return true;
            });
        }
    }

    public void play(String path) {
        try {
            ensurePlayer();
            mp.reset();
            mp.setDataSource(path);
            mp.prepare();
            mp.start();
            currentPath = path;
            startTicker();
            js("window.onPlaying&&window.onPlaying(" + (int) (mp.getDuration() / 1000) + ")");
        } catch (Exception e) {
            js("window.onPlayerError&&window.onPlayerError(-1,0)");
        }
    }

    public void pause() {
        try { if (mp != null && mp.isPlaying()) mp.pause(); } catch (Exception ignored) { }
        stopTicker();
    }

    public void resume() {
        try {
            if (mp != null && !mp.isPlaying()) { mp.start(); startTicker(); }
        } catch (Exception ignored) { }
    }

    public void stop() {
        try { if (mp != null) { mp.stop(); mp.reset(); } } catch (Exception ignored) { }
        stopTicker();
    }

    public void seek(int ms) {
        try { if (mp != null) mp.seekTo(ms); } catch (Exception ignored) { }
    }

    public int positionSec() {
        try { return mp != null ? mp.getCurrentPosition() / 1000 : 0; } catch (Exception e) { return 0; }
    }

    public boolean isPlaying() {
        try { return mp != null && mp.isPlaying(); } catch (Exception e) { return false; }
    }

    public String currentPath() { return currentPath; }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (released) return;
            js("window.onTick&&window.onTick(" + positionSec() + ")");
            ui.postDelayed(this, 500);
        }
    };

    private void startTicker() {
        ui.removeCallbacks(tick);
        ui.post(tick);
    }

    private void stopTicker() {
        ui.removeCallbacks(tick);
    }

    private void js(String code) {
        if (web == null) return;
        web.post(() -> web.evaluateJavascript(code, null));
    }

    public void release() {
        released = true;
        stopTicker();
        try { if (mp != null) { mp.release(); mp = null; } } catch (Exception ignored) { }
    }
}
