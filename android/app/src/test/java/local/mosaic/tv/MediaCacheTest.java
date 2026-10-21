package local.mosaic.tv;

import static org.junit.Assert.*;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import okhttp3.mockwebserver.*;
import org.json.JSONObject;
import org.junit.*;
import org.junit.rules.TemporaryFolder;

public class MediaCacheTest {
  @Rule public TemporaryFolder folder = new TemporaryFolder();
  private MockWebServer server;
  private ApiClient api;

  @Before
  public void start() throws Exception {
    server = new MockWebServer();
    server.start();
    api = new ApiClient();
  }

  @After
  public void stop() throws Exception {
    api.close();
    server.shutdown();
  }

  private String base() {
    String s = server.url("/").toString();
    return s.substring(0, s.length() - 1);
  }

  private JSONObject media(String id, int size) throws Exception {
    return new JSONObject().put("id", id).put("size", size);
  }

  @Test
  public void authenticatedAtomicDownloadAndCacheHit() throws Exception {
    server.enqueue(new MockResponse().setBody("test-content"));
    File dir = folder.newFolder();
    MediaCache cache = new MediaCache(dir, api, base(), "device-secret");
    File file = cache.fetch(media("test", 12), Collections.emptySet());
    assertEquals(
        "test-content",
        new String(Files.readAllBytes(file.toPath()), java.nio.charset.StandardCharsets.UTF_8));
    RecordedRequest request = server.takeRequest();
    assertEquals("Bearer device-secret", request.getHeader("Authorization"));
    assertEquals("/media/test", request.getPath());
    assertFalse(file.getName().contains("secret"));
    assertEquals(file, cache.fetch(media("test", 12), Collections.emptySet()));
    assertEquals(1, server.getRequestCount());
    assertEquals(1, dir.listFiles().length);
  }

  @Test
  public void incompleteDownloadNeverBecomesPlayable() throws Exception {
    server.enqueue(new MockResponse().setBody("short"));
    File dir = folder.newFolder();
    MediaCache cache = new MediaCache(dir, api, base(), "key");
    try {
      cache.fetch(media("test", 20), Collections.emptySet());
      fail();
    } catch (IOException expected) {
      assertTrue(expected.getMessage().contains("不完整"));
    }
    assertEquals(0, dir.listFiles().length);
  }

  @Test
  public void redirectsDoNotLeakDeviceCredential() throws Exception {
    try (MockWebServer other = new MockWebServer()) {
      other.start();
      server.enqueue(
          new MockResponse().setResponseCode(302).addHeader("Location", other.url("/steal")));
      File dir = folder.newFolder();
      try {
        new MediaCache(dir, api, base(), "private-key")
            .fetch(media("test", 12), Collections.emptySet());
        fail();
      } catch (IOException expected) {
      }
      assertEquals(0, other.getRequestCount());
      assertEquals(0, dir.listFiles().length);
    }
  }

  @Test
  public void invalidMediaIdsCannotEscapeMediaRoute() throws Exception {
    try {
      new MediaCache(folder.newFolder(), api, base(), "key")
          .fetch(media("../api/state", 12), Collections.emptySet());
      fail();
    } catch (IOException expected) {
    }
    assertEquals(0, server.getRequestCount());
  }
}
