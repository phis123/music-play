package com.phis.musicplay;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/** 悬浮歌词：透明底 + 拖动 + 锁定(触摸穿透) + 换色/字号/底衬（全 UI 线程安全） */
public class LyricsOverlay {

    private static volatile LyricsOverlay inst;

    private final Context ctx;
    private final WindowManager wm;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private View root;
    private TextView line1, line2;
    private GradientDrawable bgDrawable;
    private WindowManager.LayoutParams lp;
    private volatile boolean showing = false;
    private volatile boolean locked = false;
    private volatile int color = 0xFFFFFFFF;
    private volatile int fontSizeSp = 18;
    private volatile int bgAlpha = 0; // 0 ~ 220
    private int appliedColor = 0;
    private int appliedSizeSp = 0;
    private int appliedBgAlpha = -1;
    private volatile String lastLine1 = "";
    private volatile String lastLine2 = "";
    private final Runnable applyStyleTask = this::applyStyleOnUi;

    private LyricsOverlay(Context c) {
        this.ctx = c.getApplicationContext();
        this.wm = (WindowManager) this.ctx.getSystemService(Context.WINDOW_SERVICE);
    }

    public static LyricsOverlay get(Context c) {
        if (inst == null) {
            synchronized (LyricsOverlay.class) {
                if (inst == null) inst = new LyricsOverlay(c);
            }
        }
        return inst;
    }

    private void runOnUi(final Runnable r) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            try { r.run(); } catch (Throwable ignored) { }
        } else {
            ui.post(() -> {
                try { r.run(); } catch (Throwable ignored) { }
            });
        }
    }

    public static boolean canDraw(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return Settings.canDrawOverlays(c);
    }

    public boolean isShowing() { return showing; }
    public boolean isLocked() { return locked; }

    public void show() {
        if (!canDraw(ctx)) return;
        showing = true;
        runOnUi(() -> {
            if (!showing) return;
            if (root != null) {
                applyStyleOnUi();
                return;
            }
            LinearLayout box = new LinearLayout(ctx);
            box.setOrientation(LinearLayout.VERTICAL);
            box.setPadding(dp(12), dp(6), dp(12), dp(6));

            line1 = new TextView(ctx);
            line1.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSizeSp);
            line1.setGravity(Gravity.CENTER);
            line1.setMaxLines(2);
            line1.setShadowLayer(6f, 0f, 1f, 0xCC000000);
            line1.setText(lastLine1);

            line2 = new TextView(ctx);
            line2.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(11, fontSizeSp - 4));
            line2.setGravity(Gravity.CENTER);
            line2.setMaxLines(2);
            line2.setShadowLayer(6f, 0f, 1f, 0xCC000000);
            line2.setText(lastLine2);

            box.addView(line1);
            box.addView(line2);

            bgDrawable = new GradientDrawable();
            bgDrawable.setCornerRadius(dp(12));
            bgDrawable.setColor(0x00000000);
            box.setBackground(bgDrawable);
            appliedColor = 0;
            appliedSizeSp = 0;
            appliedBgAlpha = -1;

            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    : WindowManager.LayoutParams.TYPE_PHONE;

            lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.WRAP_CONTENT,
                    type,
                    flagsForState(),
                    PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.START;
            lp.x = dp(12);
            lp.y = dp(120);

            box.setOnTouchListener(new View.OnTouchListener() {
                float downX, downY;
                int startX, startY;
                boolean moved;
                @Override
                public boolean onTouch(View v, MotionEvent e) {
                    if (locked || lp == null || root == null) return false;
                    switch (e.getAction()) {
                        case MotionEvent.ACTION_DOWN:
                            downX = e.getRawX(); downY = e.getRawY();
                            startX = lp.x; startY = lp.y;
                            moved = false;
                            return true;
                        case MotionEvent.ACTION_MOVE:
                            int dx = (int) (e.getRawX() - downX);
                            int dy = (int) (e.getRawY() - downY);
                            if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
                            if (moved) {
                                lp.x = startX + dx;
                                lp.y = startY + dy;
                                try { wm.updateViewLayout(root, lp); } catch (Throwable ignored) { }
                            }
                            return true;
                        case MotionEvent.ACTION_UP:
                            return true;
                    }
                    return false;
                }
            });

            root = box;
            applyStyleOnUi();
            try {
                wm.addView(root, lp);
                showing = true;
            } catch (Throwable e) {
                root = null;
                line1 = null;
                line2 = null;
                lp = null;
                showing = false;
            }
        });
    }

    private int flagsForState() {
        int f = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
        if (locked) f |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;  // 触摸穿透
        return f;
    }

    public void setLocked(boolean v) {
        locked = v;
        runOnUi(() -> {
            if (root != null && lp != null) {
                lp.flags = flagsForState();
                try { wm.updateViewLayout(root, lp); } catch (Throwable ignored) { }
            }
            try {
                if (PlaybackService.instance != null) PlaybackService.instance.refresh();
            } catch (Throwable ignored) { }
        });
    }

    public void setColor(int c) {
        color = c;
        if (!showing) return;
        ui.removeCallbacks(applyStyleTask);
        ui.post(applyStyleTask);
    }

    public void setStyle(int c, int sizeSp, int alpha) {
        color = c;
        fontSizeSp = Math.max(12, Math.min(30, sizeSp));
        bgAlpha = Math.max(0, Math.min(220, alpha));
        if (!showing) return;
        ui.removeCallbacks(applyStyleTask);
        ui.post(applyStyleTask);
    }

    private void applyStyleOnUi() {
        if (!showing || root == null || line1 == null || line2 == null) return;
        try {
            int c = color;
            int sz = fontSizeSp;
            int al = bgAlpha;
            if (c != appliedColor) {
                appliedColor = c;
                line1.setTextColor(c);
                line2.setTextColor((c & 0x00FFFFFF) | 0xCC000000);
            }
            if (sz != appliedSizeSp) {
                appliedSizeSp = sz;
                line1.setTextSize(TypedValue.COMPLEX_UNIT_SP, sz);
                line2.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(11, sz - 4));
            }
            if (al != appliedBgAlpha && bgDrawable != null) {
                appliedBgAlpha = al;
                bgDrawable.setColor(al <= 0 ? 0x00000000 : (((al & 0xFF) << 24) | 0x00121318));
            }
        } catch (Throwable ignored) { }
    }

    public void hide() {
        showing = false;
        locked = false;
        runOnUi(() -> {
            if (root != null) {
                try { wm.removeView(root); } catch (Throwable ignored) { }
            }
            root = null;
            line1 = null;
            line2 = null;
            lp = null;
            bgDrawable = null;
        });
    }

    public void setText(final String a, final String b) {
        lastLine1 = a == null ? "" : a;
        lastLine2 = b == null ? "" : b;
        if (!showing) return;
        runOnUi(() -> {
            if (root == null || line1 == null || line2 == null) return;
            line1.setText(lastLine1);
            line2.setText(lastLine2);
        });
    }

    /** 一行式悬浮词状态摘要（供诊断快照） */
    public String diagState() {
        return "悬浮词: showing=" + showing + " locked=" + locked
                + " color=#" + Integer.toHexString(color) + " sizeSp=" + fontSizeSp + " bgAlpha=" + bgAlpha;
    }

    private int dp(int v) {
        return (int) (v * ctx.getResources().getDisplayMetrics().density);
    }
}
