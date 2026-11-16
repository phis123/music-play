package com.phis.musicplay;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.widget.FrameLayout;

public class MainActivity extends Activity {

    private WebView web;
    public WebView webView;
    private PlayerBridge player;
    public static MainActivity current;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 状态栏跟随主题
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        w.setStatusBarColor(0xFFFFFFFF);
        w.setNavigationBarColor(0xFFFFFFFF);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            w.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }

        boolean isDebuggable = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (isDebuggable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
        web = new WebView(this) {
            @Override
            protected void onWindowVisibilityChanged(int visibility) {
                // 保持 WebView 始终向 Chromium 报告 VISIBLE，防止切到后台或息屏时冻结 JS 定时器、批量声源匹配与下载队列
                super.onWindowVisibilityChanged(View.VISIBLE);
            }
        };
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        web.setWebViewClient(new WebViewClient());
        web.setBackgroundColor(0xFFFFFFFF);

        player = new PlayerBridge(this, web);
        web.addJavascriptInterface(new Bridge(this, web, player), "Android");

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFFFFFFFF);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        requestAudioPermission();
        webView = web;
        current = this;
        PlaybackService.start(this);
        web.loadUrl("file:///android_asset/index.html");
    }

    private void requestAudioPermission() {
        String perm = Build.VERSION.SDK_INT >= 33
                ? Manifest.permission.READ_MEDIA_AUDIO
                : Manifest.permission.READ_EXTERNAL_STORAGE;
        if (checkSelfPermission(perm) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{perm}, 1);
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        super.onRequestPermissionsResult(code, perms, res);
        // 授权后重新加载，让前端拿到列表
        web.postDelayed(() -> web.reload(), 300);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.resumeTimers();
            web.evaluateJavascript("window.onAppResume&&window.onAppResume()", null);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        // 不暂停 WebView JS 计时器，保证后台批量匹配与下载持续运行
        if (web != null) web.resumeTimers();
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (web != null) web.resumeTimers();
    }

    @Override
    public void onBackPressed() {
        // 前端优先处理返回
        web.evaluateJavascript(
                "(function(){try{return window.onAndroidBack&&window.onAndroidBack()?'1':'0'}catch(e){return '0'}})()",
                v -> {
                    if (v == null || !v.contains("1")) {
                        if (web.canGoBack()) web.goBack();
                        else finish();
                    }
                });
    }

    @Override
    protected void onDestroy() {
        current = null;
        if (player != null) player.release();
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
