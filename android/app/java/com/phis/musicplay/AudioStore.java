package com.phis.musicplay;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.media.MediaScannerConnection;
import android.provider.MediaStore;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 本地曲库：MediaStore 优先，磁盘兜底（保证「下完就能看到」） */
public class AudioStore {

    private static final String[] EXT = {
            ".mp3", ".flac", ".m4a", ".wav", ".ogg", ".aac", ".opus", ".wma", ".ape"
    };

    private static String customRootPath = null;

    /** 默认曲库根目录：/sdcard/Music/music-play（支持用户在设置中切换子目录或自定义路径） */
    public static File rootDir() {
        if (customRootPath != null && !customRootPath.trim().isEmpty()) {
            File custom = new File(customRootPath.trim());
            if (!custom.exists()) custom.mkdirs();
            if (custom.exists() && custom.isDirectory()) return custom;
        }
        File base = android.os.Environment.getExternalStoragePublicDirectory(
                android.os.Environment.DIRECTORY_MUSIC);
        File d = new File(base, "music-play");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    public static boolean setCustomRootDir(String pathOrSub) {
        if (pathOrSub == null || pathOrSub.trim().isEmpty()) {
            customRootPath = null;
            return true;
        }
        String s = pathOrSub.trim();
        File base = android.os.Environment.getExternalStoragePublicDirectory(
                android.os.Environment.DIRECTORY_MUSIC);
        File target = s.startsWith("/") ? new File(s) : new File(base, s);
        if (!target.exists()) target.mkdirs();
        if (target.exists() && target.isDirectory()) {
            customRootPath = target.getAbsolutePath();
            return true;
        }
        return false;
    }

    private static boolean isAudio(String name) {
        if (name == null) return false;
        String low = name.toLowerCase();
        for (String e : EXT) if (low.endsWith(e)) return true;
        return false;
    }

    /** App 私有外部目录：不需要任何权限，一定能写能读（Android 11+ 公共目录写不进时的兜底） */
    public static File privateDir(Context ctx) {
        File d = new File(ctx.getExternalFilesDir(null), "music");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    /** 挑一个真的写得进去的目录：公共 Music/music-play 优先，不行就私有目录 */
    public static File pickWritableDir(Context ctx) {
        File pub = rootDir();
        try {
            File probe = new File(pub, ".wtest");
            java.io.FileOutputStream fos = new java.io.FileOutputStream(probe);
            fos.write(1);
            fos.close();
            probe.delete();
            return pub;
        } catch (Exception e) {
            return privateDir(ctx);
        }
    }

    /** 直接扫盘（深度 2 层），不依赖 MediaStore */
    private static void collect(File d, List<File> out, int depth) {
        if (d == null || depth > 2) return;
        File[] fs = d.listFiles();
        if (fs == null) return;
        for (File f : fs) {
            if (f.isDirectory()) collect(f, out, depth + 1);
            else if (isAudio(f.getName()) && f.length() > 0) out.add(f);
        }
    }

    public static String listJson(Context ctx) {
        JSONArray arr = new JSONArray();
        Map<String, JSONObject> map = new LinkedHashMap<String, JSONObject>();
        String pubMusic = android.os.Environment.getExternalStoragePublicDirectory(
                android.os.Environment.DIRECTORY_MUSIC).getAbsolutePath();
        String[] roots = new String[]{rootDir().getAbsolutePath(), pubMusic, privateDir(ctx).getAbsolutePath()};

        for (String root : roots) collectFromMediaStore(ctx, root, map);

        // ② 磁盘兜底：刚下载还没被索引、或索引失败的文件也列出来
        for (String root : roots) {
            try {
                List<File> files = new ArrayList<File>();
                collect(new File(root), files, 0);
                for (File f : files) {
                    String path = f.getAbsolutePath();
                    if (map.containsKey(path)) continue;
                    JSONObject o = new JSONObject();
                    o.put("id", Math.abs(path.hashCode()));
                    o.put("title", baseName(path));
                    o.put("artist", "");
                    o.put("album", f.getParentFile() != null ? f.getParentFile().getName() : "");
                    o.put("duration", durationOf(path));
                    o.put("path", path);
                    o.put("size", f.length());
                    o.put("hasLrc", hasLrc(path));
                    map.put(path, o);
                }
            } catch (Exception ignored) {
            }
        }

        for (JSONObject o : map.values()) arr.put(o);
        return arr.toString();
    }

    /** MediaStore：有完整元数据（标题/作者/时长） */
    private static void collectFromMediaStore(Context ctx, String root, Map<String, JSONObject> map) {
        ContentResolver cr = ctx.getContentResolver();
        String[] proj = {
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.DATA,
                MediaStore.Audio.Media.SIZE,
        };
        Cursor c = null;
        try {
            // 不再用 IS_MUSIC 过滤：部分新下载文件被标成 0 就整条消失
            c = cr.query(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, proj,
                    MediaStore.Audio.Media.DATA + " LIKE ?",
                    new String[]{root + "/%"}, null);
            if (c != null) {
                int iId = c.getColumnIndex(MediaStore.Audio.Media._ID);
                int iTitle = c.getColumnIndex(MediaStore.Audio.Media.TITLE);
                int iArtist = c.getColumnIndex(MediaStore.Audio.Media.ARTIST);
                int iAlbum = c.getColumnIndex(MediaStore.Audio.Media.ALBUM);
                int iDur = c.getColumnIndex(MediaStore.Audio.Media.DURATION);
                int iData = c.getColumnIndex(MediaStore.Audio.Media.DATA);
                int iSize = c.getColumnIndex(MediaStore.Audio.Media.SIZE);
                while (c.moveToNext()) {
                    String path = c.getString(iData);
                    if (path == null || path.isEmpty() || !isAudio(path)) continue;
                    if (map.containsKey(path)) continue;
                    long durMs = c.getLong(iDur);
                    if (durMs > 0 && durMs < 15000) continue;   // 只在时长已知时跳过铃声
                    JSONObject o = new JSONObject();
                    o.put("id", c.getLong(iId));
                    o.put("title", nz(c.getString(iTitle), baseName(path)));
                    o.put("artist", nz(c.getString(iArtist), ""));
                    o.put("album", nz(c.getString(iAlbum), ""));
                    o.put("duration", durMs / 1000.0);
                    o.put("path", path);
                    o.put("size", c.getLong(iSize));
                    o.put("hasLrc", hasLrc(path));
                    map.put(path, o);
                }
            }
        } catch (Exception ignored) {
            // MediaStore 不可用（权限/异常）时继续走磁盘兜底
        } finally {
            if (c != null) c.close();
        }
    }

    /** 让系统重新扫一遍曲库目录（下载完成后调用） */
    public static int rescan(Context ctx) {
        try {
            List<File> files = new ArrayList<File>();
            collect(rootDir(), files, 0);
            if (files.isEmpty()) return 0;
            String[] paths = new String[files.size()];
            for (int i = 0; i < files.size(); i++) paths[i] = files.get(i).getAbsolutePath();
            MediaScannerConnection.scanFile(ctx, paths, null, null);
            return paths.length;
        } catch (Exception e) {
            return 0;
        }
    }

    private static double durationOf(String path) {
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        try {
            r.setDataSource(path);
            String ms = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            if (ms != null) return Long.parseLong(ms) / 1000.0;
        } catch (Exception ignored) {
        } finally {
            try { r.release(); } catch (Exception ignored) { }
        }
        return 0;
    }

    private static String baseName(String path) {
        try {
            String name = path.substring(path.lastIndexOf('/') + 1);
            return name.replaceAll("\\.[^.]+$", "");
        } catch (Exception e) {
            return path;
        }
    }

    private static boolean hasLrc(String path) {
        try {
            String base = path.substring(0, path.lastIndexOf('.'));
            return new File(base + ".lrc").exists();
        } catch (Exception e) {
            return false;
        }
    }

    private static String nz(String s, String fallback) {
        if (s == null || s.isEmpty() || "<unknown>".equals(s)) return fallback;
        return s;
    }
}
