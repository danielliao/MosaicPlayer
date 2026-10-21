package local.mosaic.tv;

import static org.junit.Assert.*;

import android.content.pm.Signature;
import android.graphics.*;
import android.view.View;
import java.io.*;
import java.util.*;
import okhttp3.mockwebserver.*;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.annotation.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class CommercialOperationsTest {
  JSONObject offer() throws Exception {
    return new JSONObject()
        .put("id", "task")
        .put("type", "update")
        .put("packageName", "local.mosaic.tv")
        .put("versionCode", 4)
        .put("minSdk", 23)
        .put("size", 3)
        .put("sha256", "a".repeat(64))
        .put("url", "/api/device/updates/task/apk");
  }

  @Test
  public void rejectsPackageDowngradeSdkAndCrossOrigin() throws Exception {
    JSONObject command = offer();
    ApkValidator.policy(command, 23, 3);
    assertThrows(IOException.class, () -> ApkValidator.policy(command, 22, 3));
    assertThrows(IOException.class, () -> ApkValidator.policy(command, 28, 4));
    command.put("packageName", "other.app");
    assertThrows(IOException.class, () -> ApkValidator.policy(command, 28, 3));
    command.put("packageName", "local.mosaic.tv").put("url", "https://other.example/apk");
    assertThrows(IOException.class, () -> ApkValidator.policy(command, 28, 3));
  }

  @Test
  public void rejectsCurrentSignerMismatchAndCorruptHash() throws Exception {
    Signature one = new Signature(new byte[] {1, 2}), two = new Signature(new byte[] {3, 4});
    assertTrue(ApkValidator.sameSigners(new Signature[] {one, two}, new Signature[] {two, one}));
    assertFalse(ApkValidator.sameSigners(new Signature[] {one}, new Signature[] {two}));
    assertFalse(ApkValidator.sameSigners(null, new Signature[] {one}));
    File file = File.createTempFile("apk-data", ".apk");
    try (FileOutputStream out = new FileOutputStream(file)) {
      out.write(new byte[] {1, 2, 3});
    }
    JSONObject command = offer();
    assertThrows(IOException.class, () -> ApkValidator.file(file, command));
    command.put("sha256", MediaCache.sha256(file));
    ApkValidator.file(file, command);
    command.put("size", 4);
    assertThrows(IOException.class, () -> ApkValidator.file(file, command));
    file.delete();
  }

  @Test
  public void capturesActualSecondImageTileAndFailsWithoutContent() throws Exception {
    WallView wall = new WallView(RuntimeEnvironment.getApplication());
    assertThrows(IOException.class, wall::capture);
    Bitmap source = Bitmap.createBitmap(400, 100, Bitmap.Config.ARGB_8888);
    Canvas paint = new Canvas(source);
    paint.drawColor(Color.RED);
    Paint blue = new Paint();
    blue.setColor(Color.BLUE);
    paint.drawRect(200, 0, 400, 100, blue);
    JSONObject layout =
        new JSONObject().put("cols", 2).put("rows", 1).put("tileWidth", 200).put("tileHeight", 100);
    wall.configure(layout, new JSONObject().put("row", 0).put("col", 1), 400, 100);
    wall.showImage(source);
    int w = View.MeasureSpec.makeMeasureSpec(200, View.MeasureSpec.EXACTLY),
        h = View.MeasureSpec.makeMeasureSpec(100, View.MeasureSpec.EXACTLY);
    wall.measure(w, h);
    wall.layout(0, 0, 200, 100);
    wall.forceLayout();
    wall.measure(w, h);
    wall.layout(0, 0, 200, 100);
    android.widget.FrameLayout viewport = (android.widget.FrameLayout) wall.getChildAt(0);
    android.widget.ImageView picture = (android.widget.ImageView) viewport.getChildAt(1);
    assertEquals("source pixel", Color.BLUE, source.getPixel(300, 50));
    assertEquals("viewport", 200, viewport.getWidth());
    assertEquals("image width", 200, picture.getWidth());
    assertEquals("image height", 100, picture.getHeight());
    Bitmap capture = wall.capture();
    assertEquals(Color.BLUE, capture.getPixel(100, 50));
    assertTrue(DeviceOperations.jpeg(capture).length <= 256 * 1024);
    capture.recycle();
    source.recycle();
  }

  @Test
  public void capabilityAndScreenshotHeadersAreAuthenticated() throws Exception {
    try (MockWebServer server = new MockWebServer()) {
      server.enqueue(
          new MockResponse()
              .setBody("{service:'mosaic-player',protocolVersion:2,pairingRequired:true}"));
      server.enqueue(new MockResponse().setBody("{}"));
      server.start();
      ApiClient api = new ApiClient();
      String base = server.url("/").toString().replaceAll("/$", "");
      assertTrue(api.catalog(base).getBoolean("pairingRequired"));
      assertEquals(ApiClient.CAPABILITIES, server.takeRequest().getHeader("X-Mosaic-Capabilities"));
      api.upload(
          base,
          "/api/device/screenshots/request",
          "test-device",
          new byte[] {1, 2},
          123,
          "program",
          "media");
      RecordedRequest request = server.takeRequest();
      assertEquals("Bearer test-device", request.getHeader("Authorization"));
      assertEquals("123", request.getHeader("X-Captured-At"));
      assertEquals("program", request.getHeader("X-Program-Id"));
      assertEquals("image/jpeg", request.getHeader("Content-Type"));
      api.close();
    }
  }

  @Test
  public void readsMinimumSdkFromLocallyBuiltApk() throws Exception {
    File apk =
        new File(
            System.getProperty("mosaic.projectRoot"),
            "android/app/build/outputs/apk/debug/app-debug.apk");
    assertTrue("locally built test APK exists", apk.isFile());
    assertEquals(23, ApkValidator.minimumSdk(apk));
  }

  @Test
  public void apkTransportNeedsHttpsOrExplicitPrivateLanPolicy() throws Exception {
    ApkValidator.transport("https://example.com", false);
    assertThrows(
        IOException.class, () -> ApkValidator.transport("http://192.168.1.10:3210", false));
    ApkValidator.transport("http://192.168.1.10:3210", true);
    assertThrows(
        IOException.class, () -> ApkValidator.transport("http://public.example.com", true));
  }

  @Test
  public void screenshotCommandUploadsRenderedPixelsBeforeAcknowledging() throws Exception {
    WallView wall = new WallView(RuntimeEnvironment.getApplication());
    Bitmap original = Bitmap.createBitmap(400, 100, Bitmap.Config.ARGB_8888);
    original.eraseColor(Color.BLUE);
    wall.configure(
        new JSONObject().put("cols", 1).put("rows", 1).put("tileWidth", 400).put("tileHeight", 100),
        new JSONObject().put("row", 0).put("col", 0),
        400,
        100);
    wall.showImage(original);
    int width = View.MeasureSpec.makeMeasureSpec(400, View.MeasureSpec.EXACTLY),
        height = View.MeasureSpec.makeMeasureSpec(100, View.MeasureSpec.EXACTLY);
    wall.measure(width, height);
    wall.layout(0, 0, 400, 100);
    wall.forceLayout();
    wall.measure(width, height);
    wall.layout(0, 0, 400, 100);
    try (MockWebServer server = new MockWebServer()) {
      server.enqueue(new MockResponse().setBody("{}"));
      server.enqueue(new MockResponse().setBody("{}"));
      server.start();
      ApiClient api = new ApiClient();
      DeviceOperations ops =
          new DeviceOperations(
              RuntimeEnvironment.getApplication(),
              wall,
              api,
              server.url("/").toString().replaceAll("/$", ""),
              "screenshot-device",
              new android.os.Handler(android.os.Looper.getMainLooper()),
              v -> {},
              () -> "manifest",
              () -> "image");
      ops.command(new JSONObject().put("id", "capture-command").put("type", "screenshot"));
      RecordedRequest upload = server.takeRequest(3, java.util.concurrent.TimeUnit.SECONDS);
      assertNotNull(upload);
      assertEquals("/api/device/screenshots/capture-command", upload.getPath());
      byte[] bytes = upload.getBody().readByteArray();
      Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
      assertNotNull(decoded);
      assertTrue(Color.blue(decoded.getPixel(200, 50)) > 240);
      assertEquals("Bearer screenshot-device", upload.getHeader("Authorization"));
      long deadline = System.currentTimeMillis() + 3000;
      while (server.getRequestCount() < 2 && System.currentTimeMillis() < deadline) {
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
        Thread.sleep(10);
      }
      RecordedRequest ack = server.takeRequest(1, java.util.concurrent.TimeUnit.SECONDS);
      assertNotNull(ack);
      assertEquals("/api/device/commands/capture-command", ack.getPath());
      assertEquals("success", new JSONObject(ack.getBody().readUtf8()).getString("status"));
      ops.close();
      api.close();
      decoded.recycle();
    }
    original.recycle();
  }
}
