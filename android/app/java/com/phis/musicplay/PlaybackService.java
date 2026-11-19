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
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

/** 前台播放服务：MediaPlayer + MediaSession + 通知栏 + 音频焦点 + 后台任务保活 */
public class PlaybackService extends Service {

    private static final String TAG = "MusicPlay";

    public static final String CH_ID = "mp_playback";
    public static final int NOTI_ID = 1001;

    public static PlaybackService instance;
    private static String[] pending = null;   // 服务未就绪时的待播放请求
    public static MediaSession session;
    private static AudioManager am;

    private MediaPlayer mp;
    private android.media.audiofx.LoudnessEnhancer loudnessEnhancer = null;
    private float currentGainDb = 0f;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private String curTitle = "", curArtist = "", curPath = "", coverUrl = "";
    private Bitmap coverBmp = null;
    private final java.util.HashMap<String, Bitmap> coverCache = new java.util.HashMap<>();
    private boolean playing = false;
    /** playUrl 正在 prepare/start 期间为 true：此时到来的音频焦点变化是「我们自己请求焦点」引起的抖动，不能当成外部抢占 */
    private volatile boolean preparing = false;
    /** 最近一次播放的数据源与暂停位置：数据源失效时 resume() 用它重开 */
    private String lastUrl = "";
    private int lastPosMs = 0;
    private int durSec = 0;
    private boolean ducked = false;
    private boolean bgTaskActive = false;
    private String bgTaskTitle = "", bgTaskSub = "";
    private PowerManager.WakeLock bgWakeLock = null;

    /** 播放状态回调（Bridge 实现，用来推给网页） */
    public interface Listener {
        void onState(boolean playing, int posSec, int durSec);
        void onComplete();
    }
    private static Listener listener;
    public static void setListener(Listener l) { listener = l; }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        createChannel();
        initSession();
        initPlayer();
        startForeground(NOTI_ID, buildNotification());
        if (pending != null) {
            String[] p = pending;
            pending = null;
            playUrl(p[0], p[1], p[2], p[3], p[4]);
        }
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

    private void initPlayer() {
        mp = new MediaPlayer();
        mp.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
        mp.setOnCompletionListener(p -> {
            playing = false;
            lastPosMs = 0;
            android.util.Log.i(TAG, "onCompletion");
            updateSession();
            notifyState();
            if (listener != null) listener.onComplete();
        });
        mp.setOnErrorListener((p, w, e) -> {
            playing = false;
            stopTicker();
            android.util.Log.w(TAG, "MediaPlayer onError what=" + w + " extra=" + e);
            updateSession();
            notifyState();
            notifyPlayerError(w, e);
            return true;
        });
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

    private boolean lastPushedPlaying = false;

    private void updateSession() {
        if (session == null) return;
        MediaMetadata.Builder md = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, curTitle)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, curArtist)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, durSec * 1000L);
        try {
            Bitmap art = coverBmp != null ? coverBmp : coverOf(curPath);
            if (art != null) {
                md.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
                md.putBitmap(MediaMetadata.METADATA_KEY_ART, art);
                md.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, art);
            }
        } catch (Exception ignored) { }
        session.setMetadata(md.build());

        PlaybackState.Builder st = new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE |
                        PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT |
                        PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO)
                .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        mp != null ? mp.getCurrentPosition() : 0, playing ? 1f : 0f);
        session.setPlaybackState(st.build());
    }

    /** 在线封面异步下载后刷新通知 */
    private void loadCoverAsync() {
        final String url = coverUrl;
        final String path = curPath;
        if (url != null && coverCache.containsKey(url)) {
            coverBmp = coverCache.get(url);
            updateSession(); refreshNotification(); return;
        }
        new Thread(() -> {
            Bitmap bmp = null;
            if (url != null && url.startsWith("http")) {
                try {
                    java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                    c.setConnectTimeout(8000); c.setReadTimeout(12000);
                    c.setRequestProperty("User-Agent", "Mozilla/5.0");
                    java.io.InputStream is = c.getInputStream();
                    bmp = android.graphics.BitmapFactory.decodeStream(is);
                    is.close(); c.disconnect();
                } catch (Exception ignored) { }
            }
            if (bmp == null) bmp = coverOf(path);
            final Bitmap fb = bmp;
            ui.post(() -> {
                coverBmp = fb;
                if (url != null && fb != null) coverCache.put(url, fb);
                updateSession(); refreshNotification();
            });
        }).start();
    }

    private Bitmap coverOf(String path) {
        if (path == null || path.isEmpty()) return null;
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(path);
            byte[] pic = r.getEmbeddedPicture();
            if (pic == null) return null;
            return android.graphics.BitmapFactory.decodeByteArray(pic, 0, pic.length);
        } catch (Exception e) {
            return null;
        } finally {
            try { r.release(); } catch (Exception ignored) { }
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
        if (coverBmp != null) {
            b.setLargeIcon(coverBmp);
        } else {
            Bitmap eb = coverOf(curPath);
            if (eb != null) b.setLargeIcon(eb);
        }

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

    public void setBgTaskState(boolean active, String title, String sub) {
        this.bgTaskActive = active;
        this.bgTaskTitle = title == null ? "" : title;
        this.bgTaskSub = sub == null ? "" : sub;
        try {
            if (active) {
                if (bgWakeLock == null) {
                    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                    if (pm != null) {
                        bgWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "musicplay:bgtask");
                        bgWakeLock.setReferenceCounted(false);
                    }
                }
                if (bgWakeLock != null && !bgWakeLock.isHeld()) {
                    bgWakeLock.acquire(45 * 60 * 1000L);
                }
                startForeground(NOTI_ID, buildNotification());
            } else {
                if (bgWakeLock != null && bgWakeLock.isHeld()) {
                    bgWakeLock.release();
                }
                refreshNotification();
            }
        } catch (Throwable ignored) { }
    }

    private PendingIntent serviceIntent(String action) {
        Intent i = new Intent(this, PlaybackService.class).setAction(action);
        return PendingIntent.getService(this, action.hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public void refresh() { refreshNotification(); }

    private void refreshNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTI_ID, buildNotification());
    }

    // ---------------- 播放控制 ----------------
    public void playUrl(String url, String title, String artist, String path) {
        playUrl(url, title, artist, path, null);
    }

    public void playUrl(String url, String title, String artist, String path, String cover) {
        android.util.Log.i(TAG, "playUrl thread=" + Thread.currentThread().getName() + " url=" + url);
        preparing = true;
        try {
            curTitle = title == null ? "" : title;
            curArtist = artist == null ? "" : artist;
            curPath = path == null ? "" : path;
            coverUrl = cover == null ? "" : cover;
            lastUrl = url == null ? "" : url;
            lastPosMs = 0;
            coverBmp = null;
            requestFocus();
            if (mp == null) initPlayer();
            mp.reset();
            mp.setDataSource(url);
            mp.prepare();
            applyGainInternal();
            mp.start();
            playing = true;
            durSec = mp.getDuration() / 1000;
            startTicker();
            updateSession();
            refreshNotification();
            loadCoverAsync();
            android.util.Log.i(TAG, "playUrl ok, dur=" + durSec);
        } catch (Exception e) {
            playing = false;
            stopTicker();
            android.util.Log.w(TAG, "playUrl 失败", e);
            updateSession();
            notifyState();
            notifyPlayerError(-1, 0);
        } finally {
            preparing = false;
        }
    }

    public void pause() {
        android.util.Log.i(TAG, "pause thread=" + Thread.currentThread().getName() + " pos=" + positionMs());
        try { if (mp != null && mp.isPlaying()) mp.pause(); } catch (Exception e) {
            android.util.Log.w(TAG, "pause 失败", e);
        }
        lastPosMs = positionMs();
        playing = false;
        stopTicker();
        updateSession();
        refreshNotification();
        notifyState();
    }

    public void resume() {
        android.util.Log.i(TAG, "resume thread=" + Thread.currentThread().getName()
                + " mp=" + (mp == null ? "null" : "ok") + " lastUrl=" + lastUrl);
        boolean ok = false;
        try {
            if (mp != null) {
                if (!mp.isPlaying()) { mp.start(); }
                ok = true;
            }
        } catch (Exception e) {
            ok = false;
            android.util.Log.w(TAG, "resume: mp.start 抛异常，准备重开数据源", e);
        }
        if (ok) {
            playing = true;
            startTicker();
            updateSession();
            refreshNotification();
            notifyState();
            android.util.Log.i(TAG, "resume ok");
            return;
        }
        reopenLast("resume失败");
    }

    /** 按上次的数据源重开并 seek 回暂停位置。
     *  在主线程调用时（MediaSession 回调）起后台线程做，避免阻塞主线程；
     *  在 JS 桥线程调用时（原本就在做阻塞 prepare）直接内联执行，保证 MediaPlayer 操作线程一致。 */
    private void reopenLast(final String why) {
        if (lastUrl == null || lastUrl.isEmpty()) {
            playing = false;
            android.util.Log.w(TAG, why + "：没有可重开的数据源");
            updateSession();
            notifyState();
            notifyPlayerError(-1, 0);
            return;
        }
        final String url = lastUrl;
        final String title = curTitle, artist = curArtist, path = curPath, cover = coverUrl;
        final int pos = lastPosMs > 0 ? lastPosMs : positionMs();
        android.util.Log.i(TAG, why + "：重开 " + url + " @ " + pos + "ms");
        Runnable task = () -> {
            playUrl(url, title, artist, path, cover);
            if (playing && pos > 0) {
                try { mp.seekTo(pos); } catch (Exception e) {
                    android.util.Log.w(TAG, "reopen seekTo 失败", e);
                }
            }
            updateSession();
            notifyState();
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            new Thread(task, "musicplay-reopen").start();
        } else {
            task.run();
        }
    }

    /** 供界面在「显示在播但实际没声」时调用：按上次数据源重开并 seek 回原位置 */
    public void recover() {
        android.util.Log.i(TAG, "recover() 主动重开数据源");
        reopenLast("界面请求恢复");
    }

    private int positionMs() {
        try { return mp != null ? mp.getCurrentPosition() : 0; } catch (Exception e) { return 0; }
    }

    /** 把播放失败告诉界面：以前从不回调，用户看到的就是「点了没反应也没有提示」 */
    private void notifyPlayerError(int what, int extra) {
        js("window.onPlayerError&&window.onPlayerError(" + what + "," + extra + ")");
    }

    public void toggle() { if (playing) pause(); else resume(); }

    public void seek(int ms) {
        try { if (mp != null) mp.seekTo(ms); } catch (Exception ignored) { }
        updateSession();
    }

    public int positionSec() {
        try { return mp != null ? mp.getCurrentPosition() / 1000 : 0; } catch (Exception e) { return 0; }
    }

    public boolean isPlaying() { return playing; }

    /** 供 Diag 快照引用（避免 Diag 直接读私有字段） */
    public static volatile String buildTagText = "2026-11-19.09:30-v1.0.7";

    /** 一行式播放状态摘要 */
    public static String diagState() {
        PlaybackService s = instance;
        if (s == null) return "播放状态: 服务未运行";
        String title = s.curTitle;
        if (title != null && title.length() > 60) title = title.substring(0, 60) + "…";
        return "播放状态: playing=" + s.playing + " preparing=" + s.preparing
                + " ducked=" + s.ducked + " durSec=" + s.durSec
                + " posMs=" + s.positionMs()
                + " url=" + (s.lastUrl == null || s.lastUrl.isEmpty() ? "-" : s.lastUrl.replaceAll("[?].*$", ""))
                + " title=" + title;
    }

    // ---------------- 音频焦点 ----------------
    private AudioFocusRequest focusReq;

    private void requestFocus() {
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusReq = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    .setOnAudioFocusChangeListener(this::onFocusChange)
                    .build();
            am.requestAudioFocus(focusReq);
        } else {
            am.requestAudioFocus(this::onFocusChange, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
    }

    private void onFocusChange(int change) {
        android.util.Log.i(TAG, "onFocusChange change=" + change + " preparing=" + preparing + " playing=" + playing);
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            // 正在 prepare/start 时收到的焦点变化，是 requestAudioFocus 自己引起的抖动：
            // 之前这里会立刻 pause()，把刚开始的播放打断，界面却仍显示「播放中」。
            if (preparing) {
                android.util.Log.i(TAG, "忽略准备期间的焦点变化 change=" + change);
                return;
            }
            if (playing) { pause(); }
        } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
            try { if (mp != null) mp.setVolume(0.2f, 0.2f); ducked = true; } catch (Exception ignored) { }
        } else if (change == AudioManager.AUDIOFOCUS_GAIN) {
            if (ducked) {
                ducked = false;
                applyGainInternal();
            }
        }
    }

    public void setGainDb(float gainDb) {
        this.currentGainDb = Math.max(-15f, Math.min(15f, gainDb));
        applyGainInternal();
    }

    private void applyGainInternal() {
        if (mp == null) return;
        if (ducked) {
            try { mp.setVolume(0.2f, 0.2f); } catch (Exception ignored) { }
            return;
        }
        try {
            if (currentGainDb <= 0f) {
                float linear = (float) Math.pow(10.0, currentGainDb / 20.0);
                if (linear < 0.05f) linear = 0.05f;
                if (linear > 1.0f) linear = 1.0f;
                mp.setVolume(linear, linear);
                if (loudnessEnhancer != null) {
                    try {
                        loudnessEnhancer.setTargetGain(0);
                        loudnessEnhancer.setEnabled(false);
                    } catch (Throwable ignored) { }
                }
            } else {
                mp.setVolume(1.0f, 1.0f);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
                    if (loudnessEnhancer == null) {
                        loudnessEnhancer = new android.media.audiofx.LoudnessEnhancer(mp.getAudioSessionId());
                    }
                    int targetMb = Math.round(currentGainDb * 100f); // 1 dB = 100 mB
                    loudnessEnhancer.setTargetGain(targetMb);
                    loudnessEnhancer.setEnabled(true);
                }
            }
        } catch (Throwable ignored) { }
    }

    // ---------------- ticker ----------------
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            notifyState();
            updateSession();
            ui.postDelayed(this, 1000);
        }
    };
    private void startTicker() { ui.removeCallbacks(tick); ui.post(tick); }
    private void stopTicker() { ui.removeCallbacks(tick); }

    private void notifyState() {
        if (listener != null) listener.onState(playing, positionSec(), durSec);
    }

    private void js(final String code) {
        final MainActivity a = MainActivity.current;
        if (a == null) return;
        a.runOnUiThread(() -> {
            if (a.webView != null) a.webView.evaluateJavascript(code, null);
        });
    }

    // ---------------- 生命周期 ----------------
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String act = intent != null ? intent.getAction() : null;
        if ("UNLOCK_LYRICS".equals(act)) { LyricsOverlay.get(this).setLocked(false); refreshNotification(); }
        else if ("TOGGLE".equals(act)) toggle();
        else if ("NEXT".equals(act)) js("window.onMediaNext&&window.onMediaNext()");
        else if ("PREV".equals(act)) js("window.onMediaPrev&&window.onMediaPrev()");
        startForeground(NOTI_ID, buildNotification());
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onDestroy() {
        stopTicker();
        try { if (loudnessEnhancer != null) { loudnessEnhancer.release(); loudnessEnhancer = null; } } catch (Throwable ignored) { }
        try { if (mp != null) { mp.release(); mp = null; } } catch (Exception ignored) { }
        if (session != null) { session.setActive(false); session.release(); session = null; }
        if (am != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusReq != null) {
            am.abandonAudioFocusRequest(focusReq);
        }
        instance = null;
        super.onDestroy();
    }

    /** 服务没起来时先存起来，起来后立刻播 */
    public static void play(Context ctx, String url, String title, String artist, String path, String cover) {
        if (instance != null) {
            instance.playUrl(url, title, artist, path, cover);
            return;
        }
        pending = new String[]{url, title, artist, path, cover};
        start(ctx);
    }

    public static void start(Context ctx) {
        Intent i = new Intent(ctx, PlaybackService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i);
        else ctx.startService(i);
    }
}
