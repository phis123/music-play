package com.phis.musicplay;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.media.MediaScannerConnection;
import android.provider.MediaStore;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 本地曲库：MediaStore 优先，磁盘兜底（保证「下完就能看到」）。
 *
 * 关键点：磁盘兜底与 MediaStore 返回 empty/&lt;unknown&gt; 时，都会用 MediaMetadataRetriever
 * 直接读文件内嵌标签（标题/歌手/专辑/时长），避免整库变成「未知艺人」。
 * 标签读取结果按 path|size|mtime 缓存在 files/tag-cache.json，扫描不重复解标签。
 */
public class AudioStore {

    private static final String[] EXT = {
            ".mp3", ".flac", ".m4a", ".wav", ".ogg", ".aac", ".opus", ".wma", ".ape"
    };

    private static String customRootPath = null;

    /** 上一次 listJson 时 MediaStore 是否可用（权限缺失/异常时为 false，前端据此提示） */
    private static boolean lastMediaStoreOk = true;

    /** 标签缓存：key = path|size|mtime，value = {t,a,al,d} */
    private static JSONObject tagCache = null;
    private static boolean tagCacheDirty = false;
    private static int tagCacheHit = 0;
    private static int tagCacheMiss = 0;

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

    public static boolean mediaStoreOk() { return lastMediaStoreOk; }

    private static volatile int lastTrackCount = -1;
    public static int lastCount() { return lastTrackCount; }

    /** 曲库摘要（仅元信息，不含音频内容），供诊断导出包使用 */
    public static String diagJson(Context ctx) {
        try {
            String raw = listJson(ctx);
            JSONArray arr = new JSONArray(raw);
            JSONArray out = new JSONArray();
            int noArtist = 0, noLrc = 0, noDur = 0;
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) continue;
                JSONObject r = new JSONObject();
                String path = o.optString("path", "");
                r.put("name", path.substring(path.lastIndexOf('/') + 1));
                r.put("size", o.optLong("size", 0));
                r.put("dur", o.optDouble("duration", 0));
                r.put("hasArtist", !o.optString("artist", "").isEmpty());
                r.put("hasLrc", o.optBoolean("hasLrc", false));
                out.put(r);
                if (o.optString("artist", "").isEmpty()) noArtist++;
                if (!o.optBoolean("hasLrc", false)) noLrc++;
                if (o.optDouble("duration", 0) <= 0) noDur++;
            }
            JSONObject head = new JSONObject();
            head.put("根目录", rootDir().getAbsolutePath());
            head.put("曲目数", arr.length());
            head.put("媒体库可用", lastMediaStoreOk);
            head.put("缺歌手", noArtist);
            head.put("缺歌词", noLrc);
            head.put("缺时长", noDur);
            return new JSONObject().put("summary", head).put("tracks", out).toString(2);
        } catch (Throwable t) {
            return "{\"error\":\"" + t + "\"}";
        }
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

    // ---------------- 标签缓存 ----------------

    private static File cacheFile(Context ctx) {
        return new File(ctx.getFilesDir(), "tag-cache.json");
    }

    private static synchronized void loadTagCache(Context ctx) {
        if (tagCache != null) return;
        tagCache = new JSONObject();
        try {
            File f = cacheFile(ctx);
            if (!f.exists()) return;
            StringBuilder sb = new StringBuilder();
            BufferedReader r = new BufferedReader(new InputStreamReader(new FileInputStream(f), "UTF-8"));
            String line;
            while ((line = r.readLine()) != null) sb.append(line);
            r.close();
            JSONObject o = new JSONObject(sb.toString());
            tagCache = o;
        } catch (Exception ignored) {
            tagCache = new JSONObject();
        }
    }

    private static synchronized void saveTagCache(Context ctx) {
        if (tagCache == null || !tagCacheDirty) return;
        try {
            FileOutputStream fos = new FileOutputStream(cacheFile(ctx));
            fos.write(tagCache.toString().getBytes("UTF-8"));
            fos.close();
            tagCacheDirty = false;
        } catch (Exception ignored) {
        }
    }

    private static String cacheKey(File f) {
        return f.getAbsolutePath() + "|" + f.length() + "|" + f.lastModified();
    }

    /** 读文件内嵌标签：{title, artist, album, duration}；失败返回 null */
    private static JSONObject tagsOf(Context ctx, File f) {
        loadTagCache(ctx);
        String key = cacheKey(f);
        try {
            if (tagCache.has(key)) {
                tagCacheHit++;
                return tagCache.getJSONObject(key);
            }
        } catch (Exception ignored) {
        }
        tagCacheMiss++;
        MediaMetadataRetriever r = new MediaMetadataRetriever();
        JSONObject o = null;
        try {
            r.setDataSource(f.getAbsolutePath());
            String title = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
            String artist = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
            String album = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
            String dur = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
            o = new JSONObject();
            o.put("t", nz(title, ""));
            o.put("a", nz(artist, ""));
            o.put("al", nz(album, ""));
            o.put("d", dur == null ? 0 : Long.parseLong(dur));
        } catch (Exception ignored) {
            o = null;
        } finally {
            try { r.release(); } catch (Exception ignored) { }
        }
        try {
            tagCache.put(key, o == null ? new JSONObject() : o);
            tagCacheDirty = true;
        } catch (Exception ignored) {
        }
        return o;
    }

    public static String listJson(Context ctx) {
        JSONArray arr = new JSONArray();
        Map<String, JSONObject> map = new LinkedHashMap<String, JSONObject>();
        String pubMusic = android.os.Environment.getExternalStoragePublicDirectory(
                android.os.Environment.DIRECTORY_MUSIC).getAbsolutePath();
        String[] roots = new String[]{rootDir().getAbsolutePath(), pubMusic, privateDir(ctx).getAbsolutePath()};

        lastMediaStoreOk = true;
        int msCount = 0;
        for (String root : roots) msCount += collectFromMediaStore(ctx, root, map, ctx);
        if (msCount == 0) lastMediaStoreOk = false;

        // ② 磁盘兜底：刚下载还没被索引、或索引失败的文件也列出来
        for (String root : roots) {
            try {
                List<File> files = new ArrayList<File>();
                collect(new File(root), files, 0);
                for (File f : files) {
                    String path = f.getAbsolutePath();
                    if (map.containsKey(path)) continue;
                    map.put(path, buildFromFile(ctx, f));
                }
            } catch (Exception ignored) {
            }
        }

        // ③ 补救：MediaStore 已收录但标签是 <unknown>/空 的，用文件内嵌标签补齐
        for (Map.Entry<String, JSONObject> e : map.entrySet()) {
            JSONObject o = e.getValue();
            if (o == null) continue;
            String artist = o.optString("artist", "");
            String title = o.optString("title", "");
            if (!artist.isEmpty() && !title.isEmpty()) continue;
            File f = new File(e.getKey());
            if (!f.exists()) continue;
            JSONObject tags = tagsOf(ctx, f);
            if (tags == null) continue;
            try {
                if (artist.isEmpty()) {
                    String a = tags.optString("a", "");
                    if (!a.isEmpty()) o.put("artist", a);
                }
                if (title.isEmpty()) {
                    String t = tags.optString("t", "");
                    if (!t.isEmpty()) o.put("title", t);
                }
                if (o.optString("album", "").isEmpty()) {
                    String al = tags.optString("al", "");
                    if (!al.isEmpty()) o.put("album", al);
                }
                if (o.optDouble("duration", 0) <= 0) {
                    long d = tags.optLong("d", 0);
                    if (d > 0) o.put("duration", d / 1000.0);
                }
            } catch (Exception ignored) {
            }
        }

        saveTagCache(ctx);

        lastTrackCount = map.size();
        for (JSONObject o : map.values()) arr.put(o);
        return arr.toString();
    }

    /** 用磁盘文件 + 内嵌标签构造一条曲目 */
    private static JSONObject buildFromFile(Context ctx, File f) {
        String path = f.getAbsolutePath();
        JSONObject o = new JSONObject();
        try {
            JSONObject tags = tagsOf(ctx, f);
            String title = tags == null ? "" : tags.optString("t", "");
            String artist = tags == null ? "" : tags.optString("a", "");
            String album = tags == null ? "" : tags.optString("al", "");
            long durMs = tags == null ? 0 : tags.optLong("d", 0);
            o.put("id", Math.abs(path.hashCode()));
            o.put("title", title.isEmpty() ? baseName(path) : title);
            o.put("artist", artist);
            o.put("album", album.isEmpty() ? (f.getParentFile() != null ? f.getParentFile().getName() : "") : album);
            o.put("duration", durMs > 0 ? durMs / 1000.0 : durationOf(path));
            o.put("path", path);
            o.put("size", f.length());
            o.put("hasLrc", hasLrc(path));
        } catch (Exception e) {
            try {
                o.put("id", Math.abs(path.hashCode()));
                o.put("title", baseName(path));
                o.put("artist", "");
                o.put("album", "");
                o.put("duration", 0);
                o.put("path", path);
                o.put("size", f.length());
                o.put("hasLrc", hasLrc(path));
            } catch (Exception ignored) { }
        }
        return o;
    }

    /** MediaStore：有完整元数据（标题/作者/时长）；返回本次收录条数 */
    private static int collectFromMediaStore(Context ctx, String root, Map<String, JSONObject> map, Context c2) {
        ContentResolver cr = ctx.getContentResolver();
        int added = 0;
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
                    added++;
                }
            }
        } catch (Exception ignored) {
            // MediaStore 不可用（权限/异常）时继续走磁盘兜底
        } finally {
            if (c != null) c.close();
        }
        return added;
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

    /** 清空标签缓存，下一次扫描强制重新读 ID3 */
    public static void clearTagCache(Context ctx) {
        try {
            File f = cacheFile(ctx);
            if (f.exists()) f.delete();
        } catch (Exception ignored) {
        }
        tagCache = new JSONObject();
        tagCacheDirty = false;
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
