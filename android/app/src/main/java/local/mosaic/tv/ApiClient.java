package local.mosaic.tv;

import java.io.*;
import java.util.concurrent.TimeUnit;
import okhttp3.*;
import org.json.*;

public final class ApiClient {
  public static final String CAPABILITIES = "programs,audio,screenshot,updates";

  public static final class HttpError extends IOException {
    public final int code;

    HttpError(int code, String message) {
      super(message);
      this.code = code;
    }
  }

  public final OkHttpClient http;

  public ApiClient() {
    http =
        new OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .pingInterval(10, TimeUnit.SECONDS)
            .callTimeout(12, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build();
  }

  public JSONObject json(String base, String path, String key, JSONObject post)
      throws IOException, JSONException {
    return requestJson(base, path, key, post, 0);
  }

  private JSONObject requestJson(
      String base, String path, String key, JSONObject post, int expectedStatus)
      throws IOException, JSONException {
    Request.Builder b =
        new Request.Builder().url(base + path).header("X-Mosaic-Capabilities", CAPABILITIES);
    if (key != null) b.header("Authorization", "Bearer " + key);
    if (post != null)
      b.post(RequestBody.create(post.toString(), MediaType.get("application/json")));
    try (Response r = http.newCall(b.build()).execute()) {
      if (expectedStatus != 0 && (!r.isSuccessful() || r.code() != expectedStatus)) {
        String detail = "服务器拒绝安装授权 HTTP " + r.code();
        try {
          String reason = new JSONObject(r.peekBody(4096).string()).optString("error", "");
          if (!reason.isEmpty())
            detail += "：" + reason.substring(0, Math.min(500, reason.length()));
        } catch (JSONException ignored) {
        }
        throw new HttpError(r.code(), detail);
      }
      if (!r.isSuccessful())
        throw new HttpError(
            r.code(),
            r.code() == 409
                ? "该屏幕已被占用，请选择其他屏幕"
                : r.code() == 401
                    ? "配对已失效，请重新选择屏幕"
                    : r.code() == 403 ? "后台尚未开启局域网发布" : "服务器返回 HTTP " + r.code());
      if (r.body() == null) throw new IOException("空响应");
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buffer = new byte[8192];
      int count;
      try (InputStream in = r.body().byteStream()) {
        while ((count = in.read(buffer)) != -1) {
          out.write(buffer, 0, count);
          if (out.size() > 1024 * 1024) throw new IOException("响应过大");
        }
      }
      return new JSONObject(out.toString("UTF-8"));
    }
  }

  public JSONObject catalog(String base) throws Exception {
    JSONObject result = json(base, "/api/discovery", null, null);
    if (!"mosaic-player".equals(result.optString("service"))
        || result.optInt("protocolVersion") < 1
        || result.optInt("protocolVersion") > 2) throw new IOException("该地址不是兼容的 Mosaic 服务器");
    return result;
  }

  public void authorizeInstallation(String base, String key, String commandId, int currentVersion)
      throws IOException, JSONException {
    JSONObject body = new JSONObject();
    Protocol.put(body, "status", "installing");
    Protocol.put(body, "versionCode", currentVersion);
    JSONObject result = requestJson(base, "/api/device/commands/" + commandId, key, body, 200);
    if (!Boolean.TRUE.equals(result.opt("ok"))) throw new IOException("服务器没有确认安装授权");
  }

  public JSONObject deviceState(String base, String key) throws IOException, JSONException {
    try {
      return json(base, "/api/device/state", key, null);
    } catch (HttpError e) {
      if (e.code != 404) throw e;
      return json(base, "/api/state", key, null);
    }
  }

  public void upload(
      String base,
      String path,
      String key,
      byte[] jpeg,
      long captured,
      String program,
      String media)
      throws IOException {
    Request request =
        new Request.Builder()
            .url(base + path)
            .header("Authorization", "Bearer " + key)
            .header("X-Mosaic-Capabilities", CAPABILITIES)
            .header("X-Captured-At", Long.toString(captured))
            .header("X-Capture-Method", "android-textureview-imageview-crop")
            .header("X-Program-Id", program == null ? "" : program)
            .header("X-Media-Id", media == null ? "" : media)
            .post(RequestBody.create(jpeg, MediaType.get("image/jpeg")))
            .build();
    try (Response r = http.newCall(request).execute()) {
      if (!r.isSuccessful()) throw new IOException("截屏上传失败 HTTP " + r.code());
    }
  }

  public void close() {
    http.dispatcher().cancelAll();
    http.connectionPool().evictAll();
    http.dispatcher().executorService().shutdown();
  }
}
