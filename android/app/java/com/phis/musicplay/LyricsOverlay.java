package com.phis.musicplay;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/** 悬浮歌词：透明底 + 拖动 + 锁定(触摸穿透) + 换色 */
public class LyricsOverlay {

    private static LyricsOverlay inst;

    private final Context ctx;
    private final WindowManager wm;
    private View root;
    private TextView line1, line2;
    private WindowManager.LayoutParams lp;
    private boolean locked = false;
    private int color = 0xFFFFFFFF;
    private int fontSizeSp = 18;
    private int bgAlpha = 0; // 0 ~ 220

    private LyricsOverlay(Context c) {
        this.ctx = c.getApplicationContext();
        this.wm = (WindowManager) this.ctx.getSystemService(Context.WINDOW_SERVICE);
    }

    public static LyricsOverlay get(Context c) {
        if (inst == null) inst = new LyricsOverlay(c);
        return inst;
    }

    public static boolean canDraw(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        return Settings.canDrawOverlays(c);
    }

    public boolean isShowing() { return root != null; }
    public boolean isLocked() { return locked; }

    public void show() {
        if (root != null) return;
        if (!canDraw(ctx)) return;

        LinearLayout box = new LinearLayout(ctx);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(10), dp(6), dp(10), dp(6));

        line1 = new TextView(ctx);
        line1.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
        line1.setGravity(Gravity.CENTER);
        line1.setMaxLines(2);
        line1.setShadowLayer(6f, 0f, 1f, 0xCC000000);

        line2 = new TextView(ctx);
        line2.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        line2.setGravity(Gravity.CENTER);
        line2.setMaxLines(2);
        line2.setShadowLayer(6f, 0f, 1f, 0xCC000000);

        box.addView(line1);
        box.addView(line2);
        applyColor();

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
            long downAt;
            @Override
            public boolean onTouch(View v, MotionEvent e) {
                if (locked) return false;
                switch (e.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        downX = e.getRawX(); downY = e.getRawY();
                        startX = lp.x; startY = lp.y;
                        moved = false; downAt = System.currentTimeMillis();
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = (int) (e.getRawX() - downX);
                        int dy = (int) (e.getRawY() - downY);
                        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
                        if (moved) {
                            lp.x = startX + dx;
                            lp.y = startY + dy;
                            try { wm.updateViewLayout(root, lp); } catch (Exception ignored) { }
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                        return true;
                }
                return false;
            }
        });

        root = box;
        try {
            wm.addView(root, lp);
        } catch (Exception e) {
            root = null;
        }
    }

    private int flagsForState() {
        int f = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS;
        if (locked) f |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;  // 触摸穿透
        return f;
    }

    public void setLocked(boolean v) {
        locked = v;
        if (root != null && lp != null) {
            lp.flags = flagsForState();
            try { wm.updateViewLayout(root, lp); } catch (Exception ignored) { }
        }
        // 通知栏同步显示/隐藏「解锁歌词」
        try {
            if (PlaybackService.instance != null) PlaybackService.instance.refresh();
        } catch (Exception ignored) { }
    }

    public void setColor(int c) {
        color = c;
        applyColor();
    }

    public void setStyle(int c, int sizeSp, int alpha) {
        color = c;
        fontSizeSp = Math.max(12, Math.min(30, sizeSp));
        bgAlpha = Math.max(0, Math.min(220, alpha));
        applyColor();
    }

    private void applyColor() {
        if (line1 != null) {
            line1.setTextColor(color);
            line1.setTextSize(TypedValue.COMPLEX_UNIT_SP, fontSizeSp);
        }
        if (line2 != null) {
            line2.setTextColor((color & 0x00FFFFFF) | 0xCC000000);
            line2.setTextSize(TypedValue.COMPLEX_UNIT_SP, Math.max(11, fontSizeSp - 4));
        }
        if (root != null) {
            if (bgAlpha <= 0) {
                root.setBackgroundColor(0x00000000);
            } else {
                android.graphics.drawable.GradientDrawable gd = new android.graphics.drawable.GradientDrawable();
                gd.setColor((bgAlpha << 24) | 0x00121318);
                gd.setCornerRadius(dp(12));
                root.setBackground(gd);
            }
        }
    }

    public void hide() {
        if (root == null) return;
        try { wm.removeView(root); } catch (Exception ignored) { }
        root = null;
        locked = false;
    }

    public void setText(final String a, final String b) {
        if (root == null) return;
        if (line1 != null) line1.setText(a == null ? "" : a);
        if (line2 != null) line2.setText(b == null ? "" : b);
    }

    private int dp(int v) {
        return (int) (v * ctx.getResources().getDisplayMetrics().density);
    }
}
