package com.phis.musicplay;

import android.app.Activity;
import android.media.MediaScannerConnection;
import android.os.Environment;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Android 端 HTTP 请求与音频下载（与桌面端 netapi.js 对齐 200MB 上限与半截文件清理）。
 * 由 Bridge 门面委托调用。
 */
final class BridgeNet {

    /** 单文件下载上限 200MB（对齐桌面端 netapi.js::MAX_DOWNLOAD_BYTES） */
    static final long MAX_DOWNLOAD_BYTES = 200L * 1024 * 1024;
    /** 文本接口响应上限 16MB，防内存打爆 */
    static final int MAX_HTTP_TEXT_BYTES = 16 * 1024 * 1024;

    interface JsEval {
        void eval(String code);
    }

    private final Activity act;
    private final JsEval js;

    BridgeNet(Activity act, JsEval js) {
        this.act = act;
        this.js = js;
    }

    private static String readAll(InputStream is) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        int total = 0;
        while ((n = is.read(buf)) > 0) {
            total += n;
            if (total > MAX_HTTP_TEXT_BYTES) {
                throw new IOException("响应体超过 16MB 上限");
            }
            bos.write(buf, 0, n);
        }
        return new String(bos.toByteArray(), "UTF-8");
    }

    private HttpURLConnection openConn(String url, String method) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36");
        c.setRequestProperty("Referer", "https://music.163.com");
        c.setRequestProperty("Accept", "*/*");
        c.setInstanceFollowRedirects(true);
        return c;
    }

    String httpPost(String url, String body) {
        HttpURLConnection c = null;
        try {
            c = openConn(url, "POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
            byte[] data = body.getBytes("UTF-8");
            c.setFixedLengthStreamingMode(data.length);
            c.getOutputStream().write(data);
            int code = c.getResponseCode();
            InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
            return is == null ? "" : readAll(is);
        } catch (Exception e) {
            return "{\"code\":-1,\"message\":\"" + String.valueOf(e.getMessage()).replace("\"", " ") + "\"}";
        } finally {
            if (c != null) try { c.disconnect(); } catch (Exception ignored) { }
        }
    }

    String httpGet(String url) {
        HttpURLConnection c = null;
        try {
            c = openConn(url, "GET");
            int code = c.getResponseCode();
            InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
            return is == null ? "" : readAll(is);
        } catch (Exception e) {
            return "{\"code\":-1}";
        } finally {
            if (c != null) try { c.disconnect(); } catch (Exception ignored) { }
        }
    }

    String download(String url, String fileName, String lrcText) {
        File out = null;
        HttpURLConnection c = null;
        try {
            File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC);
            if (!dir.exists()) dir.mkdirs();
            String safe = sanitizeFileName(fileName, true);
            out = new File(dir, safe);
            c = openConn(url, "GET");
            long total = c.getContentLengthLong();
            if (total > MAX_DOWNLOAD_BYTES) {
                throw new IOException("文件超过 200MB 上限");
            }
            InputStream is = c.getInputStream();
            FileOutputStream fos = new FileOutputStream(out);
            long got = 0;
            try {
                byte[] buf = new byte[65536];
                int n;
                while ((n = is.read(buf)) > 0) {
                    got += n;
                    if (got > MAX_DOWNLOAD_BYTES) {
                        throw new IOException("下载内容超过 200MB 上限");
                    }
                    fos.write(buf, 0, n);
                }
                fos.flush();
            } finally {
                try { fos.close(); } catch (Exception ignored) { }
                try { is.close(); } catch (Exception ignored) { }
            }
            writeSidecarLrc(dir, safe, lrcText);
            MediaScannerConnection.scanFile(act, new String[]{out.getAbsolutePath()}, null, null);
            return "{\"ok\":true,\"path\":\"" + out.getAbsolutePath().replace("\"", " ") + "\"}";
        } catch (Exception e) {
            if (out != null && out.exists()) {
                try { out.delete(); } catch (Exception ignored) { }
            }
            return "{\"ok\":false}";
        } finally {
            if (c != null) try { c.disconnect(); } catch (Exception ignored) { }
        }
    }

    void downloadAsync(final String url, final String fileName, final String lrcText) {
        new Thread(() -> {
            String safe = sanitizeFileName(fileName, false);
            File dir = AudioStore.pickWritableDir(act);
            File out = new File(dir, safe);
            long got = 0;
            long total = 0;
            try {
                for (int attempt = 0; attempt < 2; attempt++) {
                    got = 0;
                    total = 0;
                    HttpURLConnection c = null;
                    InputStream is = null;
                    FileOutputStream fos = null;
                    try {
                        c = openConn(url, "GET");
                        c.connect();
                        int code = c.getResponseCode();
                        if (code >= 400) {
                            throw new IOException("HTTP " + code + " " + c.getResponseMessage());
                        }
                        String ct = String.valueOf(c.getContentType()).toLowerCase();
                        if (ct.contains("text/html") || ct.contains("json")) {
                            throw new IOException("服务器返回的不是音频（" + ct + "），可能需要会员或已下架");
                        }
                        total = c.getContentLengthLong();
                        if (total > MAX_DOWNLOAD_BYTES) {
                            throw new IOException("音频体积超过 200MB 上限，已拒绝下载");
                        }
                        is = c.getInputStream();
                        try {
                            fos = new FileOutputStream(out);
                        } catch (Exception we) {
                            dir = AudioStore.privateDir(act);
                            out = new File(dir, safe);
                            fos = new FileOutputStream(out);
                        }
                        byte[] buf = new byte[65536];
                        int n;
                        long last = 0;
                        while ((n = is.read(buf)) > 0) {
                            got += n;
                            if (got > MAX_DOWNLOAD_BYTES) {
                                throw new IOException("下载体积超过 200MB 上限，已中止");
                            }
                            fos.write(buf, 0, n);
                            long now = System.currentTimeMillis();
                            if (now - last > 220) {
                                last = now;
                                int pct = total > 0 ? (int) (got * 100 / total) : -1;
                                js.eval("window.onDownload&&window.onDownload(" + pct + "," + jsStr(safe) + "," + got + "," + total + ")");
                            }
                        }
                        fos.flush();
                        fos.close();
                        fos = null;
                        is.close();
                        is = null;
                        c.disconnect();
                        c = null;
                        if (total > 0 && got < total) {
                            throw new IOException("下载不完整 " + got + "/" + total + " 字节");
                        }
                        if (got < 20000) {
                            throw new IOException("只拿到 " + got + " 字节（像是试听片段或出错页）");
                        }
                        break;
                    } catch (Exception e1) {
                        if (fos != null) try { fos.close(); } catch (Exception ignored) { }
                        if (is != null) try { is.close(); } catch (Exception ignored) { }
                        if (c != null) try { c.disconnect(); } catch (Exception ignored) { }
                        if (attempt >= 1) throw e1;
                        try { Thread.sleep(800); } catch (InterruptedException ignored) { }
                    }
                }
                writeSidecarLrc(dir, safe, lrcText);
                MediaScannerConnection.scanFile(act, new String[]{out.getAbsolutePath()}, null, null);
                js.eval("window.onDownloadDone&&window.onDownloadDone(true," + jsStr(out.getAbsolutePath()) + ")");
            } catch (final Exception e) {
                try { if (out.exists()) out.delete(); } catch (Exception ignored) { }
                js.eval("window.onDownloadDone&&window.onDownloadDone(false," + jsStr(String.valueOf(e.getMessage())) + ")");
            }
        }).start();
    }

    private static String sanitizeFileName(String fileName, boolean clampLength) {
        String safe = String.valueOf(fileName).replaceAll("[\\\\/:*?\"<>|]", "_");
        if (clampLength && safe.length() > 100) {
            int dot = safe.lastIndexOf('.');
            safe = dot > 0 ? safe.substring(0, 96) + safe.substring(dot) : safe.substring(0, 100);
        }
        return safe;
    }

    private static void writeSidecarLrc(File dir, String safeAudioName, String lrcText) throws IOException {
        if (lrcText == null || lrcText.length() == 0) return;
        String baseName = safeAudioName.replaceAll("\\.[^.]+$", "");
        File lrc = new File(dir, baseName + ".lrc");
        FileOutputStream lf = new FileOutputStream(lrc);
        try {
            lf.write(lrcText.getBytes("UTF-8"));
        } finally {
            try { lf.close(); } catch (Exception ignored) { }
        }
    }

    static String jsStr(String s) {
        if (s == null) return "''";
        StringBuilder b = new StringBuilder("'");
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '\'' || ch == '\\') {
                b.append('\\').append(ch);
            } else if (ch == '\n' || ch == '\r') {
                b.append(' ');
            } else {
                b.append(ch);
            }
        }
        return b.append("'").toString();
    }
}
