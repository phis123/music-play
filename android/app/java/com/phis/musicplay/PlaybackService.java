package com.phis.musicplay;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.MediaMetadataRetriever;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/**
 * 前台播放服务：现在只是「壳」——播放动作全部交给 {@link PlayerEngine}（单线程串行），
 * 本类负责：MediaSession、通知栏、音频焦点、WakeLock、把状态推给网页。
 *
 * 解耦要点：本类不再直接持有/操作 MediaPlayer。
 */
public class PlaybackService extends Service {

    private static final String TAG = "MusicPlay";

    public static final String CH_ID = "mp_playback";
    public static final int NOTI_ID = 1001;

    public static volatile PlaybackService instance;
    /** 服务未就绪时的待播放请求（带代际，避免旧请求覆盖新请求） */
    private static String[] pending = null;
    private static int pendingGen = 0;
    public static MediaSession session;
    private static AudioManager am;

    private PlayerEngine engine;
    private android.media.audiofx.LoudnessEnhancer loudnessEnhancer = null;
    private float currentGainDb = 0f;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private String curTitle = "", curArtist = "", curPath = "", coverUrl = "";
    private Bitmap coverBmp = null;
    /** 封面位图缓存：按条目数限制，避免长会话 OOM */
    private final android.util.LruCache<String, Bitmap> coverCache =
            new android.util.LruCache<String, Bitmap>(48) {
                @Override protected int sizeOf(String key, Bitmap v) {
                    return v == null ? 1 : Math.max(1, v.getByteCount() / 1024);
                }
            };
    private volatile boolean playing = false;
    private volatile boolean preparing = false;
    private String lastUrl = "";
    private int lastPosMs = 0;
    private int durSec = 0;
    private boolean ducked = false;
    private boolean bgTaskActive = false;
    private String bgTaskTitle = "", bgTaskSub = "";
    private PowerManager.WakeLock bgWakeLock = null;

    public static volatile String buildTagText = "2026-11-19.10:30-v1.0.8";

    /** 播放状态回调（Bridge 实现，用来推给网页） */
    public interface Listener {
        void onState(boolean playing, int posSec, int durSec);
        void onComplete();
    }
    private static Listener listener;
    public static void setListener(Listener l) { listener = l; }
    public static Listener listener() { return listener; }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        createChannel();
        initSession();
        initEngine();
        try { startForeground(NOTI_ID, buildNotification()); } catch (Throwable t) { Diag.write(TAG, "startForeground 失败: " + t); }
        if (pending != null) {
            String[] p = pending;
            pending = null;
            playUrl(p[0], p[1], p[2], p[3], p[4]);
        }
        Diag.write("service", "PlaybackService.onCreate");
    }

    @Override
    public void onDestroy() {
        Diag.write("service", "PlaybackService.onDestroy");
        try { stopTicker(); } catch (Throwable ignored) { }
        try { if (engine != null) engine.release(); } catch (Throwable ignored) { }
        engine = null;
        // 音频焦点与 WakeLock 必须配对释放，否则别的 App 永久被 duck / 耗电
        try { abandonFocus(); } catch (Throwable ignored) { }
        releaseWakeLock();
        try { if (session != null) { session.setActive(false); session.release(); session = null; } } catch (Throwable ignored) { }
        // 注销静态 listener，避免持有已销毁的 WebView
        listener = null;
        instance = null;
        super.onDestroy();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CH_ID, "播放控制", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setSound(null, null);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    // ---------------- 播放内核 ----------------

    private void initEngine() {
        engine = new PlayerEngine();
        engine.setCallback(new PlayerEngine.Callback() {
            @Override public void onPrepared(int durationSec) {
                durSec = durationSec;
                ui.post(() -> { updateSession(); notifyState(); refreshNotification(); });
            }
            @Override public void onStarted() {
                playing = true;
                preparing = false;
                ui.post(() -> {
                    startTicker();
                    updateSession(); notifyState(); refreshNotification();
                });
            }
            @Override public void onPaused() {
                playing = false;
                lastPosMs = engine != null ? engine.positionMs() : 0;
                ui.post(() -> { stopTicker(); updateSession(); notifyState(); refreshNotification(); });
            }
            @Override public void onCompletion() {
                playing = false;
                lastPosMs = 0;
                ui.post(() -> {
                    stopTicker(); updateSession(); notifyState();
                    if (listener != null) listener.onComplete();
                });
            }
            @Override public void onError(int what, int extra) {
                playing = false;
                preparing = false;
                ui.post(() -> {
                    stopTicker(); updateSession(); notifyState();
                    notifyPlayerError(what, extra);
                });
            }
            @Override public void onPosition(int posMs, boolean isPlaying) {
                lastPosMs = posMs;
                playing = isPlaying;
            }
        });
    }

    private boolean hasEngine() {
        return engine != null;
    }

    private void initSession() {
        session = new MediaSession(this, "music-play");
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { resume(); }
            @Override public void onPause() { pause(); }
            @Override public void onStop() { stopSelf(); }
            @Override public void onSkipToNext() { js("window.onMediaNext&&window.onMediaNext()"); }
            @Override public void onSkipToPrevious() { js("window.onMediaPrev&&window.onMediaPrev()"); }
            @Override public void onSeekTo(long pos) { seek((int) pos); }
            @Override public void onPlayFromMediaId(String id, android.os.Bundle extras) { }
        });
        session.setActive(true);
        updateSession();
    }

    private void updateSession() {
        if (session == null) return;
        MediaMetadata.Builder md = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, curTitle)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, curArtist)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, durSec * 1000L);
        try {
            if (coverBmp != null) {
                md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, coverBmp);
                md.putBitmap(MediaMetadata.METADATA_KEY_ART, coverBmp);
                md.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, coverBmp);
            }
        } catch (Throwable ignored) { }
        try { session.setMetadata(md.build()); } catch (Throwable ignored) { }
        updatePlaybackStateOnly();
    }

    /** 只刷新播放状态与位置（tick 每秒调用，开销很小；bitmap metadata 只在换曲时重建） */
    private void updatePlaybackStateOnly() {
        if (session == null) return;
        PlaybackState.Builder st = new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE |
                        PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT |
                        PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        Math.max(0, lastPosMs), playing ? 1f : 0f);
        try { session.setPlaybackState(st.build()); } catch (Throwable ignored) { }
    }

    /** 在线封面异步下载后刷新通知（不阻塞主线程） */
    private void loadCoverAsync() {
        final String url = coverUrl;
        final String path = curPath;
        if (url != null && !url.isEmpty()) {
            Bitmap cached = coverCache.get(url);
            if (cached != null) {
                coverBmp = cached;
                ui.post(() -> { updateSession(); refreshNotification(); });
                return;
            }
        }
        new Thread(() -> {
            Bitmap bmp = null;
            if (url != null && url.startsWith("http")) {
                try {
                    java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                    c.setConnectTimeout(8000);
                    c.setReadTimeout(12000);
                    c.setRequestProperty("User-Agent", "Mozilla/5.0");
                    java.io.InputStream is = c.getInputStream();
                    bmp = android.graphics.BitmapFactory.decodeStream(is);
                    try { is.close(); } catch (Throwable ignored) { }
                    c.disconnect();
                } catch (Throwable ignored) { }
            }
            if (bmp == null) bmp = coverOf(path);
            final Bitmap fb = bmp;
            ui.post(() -> {
                coverBmp = fb;
                if (url != null && fb != null) coverCache.put(url, fb);
                updateSession();
                refreshNotification();
            });
        }, "mp-cover").start();
    }

    private Bitmap coverOf(String path) {
        if (path == null || path.isEmpty()) return null;
        Bitmap cached = coverCache.get("path:" + path);
        if (cached != null) return cached;
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(path);
            byte[] pic = r.getEmbeddedPicture();
            if (pic == null || pic.length == 0) return null;
            Bitmap b = android.graphics.BitmapFactory.decodeByteArray(pic, 0, pic.length);
            if (b != null) coverCache.put("path:" + path, b);
            return b;
        } catch (Throwable t) {
            return null;
        } finally {
            try { r.release(); } catch (Throwable ignored) { }
        }
    }

    private Notification buildNotification() {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CH_ID)
                : new Notification.Builder(this);

        String nTitle = curTitle.isEmpty()
                ? (bgTaskActive && !bgTaskTitle.isEmpty() ? bgTaskTitle : "music-play")
                : curTitle;
        String nText = curTitle.isEmpty()
                ? (bgTaskActive ? bgTaskSub : curArtist)
                : (bgTaskActive && !bgTaskTitle.isEmpty()
                    ? (curArtist.isEmpty() ? bgTaskTitle : (curArtist + " · " + bgTaskTitle))
                    : curArtist);

        b.setContentTitle(nTitle)
                .setContentText(nText)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentIntent(pi)
                .setOngoing(playing || bgTaskActive)
                .setOnlyAlertOnce(true)
                .setShowWhen(false)
                .setVisibility(Notification.VISIBILITY_PUBLIC);
        // 通知构建只使用已缓存的封面，绝不在主线程解码
        if (coverBmp != null) b.setLargeIcon(coverBmp);

        b.addAction(new Notification.Action.Builder(
                android.R.drawable.ic_media_previous, "上一首",
                serviceIntent("PREV")).build());
        b.addAction(new Notification.Action.Builder(
                playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                playing ? "暂停" : "播放", serviceIntent("TOGGLE")).build());
        b.addAction(new Notification.Action.Builder(
                android.R.drawable.ic_media_next, "下一首",
                serviceIntent("NEXT")).build());
        if (LyricsOverlay.get(this).isShowing() && LyricsOverlay.get(this).isLocked()) {
            b.addAction(new Notification.Action.Builder(
                    android.R.drawable.ic_lock_lock, "解锁歌词",
                    serviceIntent("UNLOCK_LYRICS")).build());
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            b.setStyle(new Notification.MediaStyle()
                    .setMediaSession(session.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2));
        }
        return b.build();
    }

    // ---------------- 后台任务保活 ----------------

    public void setBgTaskState(boolean active, String title, String sub) {
        this.bgTaskActive = active;
        this.bgTaskTitle = title == null ? "" : title;
        this.bgTaskSub = sub == null ? "" : sub;
        try {
            if (active) {
                acquireWakeLock();
                startForeground(NOTI_ID, buildNotification());
            } else {
                releaseWakeLock();
                refreshNotification();
            }
        } catch (Throwable t) {
            Diag.write(TAG, "setBgTaskState 失败: " + t);
        }
    }

    private void acquireWakeLock() {
        try {
            if (bgWakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    bgWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "musicplay:bgtask");
                    bgWakeLock.setReferenceCounted(false);
                }
            }
            if (bgWakeLock != null && !bgWakeLock.isHeld()) {
                // 单次上限 30 分钟，配合 25 分钟的续期，避免长任务静默失去 CPU
                bgWakeLock.acquire(30 * 60 * 1000L);
                ui.postDelayed(this::renewWakeLock, 25 * 60 * 1000L);
            }
        } catch (Throwable ignored) { }
    }

    private void renewWakeLock() {
        if (!bgTaskActive) { releaseWakeLock(); return; }
        try {
            if (bgWakeLock != null && bgWakeLock.isHeld()) bgWakeLock.release();
            if (bgWakeLock != null) bgWakeLock.acquire(30 * 60 * 1000L);
        } catch (Throwable ignored) { }
        ui.postDelayed(this::renewWakeLock, 25 * 60 * 1000L);
    }

    private void releaseWakeLock() {
        try {
            ui.removeCallbacks(this::renewWakeLock);
            if (bgWakeLock != null && bgWakeLock.isHeld()) bgWakeLock.release();
            bgWakeLock = null;
        } catch (Throwable ignored) { }
    }

    private PendingIntent serviceIntent(String action) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, action.hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public void refresh() { refreshNotification(); }

    private void refreshNotification() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTI_ID, buildNotification());
        } catch (Throwable ignored) { }
    }

    // ---------------- 播放控制（全部委托给 engine） ----------------

    public void playUrl(String url, String title, String artist, String path) {
        playUrl(url, title, artist, path, null);
    }

    public void playUrl(String url, String title, String artist, String path, String cover) {
        Diag.write(TAG, "playUrl thread=" + Thread.currentThread().getName() + " url=" + url);
        curTitle = title == null ? "" : title;
        curArtist = artist == null ? "" : artist;
        curPath = path == null ? "" : path;
        coverUrl = cover == null ? "" : cover;
        lastUrl = url == null ? "" : url;
        lastPosMs = 0;
        coverBmp = null;
        durSec = 0;
        preparing = true;
        requestFocus();
        if (!hasEngine()) initEngine();
        boolean queued = engine.playUrl(url);
        if (!queued) {
            preparing = false;
            notifyPlayerError(-1, 0);
            return;
        }
        ui.post(() -> { updateSession(); notifyState(); refreshNotification(); });
        loadCoverAsync();
    }

    public void pause() {
        Diag.write(TAG, "pause thread=" + Thread.currentThread().getName() + " pos=" + positionMs());
        if (!hasEngine()) { notifyPlayerError(-2, 0); return; }
        engine.pause();
        playing = false;
        lastPosMs = engine.positionMs();
        ui.post(() -> { stopTicker(); updateSession(); notifyState(); refreshNotification(); });
    }

    public void resume() {
        Diag.write(TAG, "resume thread=" + Thread.currentThread().getName() + " lastUrl=" + lastUrl);
        if (!hasEngine()) { notifyPlayerError(-2, 0); return; }
        // 数据源可能已失效：先尝试 start()，失败由 engine onError 上报，再按 lastUrl 重开
        engine.resume();
        ui.postDelayed(() -> {
            if (!playing && !engine.isPlaying()) {
                Diag.write(TAG, "resume 未生效，按上次数据源重开");
                reopenLast("resume失败");
            }
        }, 1200);
    }

    /** 界面发现"显示在播但实际没声"时可主动调用 */
    public void recover() {
        Diag.write(TAG, "recover() 主动重开数据源");
        reopenLast("界面请求恢复");
    }

    private void reopenLast(final String why) {
        if (lastUrl == null || lastUrl.isEmpty()) {
            notifyPlayerError(-1, 0);
            return;
        }
        final String url = lastUrl;
        final int pos = lastPosMs > 0 ? lastPosMs : positionMs();
        Diag.write(TAG, why + "：重开 " + url + " @" + pos + "ms");
        if (!hasEngine()) initEngine();
        engine.playUrl(url);
        if (pos > 0) ui.postDelayed(() -> { if (hasEngine()) engine.seek(pos); }, 600);
    }

    public void toggle() { if (playing) pause(); else resume(); }

    public void seek(int ms) {
        if (!hasEngine()) return;
        engine.seek(ms);
        lastPosMs = Math.max(0, ms);
        ui.post(this::updateSession);
    }

    public int positionSec() { return positionMs() / 1000; }
    private int positionMs() { return hasEngine() ? engine.positionMs() : lastPosMs; }

    public boolean isPlaying() { return hasEngine() ? engine.isPlaying() : playing; }
    public boolean isPreparing() { return preparing; }

    public void setGainDb(float gainDb) {
        this.currentGainDb = Math.max(-15f, Math.min(15f, gainDb));
        if (hasEngine()) engine.setGain(currentGainDb);
        else applyGainInternal();
    }

    /** 兼容旧调用：没有 engine 时仅记录，engine 就绪后再套用 */
    private void applyGainInternal() {
        if (hasEngine()) engine.setGain(currentGainDb);
    }

    // ---------------- 音频焦点 ----------------

    private AudioFocusRequest focusReq;

    private void requestFocus() {
        if (am == null) return;
        try {
            abandonFocus();   // 先放弃旧请求，避免多个请求叠加
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusReq = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_MEDIA)
                                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                        .setOnAudioFocusChangeListener(this::onFocusChange)
                        .build();
                int r = am.requestAudioFocus(focusReq);
                if (r != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                    Diag.write(TAG, "requestAudioFocus 未授予: " + r);
                }
            } else {
                int r = am.requestAudioFocus(this::onFocusChange, AudioManager.STREAM_MUSIC,
                        AudioManager.AUDIOFOCUS_GAIN);
                if (r != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                    Diag.write(TAG, "requestAudioFocus(legacy) 未授予: " + r);
                }
            }
        } catch (Throwable t) {
            Diag.write(TAG, "requestAudioFocus 异常: " + t);
        }
    }

    private void abandonFocus() {
        if (am == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusReq != null) {
                am.abandonAudioFocusRequest(focusReq);
                focusReq = null;
            } else {
                am.abandonAudioFocus(this::onFocusChange);
            }
        } catch (Throwable ignored) { }
    }

    private void onFocusChange(int change) {
        Diag.write(TAG, "onFocusChange change=" + change + " playing=" + playing + " preparing=" + preparing);
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            if (preparing) {
                // 播放准备期间收到的焦点变化是 requestAudioFocus 自己引起的抖动：
                // 记录下来，等准备完成后再决定是否真的暂停，避免把刚开始的播放打断。
                Diag.write(TAG, "忽略准备期间的焦点变化 change=" + change);
                return;
            }
            if (playing) pause();
        } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
            ducked = true;
            if (hasEngine()) engine.setDucked(true);
        } else if (change == AudioManager.AUDIOFOCUS_GAIN) {
            if (ducked) {
                ducked = false;
                if (hasEngine()) engine.setDucked(false);
            }
        }
    }

    // ---------------- 推给网页 ----------------

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            notifyState();
            updatePlaybackStateOnly();   // 让锁屏/通知的进度跟着走
            ui.postDelayed(this, 1000);
        }
    };

    private void startTicker() { ui.removeCallbacks(tick); ui.post(tick); }
    private void stopTicker() { ui.removeCallbacks(tick); }

    private void notifyState() {
        if (listener != null) {
            try { listener.onState(isPlaying(), positionSec(), durSec); } catch (Throwable ignored) { }
        }
    }

    /** 播放失败上报（never silent） */
    private void notifyPlayerError(int what, int extra) {
        js("window.onPlayerError&&window.onPlayerError(" + what + "," + extra + ")");
    }

    private void js(final String code) {
        final MainActivity a = MainActivity.current;
        if (a == null) return;
        a.runOnUiThread(() -> {
            try { if (a.webView != null) a.webView.evaluateJavascript(code, null); } catch (Throwable ignored) { }
        });
    }

    /** 供 Diag 快照使用的一行式状态 */
    public static String diagState() {
        PlaybackService s = instance;
        if (s == null) return "播放状态: 服务未运行";
        String title = s.curTitle;
        if (title != null && title.length() > 60) title = title.substring(0, 60) + "…";
        return "播放状态: playing=" + s.isPlaying() + " preparing=" + s.preparing
                + " ducked=" + s.ducked + " durSec=" + s.durSec
                + " posMs=" + s.positionMs()
                + " url=" + (s.lastUrl == null || s.lastUrl.isEmpty() ? "-" : s.lastUrl.replaceAll("[?].*$", ""))
                + " title=" + title;
    }

    // ---------------- 生命周期 ----------------

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String act = intent != null ? intent.getAction() : null;
        if ("UNLOCK_LYRICS".equals(act)) {
            LyricsOverlay.get(this).setLocked(false);
            refreshNotification();
        } else if ("TOGGLE".equals(act)) {
            toggle();
        } else if ("NEXT".equals(act)) {
            js("window.onMediaNext&&window.onMediaNext()");
        } else if ("PREV".equals(act)) {
            js("window.onMediaPrev&&window.onMediaPrev()");
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    // ---------------- 静态入口（服务未就绪时不崩） ----------------

    public static void play(Context ctx, String url, String title, String artist, String path, String cover) {
        PlaybackService s = instance;
        if (s != null) {
            s.playUrl(url, title, artist, path, cover);
            return;
        }
        int gen = ++pendingGen;
        pending = new String[]{url, title, artist, path, cover};
        if (!start(ctx)) {
            // 拉起失败：清掉 pending 并把错误告诉界面，绝不静默
            if (gen == pendingGen) pending = null;
            Diag.write("service", "start() 失败，播放请求被拒绝");
            try {
                MainActivity a = MainActivity.current;
                if (a != null) a.runOnUiThread(() ->
                        a.webView.evaluateJavascript("window.onPlayerError&&window.onPlayerError(-2,0)", null));
            } catch (Throwable ignored) { }
        }
    }

    /** 启动前台服务：Android 12+ 后台调用会抛异常，这里必须捕获并返回 false */
    public static boolean start(Context ctx) {
        try {
            Intent i = new Intent(ctx, PlaybackService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
            else ctx.startService(i);
            return true;
        } catch (Throwable t) {
            Diag.write("service", "startForegroundService 异常: " + t);
            return false;
        }
    }

    public static String buildTag() { return buildTagText; }
}