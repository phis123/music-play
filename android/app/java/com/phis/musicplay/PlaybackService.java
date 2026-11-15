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

    public static final String CH_ID = "mp_playback";
    public static final int NOTI_ID = 1001;

    public static PlaybackService instance;
    private static String[] pending = null;   // 服务未就绪时的待播放请求
    public static MediaSession session;
    private static AudioManager am;

    private MediaPlayer mp;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private String curTitle = "", curArtist = "", curPath = "", coverUrl = "";
    private Bitmap coverBmp = null;
    private final java.util.HashMap<String, Bitmap> coverCache = new java.util.HashMap<>();
    private boolean playing = false;
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
            updateSession();
            notifyState();
            if (listener != null) listener.onComplete();
        });
        mp.setOnErrorListener((p, w, e) -> {
            playing = false;
            updateSession();
            notifyState();
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
        try {
            curTitle = title == null ? "" : title;
            curArtist = artist == null ? "" : artist;
            curPath = path == null ? "" : path;
            coverUrl = cover == null ? "" : cover;
            coverBmp = null;
            requestFocus();
            if (mp == null) initPlayer();
            mp.reset();
            mp.setDataSource(url);
            mp.prepare();
            mp.start();
            playing = true;
            durSec = mp.getDuration() / 1000;
            startTicker();
            updateSession();
            refreshNotification();
            loadCoverAsync();
        } catch (Exception e) {
            playing = false;
            notifyState();
        }
    }

    public void pause() {
        try { if (mp != null && mp.isPlaying()) mp.pause(); } catch (Exception ignored) { }
        playing = false;
        stopTicker();
        updateSession();
        refreshNotification();
        notifyState();
    }

    public void resume() {
        try {
            if (mp != null && !mp.isPlaying()) { mp.start(); playing = true; startTicker(); }
        } catch (Exception ignored) { }
        updateSession();
        refreshNotification();
        notifyState();
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
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            if (playing) { pause(); }
        } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
            try { if (mp != null) mp.setVolume(0.2f, 0.2f); ducked = true; } catch (Exception ignored) { }
        } else if (change == AudioManager.AUDIOFOCUS_GAIN) {
            if (ducked) {
                try { if (mp != null) mp.setVolume(1f, 1f); } catch (Exception ignored) { }
                ducked = false;
            }
        }
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
