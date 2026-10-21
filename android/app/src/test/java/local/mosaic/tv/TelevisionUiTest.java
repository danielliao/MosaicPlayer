package local.mosaic.tv;

import static org.junit.Assert.*;

import android.view.*;
import android.widget.*;
import org.junit.*;
import org.junit.runner.RunWith;
import org.robolectric.*;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
@LooperMode(LooperMode.Mode.PAUSED)
public class TelevisionUiTest {
  private Button findButton(View root, String label) {
    if (root instanceof Button && ((Button) root).getText().toString().equals(label))
      return (Button) root;
    if (root instanceof ViewGroup) {
      ViewGroup group = (ViewGroup) root;
      for (int i = 0; i < group.getChildCount(); i++) {
        Button b = findButton(group.getChildAt(i), label);
        if (b != null) return b;
      }
    }
    return null;
  }

  @Test
  public void setupHasRemoteFocusableConnectionDiscoveryAndExit() {
    try (ActivityController<MainActivity> controller =
        Robolectric.buildActivity(MainActivity.class).create()) {
      MainActivity activity = controller.get();
      View root = activity.getWindow().getDecorView();
      root.measure(
          View.MeasureSpec.makeMeasureSpec(1920, View.MeasureSpec.EXACTLY),
          View.MeasureSpec.makeMeasureSpec(1080, View.MeasureSpec.EXACTLY));
      root.layout(0, 0, 1920, 1080);
      Button connect = findButton(root, "连接此服务器"),
          search = findButton(root, "自动搜索局域网"),
          exit = findButton(root, "退出应用");
      assertNotNull(connect);
      assertNotNull(search);
      assertNotNull(exit);
      assertTrue(connect.isFocusable());
      assertTrue(search.isFocusable());
      assertTrue(exit.isFocusable());
      search.requestFocus();
      assertTrue(search.hasFocus());
      exit.performClick();
      assertTrue(activity.isFinishing());
    }
  }

  @Test
  public void nativeViewportClipsTheSecondTileWithoutAllocatingAWallSizedView() throws Exception {
    android.content.Context context = RuntimeEnvironment.getApplication();
    WallView wall = new WallView(context);
    org.json.JSONObject layout =
        new org.json.JSONObject()
            .put("cols", 3)
            .put("rows", 1)
            .put("tileWidth", 1920)
            .put("tileHeight", 1080)
            .put("gapX", 40)
            .put("gapY", 0);
    wall.configure(layout, new org.json.JSONObject().put("col", 1).put("row", 0), 1920, 1080);
    wall.measure(
        View.MeasureSpec.makeMeasureSpec(1440, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(900, View.MeasureSpec.EXACTLY));
    wall.layout(0, 0, 1440, 900);
    FrameLayout viewport = (FrameLayout) wall.getChildAt(0);
    assertTrue(viewport.getClipChildren());
    FrameLayout.LayoutParams bounds = (FrameLayout.LayoutParams) viewport.getLayoutParams();
    assertEquals(1440, bounds.width);
    assertEquals(810, bounds.height);
    assertEquals(45, bounds.topMargin);
    TextureView video = (TextureView) viewport.getChildAt(0);
    float[] values = new float[9];
    video.getTransform(new android.graphics.Matrix()).getValues(values);
    assertEquals(4380f / 1440, values[android.graphics.Matrix.MSCALE_X], 0.001);
    assertEquals(-1470, values[android.graphics.Matrix.MTRANS_X], 0.001);
    assertEquals(-826.875, values[android.graphics.Matrix.MTRANS_Y], 0.001);
  }

  @Test
  public void secureEnrollmentHidesScreensUntilCodeResolved() throws Exception {
    try (okhttp3.mockwebserver.MockWebServer server = new okhttp3.mockwebserver.MockWebServer();
        ActivityController<MainActivity> controller =
            Robolectric.buildActivity(MainActivity.class).create()) {
      server.enqueue(
          new okhttp3.mockwebserver.MockResponse()
              .setBody(
                  "{groups:[{id:'group',name:'门店组',layout:{screens:[{id:'screen',name:'左屏',row:0,col:0}]}}]}"));
      server.start();
      MainActivity activity = controller.get();
      org.robolectric.util.ReflectionHelpers.setField(activity, "started", true);
      java.lang.reflect.Method select =
          MainActivity.class.getDeclaredMethod(
              "selectCatalog", String.class, org.json.JSONObject.class);
      select.setAccessible(true);
      select.invoke(
          activity,
          server.url("/").toString().replaceAll("/$", ""),
          new org.json.JSONObject().put("pairingRequired", true).put("published", false));
      View root = activity.getWindow().getDecorView();
      Button resolve = findButton(root, "验证配对码并选择屏幕");
      assertNotNull(resolve);
      assertEquals(View.VISIBLE, resolve.getVisibility());
      EditText code = org.robolectric.util.ReflectionHelpers.getField(activity, "pairingCode");
      code.setText("ABC123");
      resolve.performClick();
      okhttp3.mockwebserver.RecordedRequest request =
          server.takeRequest(3, java.util.concurrent.TimeUnit.SECONDS);
      assertNotNull(request);
      assertEquals("/api/pairing/resolve", request.getPath());
      assertEquals(
          "ABC123", new org.json.JSONObject(request.getBody().readUtf8()).getString("code"));
      assertNull(request.getHeader("Authorization"));
      long deadline = System.currentTimeMillis() + 3000;
      while (org.robolectric.util.ReflectionHelpers.getField(activity, "resolvedCode") == null
          && System.currentTimeMillis() < deadline) {
        Shadows.shadowOf(android.os.Looper.getMainLooper()).idle();
        Thread.sleep(10);
      }
      assertNotNull(findButton(root, "门店组 · 第 1 块屏 · 左屏"));
      org.robolectric.util.ReflectionHelpers.setField(activity, "started", false);
    }
  }
}
