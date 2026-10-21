package local.mosaic.tv;

import static org.junit.Assert.*;

import android.graphics.*;
import android.os.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.*;
import okhttp3.mockwebserver.*;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
@LooperMode(LooperMode.Mode.PAUSED)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class PlaybackProgramIntegrationTest {
  String digest(byte[] data) throws Exception {
    StringBuilder out = new StringBuilder();
    for (byte b : MessageDigest.getInstance("SHA-256").digest(data))
      out.append(String.format(java.util.Locale.ROOT, "%02x", b));
    return out.toString();
  }

  @Test
  public void pendingFirstImageIsDecodedBeforeReadyAndSurvivesFutureCommit() throws Exception {
    Bitmap original = Bitmap.createBitmap(16, 9, Bitmap.Config.ARGB_8888);
    original.eraseColor(Color.BLUE);
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    original.compress(Bitmap.CompressFormat.PNG, 100, bytes);
    original.recycle();
    byte[] png = bytes.toByteArray();
    long epoch = System.currentTimeMillis();
    JSONObject manifest =
        new JSONObject()
            .put("id", "manifest")
            .put("versionId", "version")
            .put("activateAt", epoch)
            .put("validUntil", epoch + 86400000L)
            .put(
                "defaultProgram",
                new JSONObject()
                    .put(
                        "playlist",
                        new JSONArray()
                            .put(new JSONObject().put("mediaId", "b").put("durationMs", 10000)))
                    .put("music", new JSONArray())
                    .put("audioMode", "muted"))
            .put("intervals", new JSONArray());
    JSONArray media = new JSONArray();
    for (String id : new String[] {"a", "b"})
      media.put(
          new JSONObject()
              .put("id", id)
              .put("type", "image")
              .put("name", id)
              .put("width", 16)
              .put("height", 9)
              .put("size", png.length)
              .put("sha256", digest(png)));
    JSONObject state =
        new JSONObject()
            .put(
                "layout",
                new JSONObject()
                    .put("cols", 1)
                    .put("rows", 1)
                    .put("tileWidth", 16)
                    .put("tileHeight", 9)
                    .put("gapX", 0)
                    .put("gapY", 0)
                    .put(
                        "screens",
                        new JSONArray()
                            .put(new JSONObject().put("id", "screen").put("row", 0).put("col", 0))))
            .put("media", media)
            .put(
                "playback",
                new JSONObject()
                    .put("mediaId", "a")
                    .put("epoch", epoch - 1000)
                    .put("paused", false)
                    .put("position", 0)
                    .put("revision", 1)
                    .put("preparationId", "legacy-deployment"))
            .put(
                "pendingProgram",
                new JSONObject().put("id", "deployment").put("program", manifest));
    BlockingQueue<JSONObject> ready = new LinkedBlockingQueue<>();
    WebSocket[] socket = new WebSocket[1];
    try (MockWebServer server = new MockWebServer()) {
      server.setDispatcher(
          new okhttp3.mockwebserver.Dispatcher() {
            @Override
            public MockResponse dispatch(RecordedRequest request) {
              try {
                if (request.getPath().equals("/ws"))
                  return new MockResponse()
                      .withWebSocketUpgrade(
                          new WebSocketListener() {
                            @Override
                            public void onOpen(WebSocket ws, Response r) {
                              socket[0] = ws;
                            }

                            @Override
                            public void onMessage(WebSocket ws, String value) {
                              try {
                                JSONObject msg = new JSONObject(value);
                                if ("clock".equals(msg.optString("type")))
                                  ws.send(
                                      new JSONObject()
                                          .put("type", "clock")
                                          .put("id", msg.getLong("id"))
                                          .put("serverTime", System.currentTimeMillis())
                                          .toString());
                                if ("ready".equals(msg.optString("type"))) ready.add(msg);
                              } catch (Exception e) {
                                throw new RuntimeException(e);
                              }
                            }
                          });
                if (request.getPath().startsWith("/media/"))
                  return new MockResponse().setBody(new okio.Buffer().write(png));
                return new MockResponse()
                    .setBody(
                        new JSONObject()
                            .put("state", state)
                            .put("serverTime", System.currentTimeMillis())
                            .toString());
              } catch (Exception e) {
                throw new RuntimeException(e);
              }
            }
          });
      server.start();
      WallView wall = new WallView(RuntimeEnvironment.getApplication());
      wall.layout(0, 0, 1920, 1080);
      PlaybackEngine engine =
          new PlaybackEngine(
              RuntimeEnvironment.getApplication(),
              wall,
              server.url("/").toString().replaceAll("/$", ""),
              "key",
              "screen",
              new PlaybackEngine.Events() {
                public void status(String s) {}

                public void connected() {}

                public void contentVisible(boolean v) {}

                public void diagnostics(String s) {}
              });
      engine.start();
      long end = System.currentTimeMillis() + 5000;
      while (ready.isEmpty() && System.currentTimeMillis() < end) {
        Shadows.shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(20));
        Thread.sleep(10);
      }
      assertEquals("deployment", Objects.requireNonNull(ready.poll()).getString("id"));
      Object prepared = org.robolectric.util.ReflectionHelpers.getField(engine, "prepared");
      assertNotNull("new renderer remains staged", prepared);
      assertTrue(org.robolectric.util.ReflectionHelpers.getField(prepared, "ready"));
      SyncTransport transport =
          org.robolectric.util.ReflectionHelpers.getField(engine, "transport");
      assertEquals(
          "legacy-deployment",
          org.robolectric.util.ReflectionHelpers.getField(engine, "displayedPreparationId"));
      assertEquals(
          1L,
          (long)
              org.robolectric.util.ReflectionHelpers.getField(engine, "displayedPlaybackRevision"));
      state
          .getJSONObject("playback")
          .put("epoch", (long) transport.now() + 200)
          .put("revision", 2)
          .put("preparationId", "legacy-replay");
      engine.state(state);
      assertEquals(
          "legacy-deployment",
          org.robolectric.util.ReflectionHelpers.getField(engine, "displayedPreparationId"));
      Shadows.shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(400));
      assertEquals(
          "legacy-replay",
          org.robolectric.util.ReflectionHelpers.getField(engine, "displayedPreparationId"));
      assertEquals(
          2L,
          (long)
              org.robolectric.util.ReflectionHelpers.getField(engine, "displayedPlaybackRevision"));

      wall.measure(android.view.View.MeasureSpec.makeMeasureSpec(1920, android.view.View.MeasureSpec.EXACTLY), android.view.View.MeasureSpec.makeMeasureSpec(1080, android.view.View.MeasureSpec.EXACTLY));
      wall.layout(0, 0, 1920, 1080);
      manifest.put("activateAt", (long) transport.now() + 500);
      state.put("program", manifest);
      state.remove("pendingProgram");
      engine.state(state);
      assertSame(
          "commit preserves staged renderer before epoch",
          prepared,
          org.robolectric.util.ReflectionHelpers.getField(engine, "prepared"));
      Shadows.shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(700));
      assertEquals(
          "manifest",
          org.robolectric.util.ReflectionHelpers.getField(engine, "displayedProgramId"));
      engine.close();
    }
  }
}
