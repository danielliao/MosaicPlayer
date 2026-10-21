package local.mosaic.tv;

import android.content.pm.*;
import android.os.Build;
import java.io.*;
import java.nio.*;
import java.util.*;
import java.util.zip.*;
import org.json.*;

final class ApkValidator {
  static void transport(String base, boolean allowLanHttp) throws IOException {
    try {
      java.net.URI uri = new java.net.URI(base);
      String host = uri.getHost();
      if ("https".equals(uri.getScheme()) && host != null) return;
      boolean local =
          "localhost".equals(host) || "::1".equals(host) || host != null && host.endsWith(".local");
      if (host != null && host.matches("[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+")) {
        String[] parts = host.split("\\.");
        int a = Integer.parseInt(parts[0]), b = Integer.parseInt(parts[1]);
        boolean valid = true;
        for (String part : parts) if (Integer.parseInt(part) > 255) valid = false;
        local =
            valid
                && (a == 10 || a == 127 || a == 192 && b == 168 || a == 172 && b >= 16 && b <= 31);
      }
      if (!allowLanHttp || !"http".equals(uri.getScheme()) || !local)
        throw new IOException("APK 更新需要 HTTPS；局域网 HTTP 仅在显式开发构建中启用");
    } catch (java.net.URISyntaxException e) {
      throw new IOException("无效服务器地址", e);
    }
  }

  static void policy(JSONObject offer, int sdk, long installed) throws Exception {
    if (!"local.mosaic.tv".equals(offer.getString("packageName")))
      throw new IOException("安装包包名不匹配");
    if (offer.getLong("versionCode") <= installed) throw new IOException("拒绝相同或较低版本");
    if (offer.getInt("minSdk") > sdk || offer.getInt("minSdk") < 1)
      throw new IOException("电视系统版本不兼容");
    if (!offer.getString("sha256").matches("[a-fA-F0-9]{64}")) throw new IOException("无效 APK 摘要");
    if (offer.getLong("size") <= 0 || offer.getLong("size") > 300L * 1024 * 1024)
      throw new IOException("APK 大小无效");
    if (!offer.getString("url").matches("/api/device/updates/[A-Za-z0-9_-]+/apk"))
      throw new IOException("拒绝跨服务器安装包地址");
  }

  static void file(File apk, JSONObject offer) throws Exception {
    if (apk.length() != offer.getLong("size")) throw new IOException("APK 长度不匹配");
    if (!MediaCache.sha256(apk).equalsIgnoreCase(offer.getString("sha256")))
      throw new IOException("APK SHA-256 不匹配");
  }

  @SuppressWarnings("deprecation")
  static void validate(PackageManager pm, File apk, JSONObject offer) throws Exception {
    PackageInfo own =
        pm.getPackageInfo(
            "local.mosaic.tv",
            Build.VERSION.SDK_INT >= 28
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES);
    long installed = Build.VERSION.SDK_INT >= 28 ? own.getLongVersionCode() : own.versionCode;
    policy(offer, Build.VERSION.SDK_INT, installed);
    file(apk, offer);
    PackageInfo info =
        pm.getPackageArchiveInfo(
            apk.getPath(),
            Build.VERSION.SDK_INT >= 28
                ? PackageManager.GET_SIGNING_CERTIFICATES
                : PackageManager.GET_SIGNATURES);
    if (info == null || !"local.mosaic.tv".equals(info.packageName))
      throw new IOException("APK 包名或元数据无效");
    long version = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    if (version != offer.getLong("versionCode") || version <= installed)
      throw new IOException("APK 版本与发布信息不匹配");
    if (minimumSdk(apk) != offer.getInt("minSdk")) throw new IOException("APK minSDK 与发布信息不匹配");
    Signature[] installedSigners =
        Build.VERSION.SDK_INT >= 28 && own.signingInfo != null
            ? own.signingInfo.getApkContentsSigners()
            : own.signatures;
    Signature[] offeredSigners =
        Build.VERSION.SDK_INT >= 28 && info.signingInfo != null
            ? info.signingInfo.getApkContentsSigners()
            : info.signatures;
    if (!sameSigners(installedSigners, offeredSigners)) throw new IOException("APK 必须使用当前应用的相同签名");
  }

  static boolean sameSigners(Signature[] own, Signature[] archive) {
    if (own == null || archive == null || own.length == 0 || own.length != archive.length)
      return false;
    Set<Signature> existing = new HashSet<>(Arrays.asList(own));
    return existing.size() == own.length && existing.equals(new HashSet<>(Arrays.asList(archive)));
  }

  /** Binary manifest parsing also works on API23 where ApplicationInfo.minSdkVersion is absent. */
  static int minimumSdk(File apk) throws Exception {
    byte[] data;
    try (ZipFile zip = new ZipFile(apk)) {
      ZipEntry entry = zip.getEntry("AndroidManifest.xml");
      if (entry == null) throw new IOException("APK 缺少 manifest");
      try (InputStream in = zip.getInputStream(entry);
          ByteArrayOutputStream out = new ByteArrayOutputStream()) {
        byte[] b = new byte[4096];
        int n;
        while ((n = in.read(b)) != -1) {
          out.write(b, 0, n);
          if (out.size() > 2 * 1024 * 1024) throw new IOException("manifest 过大");
        }
        data = out.toByteArray();
      }
    }
    ByteBuffer b = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
    List<String> strings = new ArrayList<>();
    int found = 1;
    if (data.length < 8 || b.getShort(0) != 3) throw new IOException("无效 APK manifest");
    for (int at = 8; at + 8 <= data.length; ) {
      int type = b.getShort(at) & 65535,
          header = b.getShort(at + 2) & 65535,
          size = b.getInt(at + 4);
      if (size < 8 || at + size > data.length) throw new IOException("manifest 分块无效");
      if (type == 1) {
        int count = b.getInt(at + 8), flags = b.getInt(at + 16), start = b.getInt(at + 20);
        if (count < 0 || count > 100000 || header + count * 4 > size)
          throw new IOException("manifest 字符串无效");
        for (int i = 0; i < count; i++) {
          int p = at + start + b.getInt(at + header + i * 4);
          if ((flags & 256) != 0) {
            int[] skip = length8(data, p);
            int[] len = length8(data, skip[1]);
            strings.add(new String(data, len[1], len[0], java.nio.charset.StandardCharsets.UTF_8));
          } else {
            int len = b.getShort(p) & 65535;
            p += 2;
            if ((len & 32768) != 0) {
              len = ((len & 32767) << 16) | (b.getShort(p) & 65535);
              p += 2;
            }
            strings.add(new String(data, p, len * 2, java.nio.charset.StandardCharsets.UTF_16LE));
          }
        }
      }
      if (type == 0x102) {
        int ext = at + header;
        String name = strings.get(b.getInt(ext + 4));
        int attrStart = b.getShort(ext + 8) & 65535,
            attrSize = b.getShort(ext + 10) & 65535,
            count = b.getShort(ext + 12) & 65535;
        if ("uses-sdk".equals(name)) {
          for (int i = 0; i < count; i++) {
            int p = ext + attrStart + i * attrSize;
            String attr = strings.get(b.getInt(p + 4));
            if ("minSdkVersion".equals(attr)) {
              int valueType = data[p + 15] & 255;
              if (valueType != 16 && valueType != 17) throw new IOException("不支持预览版系统 APK");
              found = b.getInt(p + 16);
            }
          }
        }
      }
      at += size;
    }
    return found;
  }

  private static int[] length8(byte[] b, int p) {
    int n = b[p++] & 255;
    if ((n & 128) != 0) n = ((n & 127) << 8) | (b[p++] & 255);
    return new int[] {n, p};
  }
}
