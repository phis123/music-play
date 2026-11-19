package com.phis.musicplay;

import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;

/**
 * 播放内核：**唯一持有 MediaPlayer 的地方**，所有调用串行投递到同一个 HandlerThread。
 *
 * 背景：之前 MediaPlayer 会被 JS 桥线程、主线程 ticker、reopen 线程同时调用
 * （reset/start/getCurrentPosition），会随机抛 IllegalStateException 或让进度错乱。
 * 这里把「谁都能碰 mp」改成「只有 player 线程能碰 mp」，外部只读缓存状态。
 *
 * 对外语义：
 *  - playUrl/pause/resume/seek/setVolume/setGain/release：投递异步执行，返回 boolean 表示已入队
 *  - isPlaying()/positionMs()/durationSec()/isPreparing()：读线程安全的缓存值（可能落后 ≤1 帧）
 *  - setCallback：状态变化回调，**都在 player 线程上触发**，调用方需自行切主线程
 */
public class PlayerEngine {

    public interface Callback {
        void onPrepared(int durationSec);
        void onStarted();
        void onPaused();
        void onCompletion();
        void onError(int what, int extra);
        /** 每 ~200ms 一次的位置心跳（player 线程） */
        void onPosition(int posMs, boolean playing);
    }

    private final HandlerThread thread;
    private final Handler h;
    private MediaPlayer mp;
    private Callback cb;

    private volatile boolean playing = false;
    private volatile boolean preparing = false;
    private volatile int posMs = 0;
    private volatile int durationSec = 0;
    private volatile String lastUrl = "";

    private android.media.audiofx.LoudnessEnhancer enhancer;
    private float gainDb = 0f;
    private float duckFactor = 1f;

    public PlayerEngine() {
        thread = new HandlerThread("mp-player");
        thread.start();
        h = new Handler(thread.getLooper());
        post(this::initOnThread);
    }

    private void initOnThread() {
        try {
            mp = new MediaPlayer();
            mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
            mp.setOnPreparedListener(p -> {
                // 同步 prepare() 也会触发这个回调：只在还没进入播放态时才 start，
                // 避免对同一数据源连续调用两次 mp.start()。
                durationSec = safeDur();
                preparing = false;
                if (!playing) playInternal();
                android.util.Log.i("MusicPlay", "engine prepared dur=" + durationSec);
                if (cb != null) cb.onPrepared(durationSec);
            });
            mp.setOnCompletionListener(p -> {
                playing = false;
                posMs = 0;
                applyVolumeInternal();
                android.util.Log.i("MusicPlay", "engine completion");
                if (cb != null) cb.onCompletion();
            });
            mp.setOnErrorListener((p, w, e) -> {
                playing = false;
                preparing = false;
                android.util.Log.w("MusicPlay", "engine error what=" + w + " extra=" + e);
                if (cb != null) cb.onError(w, e);
                return true;
            });
            h.postDelayed(positionTick, 200);
        } catch (Throwable t) {
            android.util.Log.w("MusicPlay", "engine init 失败", t);
        }
    }

    private final Runnable positionTick = new Runnable() {
        @Override public void run() {
            try {
                if (mp != null) {
                    if (playing) {
                        int p = mp.getCurrentPosition();
                        if (p >= 0) posMs = p;
                    }
                    if (cb != null) cb.onPosition(posMs, playing);
                }
            } catch (Throwable ignored) { }
            h.postDelayed(this, 200);
        }
    };

    public void setCallback(Callback c) { cb = c; }

    public boolean isPlaying() { return playing; }
    public boolean isPreparing() { return preparing; }
    public int positionMs() { return posMs; }
    public int durationSec() { return durationSec; }
    public String lastUrl() { return lastUrl; }

    /** 打开并播放新的数据源；prepare 在 player 线程阻塞，不阻塞 UI/JS */
    public boolean playUrl(final String url) {
        if (url == null || url.isEmpty()) return false;
        preparing = true;
        lastUrl = url;
        return post(() -> {
            try {
                if (mp == null) initOnThread();
                mp.reset();
                mp.setDataSource(url);
                mp.prepare();      // 阻塞在 player 线程
                durationSec = safeDur();
                desidePrepared();
            } catch (Throwable t) {
                preparing = false;
                playing = false;
                android.util.Log.w("MusicPlay", "engine playUrl 失败", t);
                if (cb != null) cb.onError(-1, 0);
            }
        });
    }

    /** prepare 已在 playUrl 内完成，这里统一切换到播放态（也供 onPrepared 回调路径复用） */
    private void desidePrepared() {
        preparing = false;
        playInternal();
        if (cb != null) cb.onPrepared(durationSec);
    }

    private void playInternal() {
        try {
            if (mp != null) {
                applyVolumeInternal();
                mp.start();
                playing = true;
                android.util.Log.i("MusicPlay", "engine started");
                if (cb != null) cb.onStarted();
            }
        } catch (Throwable t) {
            playing = false;
            android.util.Log.w("MusicPlay", "engine start 失败", t);
            if (cb != null) cb.onError(-1, 0);
        }
    }

    public boolean pause() {
        return post(() -> {
            try {
                if (mp != null && mp.isPlaying()) mp.pause();
                posMs = mp != null ? Math.max(0, mp.getCurrentPosition()) : posMs;
                playing = false;
                android.util.Log.i("MusicPlay", "engine paused pos=" + posMs);
                if (cb != null) cb.onPaused();
            } catch (Throwable t) {
                android.util.Log.w("MusicPlay", "engine pause 失败", t);
            }
        });
    }

    /** 恢复：若是数据源失效导致的暂停，调用方应先 playUrl(lastUrl) */
    public boolean resume() {
        return post(() -> {
            try {
                if (mp != null && !mp.isPlaying()) {
                    mp.start();
                    playing = true;
                    android.util.Log.i("MusicPlay", "engine resumed");
                    if (cb != null) cb.onStarted();
                }
            } catch (Throwable t) {
                playing = false;
                android.util.Log.w("MusicPlay", "engine resume 失败", t);
                if (cb != null) cb.onError(-1, 0);
            }
        });
    }

    public boolean seek(final int ms) {
        return post(() -> {
            try { if (mp != null) { mp.seekTo(Math.max(0, ms)); posMs = Math.max(0, ms); } } catch (Throwable ignored) { }
        });
    }

    public boolean setVolume(final float linear) {
        return post(() -> {
            try { if (mp != null) mp.setVolume(linear, linear); } catch (Throwable ignored) { }
        });
    }

    /** 音量平衡：<=0 用系统音量衰减，>0 用 LoudnessEnhancer 硬件放大 */
    public boolean setGain(final float db) {
        gainDb = db;
        return post(this::applyGainInternal);
    }

    private void applyGainInternal() {
        try {
            if (mp == null) return;
            float db = gainDb;
            if (db <= 0f) {
                float linear = (float) Math.pow(10.0, db / 20.0);
                if (linear < 0.05f) linear = 0.05f;
                if (linear > 1f) linear = 1f;
                linear *= duckFactor;
                mp.setVolume(linear, linear);
                if (enhancer != null) {
                    try { enhancer.setTargetGain(0); enhancer.setEnabled(false); } catch (Throwable ignored) { }
                }
            } else {
                mp.setVolume(duckFactor, duckFactor);
                if (enhancer == null) {
                    enhancer = new android.media.audiofx.LoudnessEnhancer(mp.getAudioSessionId());
                }
                enhancer.setTargetGain(Math.round(db * 100f));
                enhancer.setEnabled(true);
            }
        } catch (Throwable ignored) { }
    }

    private void applyVolumeInternal() {
        try { applyGainInternal(); } catch (Throwable ignored) { }
    }

    /** 被其它 App 抢占时的闪避（0.2 倍）与恢复 */
    public boolean setDucked(final boolean ducked) {
        duckFactor = ducked ? 0.2f : 1f;
        return post(this::applyGainInternal);
    }

    public void release() {
        post(() -> {
            h.removeCallbacks(positionTick);
            try { if (enhancer != null) { enhancer.release(); enhancer = null; } } catch (Throwable ignored) { }
            try { if (mp != null) { mp.release(); mp = null; } } catch (Throwable ignored) { }
            playing = false;
            preparing = false;
        });
        // 给队列一点时间执行完 release，再退出线程
        h.postDelayed(this::quitThread, 300);
    }

    private void quitThread() {
        try { thread.quitSafely(); } catch (Throwable ignored) { }
    }

    private int safeDur() {
        try { return mp != null ? Math.max(0, mp.getDuration() / 1000) : 0; } catch (Throwable t) { return 0; }
    }

    private boolean post(Runnable r) {
        if (Thread.currentThread() == thread) { r.run(); return true; }
        return h.post(r);
    }

    public boolean onPlayerThread() {
        return Thread.currentThread() == thread;
    }

    public Looper looper() { return thread.getLooper(); }
}