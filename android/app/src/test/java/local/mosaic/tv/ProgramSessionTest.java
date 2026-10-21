package local.mosaic.tv;

import static org.junit.Assert.*;

import android.os.*;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.*;
import java.util.function.BooleanSupplier;
import okhttp3.mockwebserver.*;
import org.json.*;
import org.junit.*;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
@LooperMode(LooperMode.Mode.PAUSED)
public class ProgramSessionTest {
  @Rule public TemporaryFolder temp = new TemporaryFolder();

  String digest(String value) throws Exception {
    StringBuilder out = new StringBuilder();
    for (byte b :
        MessageDigest.getInstance("SHA-256")
            .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)))
      out.append(String.format(java.util.Locale.ROOT, "%02x", b));
    return out.toString();
  }

  JSONObject manifest(String id, String media, long epoch) throws Exception {
    return new JSONObject()
        .put("id", id)
        .put("versionId", id)
        .put("activateAt", epoch)
        .put("validUntil", 60000)
        .put(
            "defaultProgram",
            new JSONObject()
                .put(
                    "playlist",
                    new JSONArray()
                        .put(new JSONObject().put("mediaId", media).put("durationMs", 3000)))
                .put("music", new JSONArray())
                .put("audioMode", "muted"))
        .put("intervals", new JSONArray());
  }

  JSONObject envelope(JSONObject program) throws Exception {
    return new JSONObject()
        .put("layout", new JSONObject())
        .put("program", program)
        .put("playback", new JSONObject())
        .put(
            "media",
            new JSONArray()
                .put(new JSONObject().put("id", "a").put("size", 3).put("sha256", digest("aaa")))
                .put(new JSONObject().put("id", "b").put("size", 3).put("sha256", digest("bbb"))));
  }

  void await(BooleanSupplier condition) throws Exception {
    long end = System.currentTimeMillis() + 5000;
    while (!condition.getAsBoolean() && System.currentTimeMillis() < end) {
      Shadows.shadowOf(Looper.getMainLooper()).idle();
      Thread.sleep(10);
    }
    Shadows.shadowOf(Looper.getMainLooper()).idle();
    assertTrue("worker completion", condition.getAsBoolean());
  }

  @Test
  public void fullPreparationRetainsOldUntilEpochAndPersistsOffline() throws Exception {
    try (MockWebServer server = new MockWebServer()) {
      server.start();
      ApiClient api = new ApiClient();
      File directory = temp.newFolder(), media = temp.newFolder();
      String base = server.url("/").toString().replaceAll("/$", "");
      MediaCache cache = new MediaCache(media, api, base, "key");
      List<String> ready = new ArrayList<>(), failures = new ArrayList<>();
      ProgramSession.Events events =
          new ProgramSession.Events() {
            public void ready(String id) {
              ready.add(id);
            }

            public void failed(String id, String error) {
              failures.add(id);
            }

            public void status(String value) {}
          };
      ProgramSession session =
          new ProgramSession(
              directory, cache, "scope", new Handler(Looper.getMainLooper()), events);
      server.enqueue(new MockResponse().setBody("aaa"));
      JSONObject first = envelope(manifest("one", "a", 10000));
      session.accept(first);
      await(
          () -> {
            try {
              return session.render(11000) != null;
            } catch (Exception e) {
              return false;
            }
          });
      assertEquals("a", session.selection(11000).visual.mediaId);
      server.enqueue(new MockResponse().setBody("bbb"));
      JSONObject pending =
          envelope(manifest("one", "a", 10000))
              .put(
                  "pendingProgram",
                  new JSONObject()
                      .put("id", "deployment")
                      .put("program", manifest("two", "b", 20000)));
      session.accept(pending);
      await(() -> ready.contains("deployment"));
      assertTrue(failures.isEmpty());
      assertEquals("a", session.selection(15000).visual.mediaId);
      session.accept(envelope(manifest("two", "b", 20000)));
      session.render(19999);
      assertEquals("one", session.programId());
      session.render(20000);
      assertEquals("two", session.programId());
      assertEquals("b", session.selection(20000).visual.mediaId);
      await(
          () -> {
            File[] files = directory.listFiles((d, n) -> n.endsWith(".json"));
            if (files == null || files.length != 1) return false;
            try {
              return new String(
                      java.nio.file.Files.readAllBytes(files[0].toPath()),
                      java.nio.charset.StandardCharsets.UTF_8)
                  .contains("two");
            } catch (Exception e) {
              return false;
            }
          });
      session.close();
      AtomicBoolean restored = new AtomicBoolean();
      ProgramSession offline =
          new ProgramSession(
              directory, cache, "scope", new Handler(Looper.getMainLooper()), events);
      offline.restore(() -> restored.set(true));
      await(restored::get);
      assertEquals("two", offline.programId());
      assertEquals(2, server.getRequestCount());
      offline.close();
      api.close();
    }
  }

  @Test
  public void corruptPendingNeverAcknowledgedReadyAndKeepsCurrent() throws Exception {
    try (MockWebServer server = new MockWebServer()) {
      server.start();
      ApiClient api = new ApiClient();
      MediaCache cache =
          new MediaCache(
              temp.newFolder(), api, server.url("/").toString().replaceAll("/$", ""), "key");
      List<String> failures = new ArrayList<>(), ready = new ArrayList<>();
      ProgramSession session =
          new ProgramSession(
              temp.newFolder(),
              cache,
              "scope",
              new Handler(Looper.getMainLooper()),
              new ProgramSession.Events() {
                public void ready(String id) {
                  ready.add(id);
                }

                public void failed(String id, String error) {
                  failures.add(id);
                }

                public void status(String value) {}
              });
      server.enqueue(new MockResponse().setBody("aaa"));
      session.accept(envelope(manifest("one", "a", 10000)));
      await(
          () -> {
            try {
              return session.render(11000) != null;
            } catch (Exception e) {
              return false;
            }
          });
      server.enqueue(new MockResponse().setBody("bad"));
      session.accept(
          envelope(manifest("one", "a", 10000))
              .put(
                  "pendingProgram",
                  new JSONObject()
                      .put("id", "bad-deployment")
                      .put("program", manifest("two", "b", 20000))));
      await(() -> failures.contains("bad-deployment"));
      assertTrue(ready.isEmpty());
      assertEquals("a", session.selection(25000).visual.mediaId);
      session.close();
      api.close();
    }
  }
}
