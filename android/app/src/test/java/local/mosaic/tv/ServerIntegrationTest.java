package local.mosaic.tv;

import static org.junit.Assert.*;

import java.io.*;
import java.net.ServerSocket;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.function.BooleanSupplier;
import okhttp3.*;
import org.json.*;
import org.junit.*;
import org.junit.rules.TemporaryFolder;

public class ServerIntegrationTest {
  @Rule public TemporaryFolder folder = new TemporaryFolder();
  private Process server;
  private ApiClient api;
  private String base;
  private final String admin = "android-integration-admin";
  private final List<SyncTransport> peers = new ArrayList<>();

  private void waitFor(BooleanSupplier check) throws Exception {
    long until = System.currentTimeMillis() + 10000;
    while (System.currentTimeMillis() < until) {
      if (check.getAsBoolean()) return;
      Thread.sleep(25);
    }
    fail("Timed out waiting for protocol condition");
  }

  @Before
  public void start() throws Exception {
    api = new ApiClient();
    int port;
    try (ServerSocket s = new ServerSocket(0)) {
      port = s.getLocalPort();
    }
    base = "http://127.0.0.1:" + port;
    ProcessBuilder b =
        new ProcessBuilder("node", "server.js")
            .directory(new File(System.getProperty("mosaic.projectRoot")));
    b.environment().put("PORT", String.valueOf(port));
    b.environment().put("PLAYER_DATA_DIR", folder.newFolder().getPath());
    b.environment().put("PLAYER_ADMIN_TOKEN", admin);
    b.environment().put("PLAYER_DISCOVERY_ADVERTISE", "0");
    b.redirectErrorStream(true).redirectOutput(new File(folder.getRoot(), "server.log"));
    server = b.start();
    waitFor(
        () -> {
          try {
            return api.catalog(base).has("service");
          } catch (Exception e) {
            return false;
          }
        });
  }

  @After
  public void stop() throws Exception {
    for (SyncTransport p : peers) p.close();
    if (api != null) api.close();
    if (server != null) {
      server.destroy();
      if (!server.waitFor(5, TimeUnit.SECONDS)) server.destroyForcibly();
    }
  }

  private JSONObject request(String method, String path, JSONObject data) throws Exception {
    RequestBody body =
        data == null
            ? null
            : RequestBody.create(data.toString(), MediaType.get("application/json"));
    Request.Builder builder =
        new Request.Builder()
            .url(base + path)
            .header("Authorization", "Bearer " + admin)
            .method(method, body);
    try (Response r = api.http.newCall(builder.build()).execute()) {
      assertTrue("HTTP " + r.code(), r.isSuccessful());
      return new JSONObject(r.body().string());
    }
  }

  private SyncTransport peer(String id, String key, AtomicReference<JSONObject> state) {
    SyncTransport t =
        new SyncTransport(
            api,
            base,
            key,
            id,
            Runnable::run,
            () -> System.nanoTime() / 1000000,
            new SyncTransport.Listener() {
              public void state(JSONObject s) {
                state.set(s);
              }

              public void connection(boolean online, String detail) {}
            });
    peers.add(t);
    t.start();
    return t;
  }

  @Test
  public void twoTelevisionsPairPrepareShareEpochPauseAndResume() throws Exception {
    assertFalse(api.catalog(base).getBoolean("published"));
    request("PUT", "/api/publication", new JSONObject().put("enabled", true));
    JSONArray screens = api.catalog(base).getJSONArray("screens");
    assertTrue(screens.length() >= 2);
    JSONObject
        pair1 =
            api.json(
                base,
                "/api/pair",
                null,
                new JSONObject().put("screenId", screens.getJSONObject(0).getString("id"))),
        pair2 =
            api.json(
                base,
                "/api/pair",
                null,
                new JSONObject().put("screenId", screens.getJSONObject(1).getString("id")));
    AtomicReference<JSONObject> state1 = new AtomicReference<>(), state2 = new AtomicReference<>();
    SyncTransport one = peer(pair1.getString("screenId"), pair1.getString("key"), state1),
        two = peer(pair2.getString("screenId"), pair2.getString("key"), state2);
    waitFor(
        () ->
            one.clock.ready() && two.clock.ready() && state1.get() != null && state2.get() != null);
    assertTrue(Math.abs(one.now() - two.now()) < 50);
    one.send(
        Protocol.put(
            Protocol.put(Protocol.message("report"), "client", "android-tv"), "status", "idle"));
    waitFor(
        () -> {
          try {
            return request("GET", "/api/state", null)
                    .getJSONArray("devices")
                    .getJSONObject(0)
                    .optJSONObject("report")
                != null;
          } catch (Exception e) {
            return false;
          }
        });
    assertEquals(
        "android-tv",
        request("GET", "/api/state", null)
            .getJSONArray("devices")
            .getJSONObject(0)
            .getJSONObject("report")
            .getString("client"));
    try {
      api.json(
          base, "/api/pair", null, new JSONObject().put("screenId", pair1.getString("screenId")));
      fail("Occupied screen paired again");
    } catch (IOException expected) {
      assertTrue(expected.getMessage().contains("占用"));
    }
    File png = new File(folder.getRoot(), "fixture.png");
    Process ffmpeg =
        new ProcessBuilder(
                "ffmpeg",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc=size=640x360",
                "-frames:v",
                "1",
                png.getPath())
            .redirectErrorStream(true)
            .redirectOutput(new File(folder.getRoot(), "ffmpeg.log"))
            .start();
    assertTrue(ffmpeg.waitFor(10, TimeUnit.SECONDS));
    assertEquals(0, ffmpeg.exitValue());
    MultipartBody upload =
        new MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart(
                "file", "test.png", RequestBody.create(png, MediaType.get("image/png")))
            .build();
    JSONObject media;
    try (Response r =
        api.http
            .newCall(
                new Request.Builder()
                    .url(base + "/api/media")
                    .header("Authorization", "Bearer " + admin)
                    .post(upload)
                    .build())
            .execute()) {
      assertEquals(201, r.code());
      media = new JSONObject(r.body().string());
    }
    File cached =
        new MediaCache(folder.newFolder(), api, base, pair1.getString("key"))
            .fetch(media, Collections.emptySet());
    assertEquals(png.length(), cached.length());
    request(
        "POST",
        "/api/playback",
        new JSONObject().put("action", "play").put("mediaId", media.getString("id")));
    waitFor(
        () ->
            state1.get().optJSONObject("pending") != null
                && state2.get().optJSONObject("pending") != null);
    String pending = state1.get().getJSONObject("pending").getString("id");
    one.send(Protocol.put(Protocol.message("ready"), "id", pending));
    Thread.sleep(200);
    assertNotNull(
        request("GET", "/api/state", null).getJSONObject("state").optJSONObject("pending"));
    two.send(Protocol.put(Protocol.message("ready"), "id", pending));
    waitFor(
        () ->
            state1.get().optJSONObject("pending") == null
                && state2.get().optJSONObject("pending") == null);
    JSONObject p1 = state1.get().getJSONObject("playback"),
        p2 = state2.get().getJSONObject("playback");
    assertEquals(p1.getLong("epoch"), p2.getLong("epoch"));
    assertTrue(p1.getLong("epoch") > one.now() + 1000);
    request("POST", "/api/playback", new JSONObject().put("action", "pause"));
    waitFor(
        () ->
            state1.get().optJSONObject("playback").optBoolean("paused")
                && state2.get().optJSONObject("playback").optBoolean("paused"));
    request("POST", "/api/playback", new JSONObject().put("action", "resume"));
    waitFor(
        () ->
            !state1.get().optJSONObject("playback").optBoolean("paused")
                && !state2.get().optJSONObject("playback").optBoolean("paused"));
    assertEquals(
        state1.get().getJSONObject("playback").getLong("epoch"),
        state2.get().getJSONObject("playback").getLong("epoch"));
  }
}
