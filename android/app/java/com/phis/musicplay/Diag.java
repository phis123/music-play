package com.phis.musicplay;

import android.app.Activity;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.webkit.WebView;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * 现场诊断：把「偶发问题 / 机型适配问题」需要的信息集中落到应用外部私有目录，
 * 用户（或维护者）可以一键导出 zip，无需 logcat、无需 root、无需他人真机复现。
 *
 * 目录：Android/data/&lt;pkg&gt;/files/diag/
 *   session.log      当前会话日志（滚动，超 1MB 转 session.1.log，最多保留 2 份）
 *   crash-*.txt      未捕获异常
 *   export-*.zip     一键导出包（含日志 + 快照 + 曲库摘要）
 */
public final class Diag {

    private static final String DIR = "diag";
    private static final long MAX_LOG = 1024 * 1024;
    private static final int KEEP_LOGS = 2;
    private static final Object LOCK = new Object();
    private static final SimpleDateFormat TS = new SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US);
    private static volatile boolean installed = false;
    private static volatile String lastExport = "";

    private Diag() { }

    static {
        TS.setTimeZone(TimeZone.getDefault());
    }

    public static File dir(Context ctx) {
        File d = new File(ctx.getExternalFilesDir(null), DIR);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    public static String lastExportPath() { return lastExport; }

    /** 安装全局未捕获异常处理器：崩溃也能留下现场 */
    public static void install(final Context ctx) {
        if (installed) return;
        installed = true;
        final Thread.UncaughtExceptionHandler prev = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override public void uncaughtException(Thread t, Throwable e) {
                try {
                    StringBuilder sb = new StringBuilder();
                    sb.append("thread=").append(t == null ? "?" : t.getName()).append('\n');
                    sb.append("exception=").append(e == null ? "?" : e.toString()).append('\n');
                    if (e != null) {
                        java.io.StringWriter sw = new java.io.StringWriter();
                        e.printStackTrace(new java.io.PrintWriter(sw));
                        sb.append(sw.toString());
                    }
                    File f = new File(dir(ctx), "crash-" + stamp() + ".txt");
                    writeFile(f, sb.toString());
                    write("crash", "未捕获异常：" + (e == null ? "?" : e.toString()));
                } catch (Throwable ignored) {
                }
                if (prev != null) prev.uncaughtException(t, e);
            }
        });
        write("app", "启动 diag 已安装，版本 " + buildTag(ctx));
    }

    private static String stamp() {
        return new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date());
    }

    private static String now() {
        return TS.format(new Date());
    }

    private static String buildTag(Context ctx) {
        try {
            android.content.pm.PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return pi.versionName + "(" + pi.versionCode + ")";
        } catch (Throwable t) {
            return "?";
        }
    }

    /** 追加一行日志；同时打 logcat，方便 adb 直接看 */
    public static void write(String tag, String msg) {
        String line = now() + " [" + Thread.currentThread().getName() + "] " + tag + ": " + msg + "\n";
        android.util.Log.i("MusicPlay", tag + ": " + msg);
        synchronized (LOCK) {
            try {
                Context ctx = appCtx;
                if (ctx == null) return;
                File f = new File(dir(ctx), "session.log");
                if (f.length() > MAX_LOG) rotate(ctx);
                FileOutputStream out = new FileOutputStream(f, true);
                out.write(line.getBytes("UTF-8"));
                out.close();
            } catch (Throwable ignored) {
            }
        }
    }

    private static volatile Context appCtx = null;

    public static void attach(Context ctx) {
        try { appCtx = ctx.getApplicationContext(); } catch (Throwable ignored) { }
    }

    /** 把后台产生的日志写入 session.log（Settings 以外的调用点必须保证 attach 过） */
    public static void writeApp(Context ctx, String tag, String msg) {
        if (appCtx == null && ctx != null) attach(ctx);
        write(tag, msg);
    }

    private static void rotate(Context ctx) {
        synchronized (LOCK) {
            try {
                File d = dir(ctx);
                File cur = new File(d, "session.log");
                for (int i = KEEP_LOGS - 1; i >= 1; i--) {
                    File from = new File(d, "session" + i + ".log");
                    if (from.exists()) {
                        File to = new File(d, "session" + (i + 1) + ".log");
                        if (to.exists()) to.delete();
                        from.renameTo(to);
                    }
                }
                File first = new File(d, "session1.log");
                cur.renameTo(first);
            } catch (Throwable ignored) {
            }
        }
    }

    private static void writeFile(File f, String text) throws IOException {
        FileOutputStream out = new FileOutputStream(f, false);
        out.write(text.getBytes("UTF-8"));
        out.close();
    }

    // ---------------- 快照 ----------------

    /** 生成环境快照：机型、屏幕、WebView、权限、存储、内存、播放状态、曲库摘要 */
    public static String snapshot(Context ctx) {
        StringBuilder b = new StringBuilder();
        b.append("== music-play 诊断快照 ==\n");
        b.append("时间: ").append(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date())).append('\n');
        b.append("版本: ").append(buildTag(ctx)).append('\n');
        b.append("buildTag: ").append(safeBuildTag()).append('\n');
        b.append("包名: ").append(ctx.getPackageName()).append('\n');
        b.append('\n');

        b.append("-- 设备 --\n");
        b.append("厂商/机型: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append('\n');
        b.append("设备代号: ").append(Build.DEVICE).append(" / ").append(Build.PRODUCT).append('\n');
        b.append("系统: Android ").append(Build.VERSION.RELEASE).append(" (SDK ").append(Build.VERSION.SDK_INT).append(")\n");
        b.append("系统指纹: ").append(Build.FINGERPRINT).append('\n');
        b.append("ABI: ").append(joinArray(Build.SUPPORTED_ABIS)).append('\n');
        b.append("Root/Magisk: ").append(rootHint()).append('\n');
        b.append('\n');

        b.append("-- 屏幕 --\n");
        try {
            android.util.DisplayMetrics dm = ctx.getResources().getDisplayMetrics();
            b.append("dp: ").append(dm.widthPixels).append('x').append(dm.heightPixels)
                    .append(" @ density ").append(dm.density).append(" (").append(dm.densityDpi).append(" dpi)\n");
            b.append("scaledDensity: ").append(dm.scaledDensity).append(" xdpi ").append(dm.xdpi).append(" ydpi ").append(dm.ydpi).append('\n');
            b.append("smallestWidthDp: ").append(ctx.getResources().getConfiguration().smallestScreenWidthDp).append('\n');
            b.append("方向: ").append(ctx.getResources().getConfiguration().orientation).append('\n');
        } catch (Throwable t) {
            b.append("读取失败: ").append(t).append('\n');
        }
        b.append('\n');

        b.append("-- WebView --\n");
        try {
            String pkg = WebView.getCurrentWebViewPackage() == null ? "?" : WebView.getCurrentWebViewPackage().packageName;
            String ver = WebView.getCurrentWebViewPackage() == null ? "?" : WebView.getCurrentWebViewPackage().versionName;
            b.append("实现: ").append(pkg).append(' ').append(ver).append('\n');
        } catch (Throwable t) {
            b.append("读取失败: ").append(t).append('\n');
        }
        try {
            b.append("UA: ").append(android.webkit.WebSettings.getDefaultUserAgent(ctx)).append('\n');
        } catch (Throwable ignored) {
        }
        b.append('\n');

        b.append("-- 权限 --\n");
        for (String p : new String[]{
                android.Manifest.permission.READ_MEDIA_AUDIO,
                android.Manifest.permission.READ_EXTERNAL_STORAGE,
                android.Manifest.permission.MANAGE_EXTERNAL_STORAGE,
                android.Manifest.permission.POST_NOTIFICATIONS,
                android.Manifest.permission.SYSTEM_ALERT_WINDOW,
        }) {
            b.append("  ").append(p).append(": ").append(check(ctx, p)).append('\n');
        }
        b.append('\n');

        b.append("-- 存储 --\n");
        try {
            File data = Environment.getDataDirectory();
            StatFs ds = new StatFs(data.getAbsolutePath());
            b.append("内部可用: ").append(gb(ds.getAvailableBytes())).append(" / 总 ").append(gb(ds.getTotalBytes())).append('\n');
            File root = AudioStore.rootDir();
            StatFs rs = new StatFs(root.getAbsolutePath());
            b.append("曲库目录: ").append(root.getAbsolutePath()).append('\n');
            b.append("曲库分区可用: ").append(gb(rs.getAvailableBytes())).append('\n');
        } catch (Throwable t) {
            b.append("读取失败: ").append(t).append('\n');
        }
        b.append('\n');

        b.append("-- 内存 --\n");
        try {
            Runtime rt = Runtime.getRuntime();
            b.append("java heap max=").append(mb(rt.maxMemory())).append(" used=").append(mb(rt.totalMemory() - rt.freeMemory())).append('\n');
            b.append("memoryClass=").append(((android.app.ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryClass()).append("MB\n");
        } catch (Throwable ignored) {
        }
        b.append('\n');

        b.append("-- 播放/曲库状态 --\n");
        b.append(PlaybackService.diagState()).append('\n');
        b.append(LyricsOverlay.get(ctx).diagState()).append('\n');
        b.append("曲库曲目数: ").append(AudioStore.lastCount()).append('\n');
        b.append("媒体库可用: ").append(AudioStore.mediaStoreOk()).append('\n');
        b.append('\n');

        b.append("-- 电量/运行环境 --\n");
        try {
            android.os.BatteryManager bm = (android.os.BatteryManager) ctx.getSystemService(Context.BATTERY_SERVICE);
            int pct = bm == null ? -1 : bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY);
            b.append("电量: ").append(pct).append("%").append('\n');
        } catch (Throwable ignored) { }
        try {
            android.os.PowerManager pm2 = (android.os.PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            b.append("省电模式: ").append(pm2 != null && pm2.isPowerSaveMode()).append('\n');
            android.app.ActivityManager am2 = (android.app.ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            b.append("lowRam: ").append(am2 != null && am2.isLowRamDevice()).append('\n');
        } catch (Throwable ignored) { }
        try {
            b.append("state.json 存在: ").append(new File(dir(ctx), "state.json").exists()).append('\n');
            b.append("上次导出: ").append(lastExport.isEmpty() ? "-" : lastExport).append('\n');
        } catch (Throwable ignored) { }
        b.append('\n');

        b.append("-- 线程 --\n");
        try {
            java.util.Map<Thread, StackTraceElement[]> all = Thread.getAllStackTraces();
            b.append("线程数: ").append(all.size()).append('\n');
            for (Thread t : all.keySet()) {
                b.append("  ").append(t.getName()).append(" state=").append(t.getState()).append('\n');
            }
        } catch (Throwable ignored) {
        }
        return b.toString();
    }

    private static String safeBuildTag() {
        try {
            return PlaybackService.buildTagText == null ? "?" : PlaybackService.buildTagText;
        } catch (Throwable t) {
            return "?";
        }
    }

    private static String rootHint() {
        try {
            boolean bin = new File("/system/bin/su").exists() || new File("/system/xbin/su").exists();
            boolean magisk = new File("/sbin/.magisk").exists() || new File("/data/adb/magisk").exists();
            return "su=" + bin + " magisk=" + magisk + "（app 视角，Magisk 可能对应用隐藏）";
        } catch (Throwable t) {
            return "?";
        }
    }

    private static String check(Context ctx, String perm) {
        try {
            if (android.Manifest.permission.MANAGE_EXTERNAL_STORAGE.equals(perm)
                    && Build.VERSION.SDK_INT >= 30) {
                return String.valueOf(Environment.isExternalStorageManager());
            }
            if (Build.VERSION.SDK_INT < 23) return "granted(旧系统)";
            return ctx.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED ? "granted" : "denied";
        } catch (Throwable t) {
            return "err";
        }
    }

    private static String joinArray(String[] a) {
        if (a == null) return "?";
        StringBuilder s = new StringBuilder();
        for (String x : a) {
            if (s.length() > 0) s.append(',');
            s.append(x);
        }
        return s.toString();
    }

    private static String gb(long bytes) { return String.format(Locale.US, "%.1fGB", bytes / 1073741824.0); }
    private static String mb(long bytes) { return String.format(Locale.US, "%.1fMB", bytes / 1048576.0); }

    // ---------------- 导出 ----------------

    /**
     * 打包导出：diag 目录下的日志与崩溃记录 + 环境快照 + 曲库摘要 + 前端状态（JS 侧写入的 state.json）。
     * 返回 zip 绝对路径（失败返回空串）。
     */
    public static String export(Context ctx) {
        File d = dir(ctx);
        String name = "export-" + stamp() + ".zip";
        File zip = new File(d, name);
        ZipOutputStream zos = null;
        try {
            // 先跑一次曲库统计，再生成快照（否则快照里的曲目数是上一轮旧值）
            autoSummary(ctx, d);
            writeFile(new File(d, "snapshot.txt"), snapshot(ctx));
            writeLogcat(d);
            zos = new ZipOutputStream(new FileOutputStream(zip));
            File[] files = d.listFiles();
            if (files != null) {
                for (File f : files) {
                    if (!f.isFile() || f.getName().equals(name)) continue;
                    if (f.getName().startsWith("export-")) continue;
                    addToZip(zos, f, f.getName());
                }
            }
            zos.close();
            zos = null;
            lastExport = zip.getAbsolutePath();
            write("export", "已生成 " + lastExport + " (" + zip.length() / 1024 + "KB)");
            return lastExport;
        } catch (Throwable t) {
            write("export", "导出失败: " + t);
            return "";
        } finally {
            if (zos != null) try { zos.close(); } catch (Throwable ignored) { }
        }
    }

    /** 附带生成曲库摘要与说明文件（不含音频内容，只有路径/大小/标签有无等元信息） */
    private static void autoSummary(Context ctx, File d) {
        try {
            writeFile(new File(d, "README.txt"),
                    "music-play 诊断导出包\n"
                            + "生成时间: " + new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date()) + "\n"
                            + "内容说明:\n"
                            + "  session.log / sessionN.log  应用运行日志（含播放、扫描、错误、崩溃前记录）\n"
                            + "  crash-*.txt                 未捕获异常堆栈\n"
                            + "  snapshot.txt                设备/屏幕/WebView/权限/存储/内存/播放状态快照\n"
                            + "  library.json                曲库摘要（仅文件名、大小、标签有无；不含音频）\n"
                            + "  state.json                  前端状态（localStorage 关键键、播放队列长度、设置项）\n"
                            + "\n私密性: 仅包含本应用产生的技术信息；library.json 含歌曲文件名。分享前请自行确认。\n");
            writeFile(new File(d, "library.json"), AudioStore.diagJson(ctx));
        } catch (Throwable ignored) {
        }
    }

    /** 抓自己进程的 logcat 尾部（本 App 的日志无需 root） */
    private static void writeLogcat(File d) {
        Process p = null;
        try {
            String pid = String.valueOf(android.os.Process.myPid());
            p = new ProcessBuilder("logcat", "-d", "-v", "time", "-t", "800", "--pid", pid)
                    .redirectErrorStream(true).start();
            StringBuilder sb = new StringBuilder();
            java.io.BufferedReader r = new java.io.BufferedReader(new java.io.InputStreamReader(p.getInputStream()));
            String line;
            int cnt = 0;
            while ((line = r.readLine()) != null && cnt < 2000) {
                sb.append(line).append('\n');
                cnt++;
            }
            r.close();
            if (sb.length() > 0) writeFile(new File(d, "logcat.txt"), sb.toString());
        } catch (Throwable t) {
            try { writeFile(new File(d, "logcat.txt"), "读取 logcat 失败: " + t + '\n'); } catch (Throwable ignored) { }
        } finally {
            if (p != null) try { p.destroy(); } catch (Throwable ignored) { }
        }
    }

    private static void addToZip(ZipOutputStream zos, File f, String entryName) throws IOException {
        if (entryName == null) entryName = "README.extra.txt";
        if (!f.isFile()) return;
        FileInputStream in = new FileInputStream(f);
        try {
            zos.putNextEntry(new ZipEntry(entryName));
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) zos.write(buf, 0, n);
            zos.closeEntry();
        } finally {
            in.close();
        }
    }

    public static void clear(Context ctx) {
        File d = dir(ctx);
        File[] files = d.listFiles();
        if (files == null) return;
        for (File f : files) {
            if (f.isFile() && !f.getName().startsWith("export-")) f.delete();
        }
        write("export", "已清空本地诊断日志（保留已导出的 zip）");
    }

    /** 供 JS 写入任意结构化状态（如 localStorage 摘要、最近错误） */
    public static void writeState(Context ctx, String json) {
        try {
            writeFile(new File(dir(ctx), "state.json"),
                    "== 前端状态 " + new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date()) + " ==\n" + json);
        } catch (Throwable ignored) {
        }
    }

    /** 无 UI 触发入口（adb broadcast 用），保证不会拉起任何界面 */
    public static String exportSilently(Context ctx) {
        return export(ctx);
    }

    public static void writeLifecycle(Context ctx, String what) {
        write("lifecycle", what);
    }

    /** 供 Activity 在 onDestroy 时调用，避免持有引用 */
    public static void detach() { /* 保留接口 */ }

    public static void installWithActivity(Activity a) {
        attach(a);
        install(a);
    }
}