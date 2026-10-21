package local.mosaic.tv;

import android.app.*;
import android.content.*;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.*;
import okhttp3.*;
import org.json.*;

/** Explicit command acknowledgements never imply the physical TV panel or installer succeeded. */
final class DeviceOperations implements AutoCloseable {
  static final int INSTALL_REQUEST = 774;

  interface InstallValidator {
    void validate(File apk, JSONObject command) throws Exception;
  }

  private final InstallValidator installValidator;
  private volatile long installAttempt;
  private boolean installPending;
  private volatile String updateError;
  private final Context context;
  private final WallView wall;
  private final ApiClient api;
  private final String base, key;
  private final Handler main;
  private final Consumer<String> status;
  private final Supplier<String> program, media;
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private final ExecutorService receipts = Executors.newSingleThreadExecutor();
  private final LinkedHashMap<String, String> handled = new LinkedHashMap<>();
  private final android.content.SharedPreferences prefs;
  private final File directory;
  private JSONObject offer;
  private File readyApk;
  private volatile String update = "idle";
  private volatile boolean closed;
  private volatile Call download;
  private long lastCapture;

  DeviceOperations(
      Context context,
      WallView wall,
      ApiClient api,
      String base,
      String key,
      Handler main,
      Consumer<String> status,
      Supplier<String> program,
      Supplier<String> media) {
    this(
        context,
        wall,
        api,
        base,
        key,
        main,
        status,
        program,
        media,
        (apk, command) -> ApkValidator.validate(context.getPackageManager(), apk, command));
  }

  DeviceOperations(
      Context context,
      WallView wall,
      ApiClient api,
      String base,
      String key,
      Handler main,
      Consumer<String> status,
      Supplier<String> program,
      Supplier<String> media,
      InstallValidator installValidator) {
    this.installValidator = installValidator;
    this.context = context;
    this.wall = wall;
    this.api = api;
    this.base = base;
    this.key = key;
    this.main = main;
    this.status = status;
    this.program = program;
    this.media = media;
    String scope;
    try {
      StringBuilder out = new StringBuilder();
      for (byte b :
          MessageDigest.getInstance("SHA-256")
              .digest((base + "\n" + key).getBytes(java.nio.charset.StandardCharsets.UTF_8)))
        out.append(String.format(java.util.Locale.ROOT, "%02x", b));
      scope = out.toString();
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
    prefs = context.getSharedPreferences("update-" + scope, Context.MODE_PRIVATE);
    directory = new File(context.getFilesDir(), "updates");
    if (!directory.isDirectory()) directory.mkdirs();
    String saved = prefs.getString("offer", null);
    if (saved != null)
      try {
        JSONObject previous = new JSONObject(saved);
        offer = previous;
        if (BuildConfig.VERSION_CODE >= previous.getLong("versionCode")) {
          update = "success";
          ack(previous, "success", null);
        } else {
          File file = new File(directory, previous.getString("id") + ".apk");
          update = "validating";
          io.execute(
              () -> {
                try {
                  ApkValidator.validate(context.getPackageManager(), file, previous);
                  main.post(
                      () -> {
                        if (closed) return;
                        readyApk = file;
                        update = "awaiting_confirmation";
                        ack(previous, update, null);
                      });
                } catch (Exception e) {
                  fail(previous, e);
                }
              });
        }
      } catch (Exception e) {
        prefs.edit().clear().apply();
        update = "failed";
      }
  }

  String updateError() {
    return updateError;
  }

  String updateStatus() {
    return update;
  }

  void command(JSONObject command) {
    if (closed) return;
    String id = command.optString("id"), type = command.optString("type");
    if (!id.matches("[A-Za-z0-9_-]{1,128}")) return;
    if (handled.containsKey(id)) {
      String result =
          "update".equals(type) && offer != null && id.equals(offer.optString("id"))
              ? update
              : handled.get(id);
      if (!"capturing".equals(result)) ack(command, result, null);
      return;
    }
    if ("screenshot".equals(type)) screenshot(command);
    else if ("update".equals(type)) receiveUpdate(command);
  }

  private void remember(JSONObject command, String value) {
    handled.put(command.optString("id"), value);
    while (handled.size() > 100) handled.remove(handled.keySet().iterator().next());
  }

  private void screenshot(JSONObject command) {
    long elapsed = SystemClock.elapsedRealtime();
    if (lastCapture != 0 && elapsed - lastCapture < 5000) {
      remember(command, "failed");
      ack(command, "failed", "截屏请求过于频繁");
      return;
    }
    lastCapture = elapsed;
    remember(command, "capturing");
    final Bitmap bitmap;
    final long captured = System.currentTimeMillis();
    String programId = program.get(), mediaId = media.get();
    try {
      bitmap = wall.capture();
    } catch (Exception e) {
      fail(command, e);
      return;
    }
    io.execute(
        () -> {
          try {
            byte[] jpeg = jpeg(bitmap);
            api.upload(
                base,
                "/api/device/screenshots/" + command.optString("id"),
                key,
                jpeg,
                captured,
                programId,
                mediaId);
            main.post(
                () -> {
                  remember(command, "success");
                  ack(command, "success", null);
                });
          } catch (Exception e) {
            fail(command, e);
          } finally {
            bitmap.recycle();
          }
        });
  }

  static byte[] jpeg(Bitmap image) throws IOException {
    for (int quality = 85; quality >= 25; quality -= 10) {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      if (!image.compress(Bitmap.CompressFormat.JPEG, quality, out))
        throw new IOException("JPEG 编码失败");
      if (out.size() <= 256 * 1024) return out.toByteArray();
    }
    throw new IOException("截屏超过 256 KiB");
  }

  private void receiveUpdate(JSONObject command) {
    if (offer != null && command.optString("id").equals(offer.optString("id"))) {
      ack(command, update, null);
      return;
    }
    if ("downloading".equals(update) || "installing".equals(update)) {
      ack(command, "failed", "已有更新任务正在处理");
      return;
    }
    File previousApk = readyApk;
    if (previousApk != null) io.execute(previousApk::delete);
    installAttempt++;
    installPending = false;
    updateError = null;
    offer = command;
    readyApk = null;
    update = "available";
    remember(command, update);
    ack(command, update, null);
    io.execute(
        () -> {
          File part = new File(directory, command.optString("id") + ".part"),
              target = new File(directory, command.optString("id") + ".apk");
          try {
            ApkValidator.transport(base, BuildConfig.ALLOW_LAN_HTTP_UPDATES);
            ApkValidator.policy(command, Build.VERSION.SDK_INT, BuildConfig.VERSION_CODE);
            long size = command.getLong("size");
            if (directory.getUsableSpace() < size + 32L * 1024 * 1024)
              throw new IOException("APK 下载空间不足");
            update = "downloading";
            ack(command, update, null);
            OkHttpClient client =
                api.http
                    .newBuilder()
                    .callTimeout(0, TimeUnit.SECONDS)
                    .readTimeout(30, TimeUnit.SECONDS)
                    .build();
            download =
                client.newCall(
                    new Request.Builder()
                        .url(base + command.getString("url"))
                        .header("Authorization", "Bearer " + key)
                        .header("X-Mosaic-Capabilities", ApiClient.CAPABILITIES)
                        .build());
            try (Response r = download.execute()) {
              if (r.code() != 200 || r.body() == null)
                throw new IOException("APK 下载失败 HTTP " + r.code());
              try (InputStream in = r.body().byteStream();
                  FileOutputStream out = new FileOutputStream(part)) {
                byte[] b = new byte[65536];
                int n;
                long total = 0;
                while ((n = in.read(b)) != -1) {
                  if (closed) throw new InterruptedIOException();
                  total += n;
                  if (total > size) throw new IOException("APK 长度超限");
                  out.write(b, 0, n);
                }
                out.getFD().sync();
              }
            }
            ApkValidator.validate(context.getPackageManager(), part, command);
            if (!part.renameTo(target)) throw new IOException("APK 原子保存失败");
            prefs.edit().putString("offer", command.toString()).commit();
            main.post(
                () -> {
                  if (closed) return;
                  readyApk = target;
                  update = "awaiting_confirmation";
                  remember(command, update);
                  ack(command, update, null);
                  status.accept("更新已下载；按返回键，选择安装更新并确认");
                });
          } catch (Exception e) {
            fail(command, e);
          } finally {
            download = null;
            if (part.exists()) part.delete();
          }
        });
  }

  void offerInstall() {
    if (closed) return;
    if (installPending) {
      status.accept("正在向服务器确认安装授权，请稍后");
      return;
    }
    if ("validating".equals(update)) {
      status.accept("正在重新校验更新，请稍后");
      return;
    }
    if (offer == null || readyApk == null) {
      status.accept("尚无已校验的更新安装包");
      return;
    }
    if (System.currentTimeMillis() < offer.optLong("activateAt")) {
      status.accept("更新已准备，尚未到维护时间");
      return;
    }
    if (!(context instanceof Activity)) {
      status.accept("无法打开系统安装器");
      return;
    }
    if (Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls()) {
      status.accept("请允许 Mosaic 安装应用，返回后再次选择安装更新以获取新的服务器授权");
      ((Activity) context)
          .startActivity(
              new Intent(
                  Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                  Uri.parse("package:" + context.getPackageName())));
      return;
    }
    JSONObject installing = offer;
    File apk = readyApk;
    long attempt = ++installAttempt;
    installPending = true;
    updateError = null;
    io.execute(
        () -> {
          try {
            installValidator.validate(apk, installing);
            if (closed || attempt != installAttempt) return;
            // This is an authorization gate, never a fire-and-forget receipt. No cached grant is
            // reused.
            api.authorizeInstallation(
                base, key, installing.getString("id"), BuildConfig.VERSION_CODE);
            main.post(
                () -> {
                  if (closed || attempt != installAttempt || offer != installing) return;
                  installPending = false;
                  launchInstaller(apk, installing);
                });
          } catch (Exception e) {
            main.post(
                () -> {
                  if (closed || attempt != installAttempt) return;
                  installPending = false;
                  update = "awaiting_confirmation";
                  updateError =
                      "无法获得服务器安装授权：" + (e.getMessage() == null ? "服务器连接失败" : e.getMessage());
                  status.accept(updateError + "；未启动安装器，请检查更新任务和网络后重试");
                });
          }
        });
  }

  @SuppressWarnings("deprecation")
  private void launchInstaller(File apk, JSONObject command) {
    if (closed) return;
    try {
      // A settings round trip invalidates the flow; the next explicit selection must authorize
      // again.
      if (Build.VERSION.SDK_INT >= 26 && !context.getPackageManager().canRequestPackageInstalls()) {
        updateError = "安装来源权限已变化，请重新选择安装以获取新的安装授权";
        status.accept(updateError);
        return;
      }
      Activity activity = (Activity) context;
      Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".updates", apk);
      Intent intent =
          new Intent(Intent.ACTION_INSTALL_PACKAGE)
              .setDataAndType(uri, "application/vnd.android.package-archive")
              .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
              .putExtra(Intent.EXTRA_RETURN_RESULT, true);
      update = "installing";
      prefs.edit().putString("installing", command.optString("id")).commit();
      remember(command, update);
      // The preceding awaited HTTP200 already recorded installing on the server.
      activity.startActivityForResult(intent, INSTALL_REQUEST);
    } catch (Exception e) {
      fail(command, e);
    }
  }

  void installResult(int result) {
    if (offer == null) return;
    // Success is acknowledged only by a restarted process reporting the installed version.
    if (result == Activity.RESULT_CANCELED) {
      update = "cancelled";
      remember(offer, update);
      ack(offer, update, null);
      status.accept("已取消安装，播放将继续；可再次选择安装");
    } else if (result != Activity.RESULT_OK) {
      update = "failed";
      ack(offer, update, "系统安装器未完成安装");
    }
  }

  private void fail(JSONObject command, Exception e) {
    main.post(
        () -> {
          if (closed) return;
          String error = e.getMessage() == null ? "操作失败" : e.getMessage();
          remember(command, "failed");
          if ("update".equals(command.optString("type"))) update = "failed";
          ack(command, "failed", error);
          status.accept(error);
        });
  }

  private void ack(JSONObject command, String state, String error) {
    if (closed) return;
    JSONObject body = new JSONObject();
    Protocol.put(body, "status", state);
    Protocol.put(body, "versionCode", BuildConfig.VERSION_CODE);
    if (error != null) Protocol.put(body, "error", error);
    try {
      receipts.execute(
          () -> {
            try {
              api.json(base, "/api/device/commands/" + command.optString("id"), key, body);
            } catch (Exception ignored) {
              /* Polling resends the command and retries its receipt. */
            }
          });
    } catch (RejectedExecutionException ignored) {
    }
  }

  @Override
  public void close() {
    closed = true;
    installAttempt++;
    installPending = false;
    if (download != null) download.cancel();
    io.shutdownNow();
    receipts.shutdown();
  }
}
