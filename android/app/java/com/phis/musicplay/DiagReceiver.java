package com.phis.musicplay;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 无界面触发诊断导出，供维护者在不动前台 UI 的情况下取证：
 *   adb shell am broadcast -a com.phis.musicplay.DIAG_EXPORT
 *   adb shell am broadcast -a com.phis.musicplay.DIAG_CLEAR
 * 导出结果：Android/data/com.phis.musicplay/files/diag/export-*.zip
 */
public class DiagReceiver extends BroadcastReceiver {

    public static final String ACTION_EXPORT = "com.phis.musicplay.DIAG_EXPORT";
    public static final String ACTION_CLEAR = "com.phis.musicplay.DIAG_CLEAR";
    public static final String ACTION_SNAPSHOT = "com.phis.musicplay.DIAG_SNAPSHOT";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        try {
            Diag.attach(context);
            if (ACTION_EXPORT.equals(action)) {
                Diag.write("broadcast", "收到导出请求");
                String path = Diag.export(context);
                Diag.write("broadcast", "导出结果=" + path);
            } else if (ACTION_CLEAR.equals(action)) {
                Diag.clear(context);
                Diag.write("broadcast", "已清空日志");
            } else if (ACTION_SNAPSHOT.equals(action)) {
                Diag.write("broadcast", "快照已生成");
                Diag.export(context);
            }
        } catch (Throwable t) {
            Diag.write("broadcast", "处理失败: " + t);
        }
    }
}
