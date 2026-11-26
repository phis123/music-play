package com.phis.musicplay;

import java.io.File;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;

/**
 * MP3 快速响度测算器（按 25%/50%/75% 采样 global_gain 估算与目标响度的差值 dB）。
 * 从 Bridge.java 独立拆出，专注音频帧解析与缓存。
 */
final class Mp3LoudnessEstimator {

    private static final int[] BR_V1_L3 = {0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0};
    private static final int[] BR_V2_L3 = {0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0};
    private static final int[] SR_V1 = {44100, 48000, 32000, 0};
    private static final int[] SR_V2 = {22050, 24000, 16000, 0};
    private static final int[] SR_V25 = {11025, 12000, 8000, 0};

    private final BridgeStorage storage;
    private final HashMap<String, Float> gainCache = new HashMap<>();

    Mp3LoudnessEstimator(BridgeStorage storage) {
        this.storage = storage;
    }

    private static int readBits(byte[] buf, int baseByte, int bitOffset, int nBits) {
        int val = 0;
        for (int i = 0; i < nBits; i++) {
            int totalBit = bitOffset + i;
            int byteIdx = baseByte + (totalBit >> 3);
            if (byteIdx >= buf.length) return 0;
            int bitInByte = 7 - (totalBit & 7);
            val = (val << 1) | (((buf[byteIdx] & 0xFF) >> bitInByte) & 1);
        }
        return val;
    }

    float estimateGainDb(String path) {
        if (path == null || path.isEmpty()) return 0f;
        synchronized (gainCache) {
            if (gainCache.containsKey(path)) return gainCache.get(path);
        }
        if (!path.toLowerCase().endsWith(".mp3")) return 0f;
        float result = 0f;
        RandomAccessFile raf = null;
        try {
            File f = new File(path);
            if (!storage.isInsideAllowedRoot(f) || !f.isFile() || f.length() < 16384) return 0f;
            long size = f.length();
            raf = new RandomAccessFile(f, "r");
            int chunk = 24576;
            byte[] buf = new byte[chunk];
            long[] offsets = {(long) (size * 0.25), (long) (size * 0.50), (long) (size * 0.75)};
            ArrayList<Integer> gains = new ArrayList<>(256);
            for (long off : offsets) {
                if (off + 1024 >= size) continue;
                raf.seek(off);
                int nRead = raf.read(buf, 0, (int) Math.min(chunk, size - off));
                if (nRead < 256) continue;
                int i = 0;
                int end = nRead - 40;
                while (i < end) {
                    if ((buf[i] & 0xFF) != 0xFF || (buf[i + 1] & 0xE0) != 0xE0) { i++; continue; }
                    int b1 = buf[i + 1] & 0xFF;
                    int b2 = buf[i + 2] & 0xFF;
                    int b3 = buf[i + 3] & 0xFF;
                    int ver = (b1 >> 3) & 0x03;
                    int lay = (b1 >> 1) & 0x03;
                    int prot = b1 & 0x01;
                    if (ver == 1 || lay != 1) { i++; continue; }
                    int brIdx = (b2 >> 4) & 0x0F;
                    int srIdx = (b2 >> 2) & 0x03;
                    int pad = (b2 >> 1) & 0x01;
                    if (brIdx == 0 || brIdx == 15 || srIdx == 3) { i++; continue; }
                    boolean isV1 = (ver == 3);
                    int br = (isV1 ? BR_V1_L3[brIdx] : BR_V2_L3[brIdx]) * 1000;
                    int sr = ver == 3 ? SR_V1[srIdx] : (ver == 2 ? SR_V2[srIdx] : SR_V25[srIdx]);
                    if (br == 0 || sr == 0) { i++; continue; }
                    int frameLen = (isV1 ? (144 * br) / sr : (72 * br) / sr) + pad;
                    if (frameLen < 24 || frameLen > 2880 || i + frameLen + 2 >= nRead) { i++; continue; }
                    if ((buf[i + frameLen] & 0xFF) != 0xFF || (buf[i + frameLen + 1] & 0xFE) != (b1 & 0xFE)) {
                        i++;
                        continue;
                    }
                    int sideStart = i + 4 + (prot == 0 ? 2 : 0);
                    int nch = ((b3 >> 6) == 3) ? 1 : 2;
                    int sideLen = isV1 ? (nch == 1 ? 17 : 32) : (nch == 1 ? 9 : 17);
                    if (sideStart + sideLen + 4 > nRead) break;
                    if (isV1) {
                        int bitPos = nch == 1 ? 18 : 20;
                        for (int gr = 0; gr < 2; gr++) {
                            for (int ch = 0; ch < nch; ch++) {
                                int p23 = readBits(buf, sideStart, bitPos, 12);
                                int gg = readBits(buf, sideStart, bitPos + 21, 8);
                                if (p23 > 32 && gg >= 115 && gg <= 250) gains.add(gg);
                                bitPos += 59;
                            }
                        }
                    }
                    i += frameLen;
                }
            }
            if (gains.size() >= 8) {
                Collections.sort(gains);
                int p80 = gains.get(Math.min(gains.size() - 1, (int) (gains.size() * 0.80)));
                double rawDiff = (171.0 - p80) * 1.50515 * 0.65;
                rawDiff = Math.max(-8.5, Math.min(8.5, rawDiff));
                result = Math.round(rawDiff * 10f) / 10f;
            }
        } catch (Exception ignored) {
        } finally {
            if (raf != null) {
                try { raf.close(); } catch (Exception ignored) { }
            }
        }
        synchronized (gainCache) {
            gainCache.put(path, result);
        }
        return result;
    }
}
