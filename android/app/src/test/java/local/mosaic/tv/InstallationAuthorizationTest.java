package local.mosaic.tv;

import static org.junit.Assert.*;

import android.app.Activity;
import android.content.Intent;
import android.os.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import okhttp3.mockwebserver.*;
import org.json.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.*;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 23)
@LooperMode(LooperMode.Mode.PAUSED)
public class InstallationAuthorizationTest {
  void await(BooleanSupplier done) throws Exception {
    long end = System.currentTimeMillis() + 3000;
    while (!done.getAsBoolean() && System.currentTimeMillis() < end) {
      Shadows.shadowOf(Looper.getMainLooper()).idle();
      Thread.sleep(10);
    }
    Shadows.shadowOf(Looper.getMainLooper()).idle();
    assertTrue("worker completion", done.getAsBoolean());
  }

  DeviceOperations staged(
      Activity activity, MockWebServer server, List<String> messages, AtomicInteger validations)
      throws Exception {
    ApiClient api = new ApiClient();
    DeviceOperations ops =
        new DeviceOperations(
            activity,
            new WallView(activity),
            api,
            server.url("/").toString().replaceAll("/$", ""),
            "install-device",
            new Handler(Looper.getMainLooper()),
            messages::add,
            () -> "program",
            () -> "image",
            (apk, command) -> validations.incrementAndGet());
    File directory = new File(activity.getFilesDir(), "updates");
    assertTrue(directory.isDirectory() || directory.mkdirs());
    File apk = new File(directory, "install-task.apk");
    try (FileOutputStream out = new FileOutputStream(apk)) {
      out.write(new byte[] {1, 2, 3});
    }
    ReflectionHelpers.setField(
        ops,
        "offer",
        new JSONObject()
            .put("id", "install-task")
            .put("type", "update")
            .put("versionCode", BuildConfig.VERSION_CODE + 1));
    ReflectionHelpers.setField(ops, "readyApk", apk);
    ReflectionHelpers.setField(ops, "update", "awaiting_confirmation");
    return ops;
  }

  @Test
  public void allServerDenialsKeepInstallerClosedAndExplainFailure() throws Exception {
    for (int status : new int[] {401, 403, 404, 409, 503})
      try (MockWebServer server = new MockWebServer();
          ActivityController<Activity> activity =
              Robolectric.buildActivity(Activity.class).create()) {
        server.enqueue(
            new MockResponse().setResponseCode(status).setBody("{error:'authorization denied'}"));
        server.start();
        List<String> messages = new ArrayList<>();
        AtomicInteger validated = new AtomicInteger();
        DeviceOperations ops = staged(activity.get(), server, messages, validated);
        ops.offerInstall();
        RecordedRequest request = server.takeRequest(2, TimeUnit.SECONDS);
        assertNotNull(request);
        assertEquals("/api/device/commands/install-task", request.getPath());
        assertEquals("Bearer install-device", request.getHeader("Authorization"));
        assertEquals(
            "installing", new JSONObject(request.getBody().readUtf8()).getString("status"));
        await(() -> !messages.isEmpty());
        assertEquals(1, validated.get());
        assertNull(
            "denied installation never launches",
            Shadows.shadowOf(activity.get()).getNextStartedActivity());
        assertTrue(messages.get(messages.size() - 1).contains("安装授权"));
        assertTrue(messages.get(messages.size() - 1).contains("authorization denied"));
        ops.close();
        ReflectionHelpers.<ApiClient>getField(ops, "api").close();
      }
  }

  @Test
  public void waitsForPositive200AndDoesNotReuseGrantAfterCancellation() throws Exception {
    try (MockWebServer server = new MockWebServer();
        ActivityController<Activity> activity =
            Robolectric.buildActivity(Activity.class).create()) {
      server.enqueue(
          new MockResponse().setBody("{ok:true}").setBodyDelay(250, TimeUnit.MILLISECONDS));
      server.start();
      List<String> messages = new ArrayList<>();
      AtomicInteger validated = new AtomicInteger();
      DeviceOperations ops = staged(activity.get(), server, messages, validated);
      ops.offerInstall();
      ops.offerInstall();
      assertNotNull(server.takeRequest(2, TimeUnit.SECONDS));
      Shadows.shadowOf(Looper.getMainLooper()).idle();
      assertNull(
          "authorization body is not yet accepted",
          Shadows.shadowOf(activity.get()).getNextStartedActivity());
      await(() -> "installing".equals(ops.updateStatus()));
      Intent install = Shadows.shadowOf(activity.get()).getNextStartedActivity();
      assertNotNull(install);
      assertEquals(Intent.ACTION_INSTALL_PACKAGE, install.getAction());
      assertEquals(1, server.getRequestCount());
      server.enqueue(new MockResponse().setBody("{ok:true}"));
      ops.installResult(Activity.RESULT_CANCELED);
      RecordedRequest cancelled = server.takeRequest(2, TimeUnit.SECONDS);
      assertNotNull(cancelled);
      assertEquals("cancelled", new JSONObject(cancelled.getBody().readUtf8()).getString("status"));
      server.enqueue(new MockResponse().setResponseCode(409).setBody("{error:'expired'}"));
      messages.clear();
      ops.offerInstall();
      assertNotNull(server.takeRequest(2, TimeUnit.SECONDS));
      await(() -> !messages.isEmpty());
      assertEquals(2, validated.get());
      assertNull(
          "retry needs a new valid server grant",
          Shadows.shadowOf(activity.get()).getNextStartedActivity());
      ops.close();
      ReflectionHelpers.<ApiClient>getField(ops, "api").close();
    }
  }

  @Test
  public void successfulStatusWithoutExplicitAuthorizationIsRejected() throws Exception {
    for (MockResponse response :
        new MockResponse[] {
          new MockResponse().setResponseCode(201).setBody("{ok:true}"),
          new MockResponse().setBody("{ok:false}")
        })
      try (MockWebServer server = new MockWebServer();
          ActivityController<Activity> activity =
              Robolectric.buildActivity(Activity.class).create()) {
        server.enqueue(response);
        server.start();
        List<String> messages = new ArrayList<>();
        DeviceOperations ops = staged(activity.get(), server, messages, new AtomicInteger());
        ops.offerInstall();
        assertNotNull(server.takeRequest(2, TimeUnit.SECONDS));
        await(() -> !messages.isEmpty());
        assertNull(Shadows.shadowOf(activity.get()).getNextStartedActivity());
        ops.close();
        ReflectionHelpers.<ApiClient>getField(ops, "api").close();
      }
  }

  @Test
  public void closingWhileAuthorizationIsPendingCannotLaunchQueuedInstaller() throws Exception {
    try (MockWebServer server = new MockWebServer();
        ActivityController<Activity> activity =
            Robolectric.buildActivity(Activity.class).create()) {
      server.enqueue(
          new MockResponse().setBody("{ok:true}").setBodyDelay(200, TimeUnit.MILLISECONDS));
      server.start();
      List<String> messages = new ArrayList<>();
      DeviceOperations ops = staged(activity.get(), server, messages, new AtomicInteger());
      ops.offerInstall();
      assertNotNull(server.takeRequest(2, TimeUnit.SECONDS));
      ops.close();
      Thread.sleep(300);
      Shadows.shadowOf(Looper.getMainLooper()).idle();
      assertNull(Shadows.shadowOf(activity.get()).getNextStartedActivity());
      ReflectionHelpers.<ApiClient>getField(ops, "api").close();
    }
  }

  @Test
  public void offlineCachedApkCannotOpenInstaller() throws Exception {
    try (MockWebServer server = new MockWebServer();
        ActivityController<Activity> activity =
            Robolectric.buildActivity(Activity.class).create()) {
      server.start();
      List<String> messages = new ArrayList<>();
      DeviceOperations ops = staged(activity.get(), server, messages, new AtomicInteger());
      server.shutdown();
      ops.offerInstall();
      await(() -> !messages.isEmpty());
      assertNull(Shadows.shadowOf(activity.get()).getNextStartedActivity());
      assertTrue(ops.updateError().contains("安装授权"));
      ops.close();
      ReflectionHelpers.<ApiClient>getField(ops, "api").close();
    }
  }
}
