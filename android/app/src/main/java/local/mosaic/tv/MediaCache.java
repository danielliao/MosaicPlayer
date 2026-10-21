package local.mosaic.tv;

import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.TimeUnit;
import okhttp3.*;
import org.json.JSONObject;

public final class MediaCache {
  public static final long LIMIT = 1024L * 1024 * 1024;
  private final File root;
  private final OkHttpClient http;
  private final String base, key;
  private volatile Call call;

  public MediaCache(File root, ApiClient api, String base, String key) {
    this.root = root;
    this.base = base;
    this.key = key;
    http =
        api.http
            .newBuilder()
            .callTimeout(0, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build();
    if (!root.isDirectory() && !root.mkdirs()) throw new IllegalStateException("无法创建缓存目录");
  }

  private String hash(String text) throws Exception {
    byte[] bytes =
        MessageDigest.getInstance("SHA-256")
            .digest(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
    StringBuilder s = new StringBuilder();
    for (byte b : bytes) s.append(String.format(java.util.Locale.ROOT, "%02x", b));
    return s.toString();
  }

  public File path(JSONObject media) throws Exception {
    return new File(
        root,
        hash(base + "\n" + key + "\n" + media.getString("id") + "\n" + media.optString("sha256")));
  }

  public static String sha256(File file) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (InputStream in = new FileInputStream(file)) {
      byte[] b = new byte[65536];
      int n;
      while ((n = in.read(b)) != -1) digest.update(b, 0, n);
    }
    StringBuilder out = new StringBuilder();
    for (byte b : digest.digest()) out.append(String.format(java.util.Locale.ROOT, "%02x", b));
    return out.toString();
  }

  private boolean valid(File file, long size, String expected) throws Exception {
    return file.isFile()
        && file.length() == size
        && (expected.isEmpty() || sha256(file).equals(expected));
  }

  public synchronized File fetch(JSONObject media, Set<File> protectedFiles) throws Exception {
    long size = media.getLong("size");
    if (size <= 0 || size > LIMIT) throw new IOException("素材大小无效或超过 1 GB");
    String id = media.getString("id");
    if (!id.matches("[A-Za-z0-9_-]+")) throw new IOException("无效素材标识");
    File target = path(media);
    String expected = media.optString("sha256").toLowerCase(java.util.Locale.ROOT);
    if (!expected.isEmpty() && !expected.matches("[a-f0-9]{64}")) throw new IOException("无效素材摘要");
    if (valid(target, size, expected)) {
      target.setLastModified(System.currentTimeMillis());
      return target;
    }
    if (target.exists() && !target.delete()) throw new IOException("缓存摘要失效且无法替换");
    List<File> files =
        new ArrayList<>(Arrays.asList(Optional.ofNullable(root.listFiles()).orElse(new File[0])));
    files.sort(Comparator.comparingLong(File::lastModified));
    long used = 0;
    for (File f : files) used += f.length();
    for (File f : files) {
      if (used + size <= LIMIT && root.getUsableSpace() > size + 32 * 1024 * 1024L) break;
      if (!protectedFiles.contains(f)) {
        long n = f.length();
        if (f.delete()) used -= n;
      }
    }
    if (used + size > LIMIT || root.getUsableSpace() < size + 32 * 1024 * 1024L)
      throw new IOException("电视存储空间不足，请删除其他应用或使用较小素材");
    File temp = new File(root, target.getName() + ".part");
    call =
        http.newCall(
            new Request.Builder()
                .url(base + "/media/" + id)
                .header("Authorization", "Bearer " + key)
                .header("X-Mosaic-Capabilities", ApiClient.CAPABILITIES)
                .build());
    try (Response response = call.execute()) {
      if (response.code() != 200 || response.body() == null)
        throw new IOException("素材下载失败 HTTP " + response.code());
      long total = 0;
      byte[] buffer = new byte[65536];
      try (InputStream in = response.body().byteStream();
          FileOutputStream out = new FileOutputStream(temp)) {
        int n;
        while ((n = in.read(buffer)) != -1) {
          if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException();
          total += n;
          if (total > size) throw new IOException("素材长度不匹配");
          out.write(buffer, 0, n);
        }
        if (total != size) throw new IOException("素材下载不完整");
        out.getFD().sync();
      }
      if (!valid(temp, size, expected)) throw new IOException("素材 SHA-256 不匹配");
      if (!temp.renameTo(target)) throw new IOException("缓存保存失败");
      return target;
    } finally {
      call = null;
      if (temp.exists()) temp.delete();
    }
  }

  public void cancel() {
    Call current = call;
    if (current != null) current.cancel();
  }
}
