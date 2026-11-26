package com.phis.musicplay;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.MediaMetadataRetriever;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 曲库文件、路径边界校验、封面 LRU 缓存、私有歌词存储与系统存储权限。
 * 由 Bridge 门面委托调用，不直接暴露给 WebView。
 */
final class BridgeStorage {

    private static final int MAX_COVER_CACHE = 160;

    private final Activity act;
    private final SharedPreferences sp;
    private final LinkedHashMap<String, String> coverCache =
            new LinkedHashMap<String, String>(200, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, String> eldest) {
                    return size() > MAX_COVER_CACHE;
                }
            };

    BridgeStorage(Activity act, SharedPreferences sp) {
        this.act = act;
        this.sp = sp;
    }

    String listAudio() {
        return AudioStore.listJson(act);
    }

    int rescan() {
        try { return AudioStore.rescan(act); } catch (Exception e) { return 0; }
    }

    boolean mediaStoreOk() {
        try { return AudioStore.mediaStoreOk(); } catch (Exception e) { return false; }
    }

    void clearTagCache() {
        try { AudioStore.clearTagCache(act); } catch (Exception ignored) { }
    }

    /**
     * 路径边界校验（P0-2）：只允许读写/删曲库白名单目录或 App 外部私有目录内的规范路径，
     * 符号链接逃逸到白名单外时拒绝。
     */
    boolean isInsideAllowedRoot(File f) {
        try {
            if (f == null) return false;
            File canon = f.getCanonicalFile();
            File pubMusic = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC);
            File[] roots = new File[]{
                    AudioStore.rootDir(),
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

    String readText(String path) {
        try {
            File f = new File(path);
            if (!isInsideAllowedRoot(f) || !f.exists()) return null;
            BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8"));
            try {
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
                return sb.toString();
            } finally {
                try { r.close(); } catch (Exception ignored) { }
            }
        } catch (Exception e) {
            return null;
        }
    }

    boolean lrcExists(String audioPath) {
        try {
            File f = new File(audioPath.replaceAll("\\.[^.]+$", "") + ".lrc");
            return isInsideAllowedRoot(f) && f.exists();
        } catch (Exception e) {
            return false;
        }
    }

    String cover(String path) {
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
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            mmr.setDataSource(path);
            byte[] pic = mmr.getEmbeddedPicture();
            if (pic != null && pic.length > 0) {
                out = "data:image/jpeg;base64," + Base64.encodeToString(pic, Base64.NO_WRAP);
            }
        } catch (Exception ignored) {
        } finally {
            try { mmr.release(); } catch (Exception ignored) { }
        }
        if (out.isEmpty()) {
            try {
                File sideJpg = new File(path.replaceAll("\\.[^.]+$", "") + ".jpg");
                if (sideJpg.exists() && isInsideAllowedRoot(sideJpg)
                        && sideJpg.length() > 0 && sideJpg.length() < 10 * 1024 * 1024) {
                    byte[] buf = new byte[(int) sideJpg.length()];
                    FileInputStream fis = new FileInputStream(sideJpg);
                    int read = 0;
                    try {
                        while (read < buf.length) {
                            int n = fis.read(buf, read, buf.length - read);
                            if (n <= 0) break;
                            read += n;
                        }
                    } finally {
                        try { fis.close(); } catch (Exception ignored) { }
                    }
                    out = "data:image/jpeg;base64," + Base64.encodeToString(buf, 0, read, Base64.NO_WRAP);
                }
            } catch (Exception ignored) { }
        }
        synchronized (coverCache) {
            coverCache.put(path, out);
        }
        return out;
    }

    boolean saveLyric(String audioPath, String text) {
        try {
            File dir = new File(act.getExternalFilesDir(null), "lyrics");
            if (!dir.exists()) dir.mkdirs();
            String key = Integer.toHexString(audioPath.hashCode());
            File f = new File(dir, key + ".lrc");
            FileOutputStream fo = new FileOutputStream(f);
            try {
                fo.write(text.getBytes("UTF-8"));
            } finally {
                try { fo.close(); } catch (Exception ignored) { }
            }
            sp.edit().putString("lrcpath:" + f.getName(), audioPath).apply();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    String loadLyricByBase(String audioPath) {
        try {
            File dir = new File(act.getExternalFilesDir(null), "lyrics");
            if (!dir.exists()) return null;
            String base = audioPath.substring(audioPath.lastIndexOf('/') + 1).replaceAll("\\.[^.]+$", "");
            File[] files = dir.listFiles();
            if (files == null) return null;
            for (File f : files) {
                String saved = sp.getString("lrcpath:" + f.getName(), "");
                if (saved.isEmpty()) continue;
                String sb = saved.substring(saved.lastIndexOf('/') + 1).replaceAll("\\.[^.]+$", "");
                if (sb.equals(base)) return readText(f.getAbsolutePath());
            }
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    String loadLyric(String audioPath) {
        try {
            File dir = new File(act.getExternalFilesDir(null), "lyrics");
            String key = Integer.toHexString(audioPath.hashCode());
            File f = new File(dir, key + ".lrc");
            if (!f.exists()) return null;
            return readText(f.getAbsolutePath());
        } catch (Exception e) {
            return null;
        }
    }

    private static final class AudioCount {
        int n;
        boolean listable;
    }

    private static AudioCount countAudio(File d) {
        AudioCount r = new AudioCount();
        try {
            File[] fs = d.listFiles();
            if (fs == null) return r;
            r.listable = true;
            for (File f : fs) {
                String n = f.getName().toLowerCase();
                if (n.endsWith(".mp3") || n.endsWith(".flac") || n.endsWith(".m4a")
                        || n.endsWith(".wav") || n.endsWith(".ogg") || n.endsWith(".aac")
                        || n.endsWith(".opus")) {
                    r.n++;
                }
            }
        } catch (Exception ignored) { }
        return r;
    }

    String storageInfo() {
        JSONObject o = new JSONObject();
        try {
            File pub = AudioStore.rootDir();
            File pri = AudioStore.privateDir(act);
            o.put("public", pub.getAbsolutePath());
            o.put("publicExists", pub.exists());
            o.put("publicPick", AudioStore.pickWritableDir(act).getAbsolutePath());
            o.put("private", pri.getAbsolutePath());
            o.put("privateExists", pri.exists());
            AudioCount c1 = countAudio(pub);
            AudioCount c2 = countAudio(pri);
            o.put("publicAudio", c1.n);
            o.put("privateAudio", c2.n);
            o.put("publicListable", c1.listable);
            o.put("privateListable", c2.listable);
            o.put("allFiles", hasAllFiles());
            o.put("sdk", Build.VERSION.SDK_INT);
        } catch (Exception e) {
            try { o.put("error", String.valueOf(e.getMessage())); } catch (Exception ignored) { }
        }
        return o.toString();
    }

    boolean hasAllFiles() {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                return Environment.isExternalStorageManager();
            }
            return true;
        } catch (Throwable t) {
            return true;
        }
    }

    boolean openAllFilesSettings() {
        try {
            if (Build.VERSION.SDK_INT < 30) return false;
            Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
            i.setData(Uri.parse("package:" + act.getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
            return true;
        } catch (Exception e) {
            try {
                Intent i2 = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                i2.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                act.startActivity(i2);
                return true;
            } catch (Exception e2) {
                return false;
            }
        }
    }

    String removeFile(String path) {
        JSONObject o = new JSONObject();
        try {
            File f = new File(path);
            if (!isInsideAllowedRoot(f)) {
                o.put("ok", false);
                o.put("reason", "路径不在曲库目录内");
                return o.toString();
            }
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
                File lrc = new File(base + ".lrc");
                if (lrc.exists() && isInsideAllowedRoot(lrc)) lrc.delete();
                try {
                    act.getContentResolver().delete(
                            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                            MediaStore.MediaColumns.DATA + "=?",
                            new String[]{path});
                } catch (Throwable t) {
                    Diag.write("bridge", "MediaStore 删除失败（文件已删，索引可能残留）: " + t);
                }
                MediaScannerConnection.scanFile(act, new String[]{path}, null, null);
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

    int bitrate(String path) {
        if (path == null || !isInsideAllowedRoot(new File(path))) return 0;
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            mmr.setDataSource(path);
            String v = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE);
            return v == null ? 0 : Math.round(Integer.parseInt(v) / 1000f);
        } catch (Exception e) {
            return 0;
        } finally {
            try { mmr.release(); } catch (Exception ignored) { }
        }
    }

    String rootDir() {
        return AudioStore.rootDir().getAbsolutePath();
    }

    String setRootDir(String pathOrSub) {
        try {
            if (AudioStore.setCustomRootDir(pathOrSub)) {
                sp.edit().putString("custom_root_dir", pathOrSub == null ? "" : pathOrSub.trim()).apply();
            }
        } catch (Exception ignored) { }
        return AudioStore.rootDir().getAbsolutePath();
    }

    boolean mkdir(String name) {
        try {
            File d = new File(AudioStore.rootDir(), name.replaceAll("[\\\\/:*?\"<>|]", "_"));
            return d.exists() || d.mkdirs();
        } catch (Exception e) {
            return false;
        }
    }
}
