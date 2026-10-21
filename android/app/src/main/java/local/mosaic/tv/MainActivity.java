package local.mosaic.tv;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.*;
import android.os.*;
import android.text.InputType;
import android.view.*;
import android.view.inputmethod.InputMethodManager;
import android.widget.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public final class MainActivity extends Activity {
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService worker = Executors.newSingleThreadExecutor();
  private final ApiClient api = new ApiClient();
  private FrameLayout root;
  private WallView wall;
  private ScrollView setup;
  private LinearLayout content, servers, screens;
  private EditText address, pairingCode;
  private Button resolveCode;
  private String resolvedCode;
  private boolean securePairing;
  private TextView message, heading;
  private Button connect, search;
  private LinearLayout controls;
  private TextView playbackInfo, playbackHint, diagnosticsInfo;
  private Button diagnosticsToggle;
  private boolean hasMedia;
  private Integer pendingInstallResult;
  private PairingStore store;
  private PlaybackEngine engine;
  private NetworkDiscovery discovery;
  private boolean started, busy;
  private int generation;
  private String selectedBase, catalogSignature;
  private final Set<String> found = new HashSet<>();

  @Override protected void attachBaseContext(android.content.Context base) { super.attachBaseContext(AppLocale.wrap(base)); }

  @Override
  public void onCreate(Bundle state) {
    super.onCreate(state);
    store = new PairingStore(this);
    getWindow()
        .getDecorView()
        .setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    root = new FrameLayout(this);
    wall = new WallView(this);
    root.addView(wall, new FrameLayout.LayoutParams(-1, -1));
    playbackHint = text("正在连接…", 20, Color.WHITE);
    playbackHint.setPadding(dp(20), dp(12), dp(20), dp(12));
    playbackHint.setBackground(shape(0xe020293a, 0));
    FrameLayout.LayoutParams hintParams =
        new FrameLayout.LayoutParams(-2, -2, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
    hintParams.setMargins(dp(40), dp(24), dp(40), dp(40));
    root.addView(playbackHint, hintParams);
    playbackHint.setVisibility(View.GONE);
    setContentView(root);
    buildSetup();
    buildControls();
  }

  private int dp(float v) {
    return (int) (v * getResources().getDisplayMetrics().density + 0.5f);
  }

  private TextView text(String s, int size, int color) {
    TextView v = new TextView(this);
    v.setText(s);
    v.setTextSize(size);
    v.setTextColor(color);
    v.setPadding(0, dp(6), 0, dp(6));
    return v;
  }

  private GradientDrawable shape(int color, int stroke) {
    GradientDrawable d = new GradientDrawable();
    d.setColor(color);
    d.setCornerRadius(dp(8));
    if (stroke != 0) d.setStroke(dp(3), stroke);
    return d;
  }

  private Button button(String title, Runnable action) {
    Button b = new Button(this);
    b.setText(title);
    b.setAllCaps(false);
    b.setTextSize(18);
    b.setTextColor(Color.WHITE);
    b.setMinHeight(dp(52));
    b.setPadding(dp(18), dp(8), dp(18), dp(8));
    StateListDrawable states = new StateListDrawable();
    states.addState(new int[] {-android.R.attr.state_enabled}, shape(0xff202638, 0));
    states.addState(new int[] {android.R.attr.state_focused}, shape(0xff5845bd, 0xffd7d0ff));
    states.addState(new int[] {android.R.attr.state_pressed}, shape(0xff5845bd, 0xffd7d0ff));
    states.addState(new int[] {}, shape(0xff303851, 0));
    b.setBackground(states);
    b.setOnClickListener(v -> action.run());
    b.setOnFocusChangeListener((v, focus) -> v.setElevation(focus ? dp(6) : 0));
    LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
    p.setMargins(0, dp(5), 0, dp(5));
    b.setLayoutParams(p);
    return b;
  }

  private void buildSetup() {
    setup = new ScrollView(this);
    setup.setFillViewport(true);
    setup.setBackgroundColor(0xff0c1220);
    setup.setClipToPadding(false);
    setup.setPadding(dp(48), dp(28), dp(48), dp(28));
    root.addView(setup, new FrameLayout.LayoutParams(-1, -1));
    content = new LinearLayout(this);
    content.setOrientation(LinearLayout.VERTICAL);
    setup.addView(content, new ScrollView.LayoutParams(-1, -2));
    content.addView(button(getString(R.string.controller), () -> startActivity(new android.content.Intent(this, ControllerActivity.class))));
    content.addView(text(getString(R.string.setup_title), 28, Color.WHITE));
    content.addView(text(getString(R.string.setup_help), 16, 0xffaeb9d0));
    address = new EditText(this);
    address.setText(store.server());
    address.setSingleLine(true);
    address.setSelectAllOnFocus(true);
    address.setTextColor(Color.WHITE);
    address.setTextSize(18);
    address.setHint(getString(R.string.server));
    address.setHintTextColor(0xffaeb9d0);
    address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
    address.setMinHeight(dp(54));
    content.addView(address, new LinearLayout.LayoutParams(-1, -2));
    LinearLayout actions = new LinearLayout(this);
    connect = button(getString(R.string.connect_server), () -> connectAddress(address.getText().toString(), false));
    search = button(getString(R.string.search_server), this::searchServers);
    LinearLayout.LayoutParams left = new LinearLayout.LayoutParams(0, -2, 1);
    left.setMargins(0, dp(6), dp(8), dp(6));
    actions.addView(connect, left);
    actions.addView(search, new LinearLayout.LayoutParams(0, -2, 1));
    content.addView(actions);
    message = text("正在检查内置服务器…", 17, 0xffc6baff);
    message.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
    content.addView(message);
    pairingCode = new EditText(this);
    pairingCode.setSingleLine(true);
    pairingCode.setTextColor(Color.WHITE);
    pairingCode.setTextSize(20);
    pairingCode.setHint(getString(R.string.pair_code));
    pairingCode.setHintTextColor(0xffaeb9d0);
    pairingCode.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
    pairingCode.setMinHeight(dp(54));
    pairingCode.setVisibility(View.GONE);
    content.addView(pairingCode);
    resolveCode = button(getString(R.string.verify_pair), this::resolvePairing);
    resolveCode.setVisibility(View.GONE);
    content.addView(resolveCode);
    servers = new LinearLayout(this);
    servers.setOrientation(LinearLayout.VERTICAL);
    content.addView(servers);
    heading = text(getString(R.string.screens), 22, Color.WHITE);
    content.addView(heading);
    screens = new LinearLayout(this);
    screens.setOrientation(LinearLayout.VERTICAL);
    content.addView(screens);
    content.addView(button(getString(R.string.exit), this::finish));
    connect.requestFocus();
  }

  private void buildControls() {
    controls = new LinearLayout(this);
    controls.setOrientation(LinearLayout.VERTICAL);
    controls.setPadding(dp(24), dp(18), dp(24), dp(18));
    controls.setBackground(shape(0xf01b2235, 0xff66718c));
    FrameLayout.LayoutParams p = new FrameLayout.LayoutParams(dp(500), -2, Gravity.CENTER);
    root.addView(controls, p);
    controls.addView(text("Mosaic TV", 24, Color.WHITE));
    playbackInfo = text("连接中", 17, 0xffd2d9e9);
    controls.addView(playbackInfo);
    controls.addView(button("继续全屏播放", () -> controls.setVisibility(View.GONE)));
    controls.addView(button("重新选择服务器 / 屏幕", this::resetPairing));
    controls.addView(
        button(
            "安装已下载更新（需确认）",
            () -> {
              if (engine != null) engine.installUpdate();
            }));
    diagnosticsInfo = text("", 14, 0xffaeb9d0);
    controls.addView(diagnosticsInfo);
    diagnosticsToggle =
        button(
            "诊断：暂停自动校时",
            () -> {
              if (engine != null)
                diagnosticsToggle.setText(engine.toggleCorrections() ? "诊断：暂停自动校时" : "诊断：恢复自动校时");
            });
    controls.addView(diagnosticsToggle);
    controls.addView(button(getString(R.string.exit), this::finish));
    controls.setVisibility(View.GONE);
  }

  @Override
  protected void onStart() {
    super.onStart();
    started = true;
    JSONObject saved = store.load();
    if (saved != null) {
      try {
        restorePairing(saved.getString("base"), saved.getString("screen"), saved.getString("key"));
      } catch (Exception e) {
        store.clear();
        showSetup();
        connectAddress(store.server(), true);
      }
    } else {
      showSetup();
      connectAddress(store.server(), true);
    }
    main.postDelayed(refresh, 3000);
  }

  private void restorePairing(String base, String screen, String key) {
    // Start local restore before network I/O so a reboot without LAN can still play.
    play(base, screen, key);
  }

  private void showSetup() {
    playbackHint.setVisibility(View.GONE);
    setup.setVisibility(View.VISIBLE);
    controls.setVisibility(View.GONE);
    connect.requestFocus();
  }

  private void connectAddress(String raw, boolean fallback) {
    final String base;
    try {
      base = Protocol.serverAddress(raw);
    } catch (Exception e) {
      message.setText(e.getMessage());
      return;
    }
    stopDiscovery();
    int token = ++generation;
    selectedBase = null;
    resolvedCode = null;
    catalogSignature = null;
    screens.removeAllViews();
    message.setText("正在连接 " + base + " …");
    busy = true;
    connect.setEnabled(false);
    hideKeyboard();
    worker.execute(
        () -> {
          try {
            JSONObject c = api.catalog(base);
            main.post(
                () -> {
                  if (!started || token != generation) return;
                  busy = false;
                  connect.setEnabled(true);
                  selectCatalog(base, c);
                });
          } catch (Exception e) {
            main.post(
                () -> {
                  if (!started || token != generation) return;
                  busy = false;
                  connect.setEnabled(true);
                  message.setText("连接失败：" + e.getMessage() + "。请确认后台运行且两台设备处于同一局域网。");
                  if (fallback) searchServers();
                });
          }
        });
  }

  private void selectCatalog(String base, JSONObject catalog) {
    selectedBase = base;
    address.setText(base);
    store.remember(base);
    renderCatalog(catalog);
  }

  private void renderCatalog(JSONObject catalog) {
    securePairing = catalog.optBoolean("pairingRequired");
    pairingCode.setVisibility(securePairing ? View.VISIBLE : View.GONE);
    resolveCode.setVisibility(securePairing ? View.VISIBLE : View.GONE);
    if (securePairing) {
      if (resolvedCode == null) {
        message.setText("请在门店后台生成一次性配对码；验证后才显示可选屏幕。");
        screens.removeAllViews();
      }
      return;
    }
    if (!catalog.optBoolean("published")) {
      message.setText("服务器已找到，请在后台开启“局域网发布”，然后选择屏幕。");
      screens.removeAllViews();
      catalogSignature = null;
      return;
    }
    JSONArray list = catalog.optJSONArray("screens");
    if (list == null) return;
    message.setText("已连接 " + selectedBase + " · 选择这台电视作为第几块屏");
    String signature = list.toString();
    if (signature.equals(catalogSignature)) return;
    String focusTag =
        getCurrentFocus() != null && getCurrentFocus().getTag() instanceof String
            ? (String) getCurrentFocus().getTag()
            : null;
    catalogSignature = signature;
    screens.removeAllViews();
    Button first = null, restore = null;
    for (int i = 0; i < list.length(); i++) {
      JSONObject s = list.optJSONObject(i);
      if (s == null) continue;
      String id = s.optString("id");
      boolean occupied = s.optBoolean("online") || s.optBoolean("reserved");
      String label =
          String.format(
              java.util.Locale.CHINA,
              "第 %d 块屏 · %s · 第 %d 行 / 第 %d 列%s",
              i + 1,
              s.optString("name"),
              s.optInt("row") + 1,
              s.optInt("col") + 1,
              occupied ? "  ［已占用］" : "");
      Button b = button(label, () -> pair(id));
      b.setTag(id);
      b.setEnabled(!occupied);
      b.setAlpha(occupied ? .5f : 1);
      screens.addView(b);
      if (!occupied && first == null) first = b;
      if (id.equals(focusTag) && !occupied) restore = b;
    }
    if (restore != null) restore.requestFocus();
    else if (first != null
        && (getCurrentFocus() == connect || getCurrentFocus() == search || focusTag != null))
      first.requestFocus();
  }

  private final Runnable refresh =
      new Runnable() {
        public void run() {
          if (!started) return;
          if (selectedBase != null && !busy && engine == null) {
            String base = selectedBase;
            int token = generation;
            worker.execute(
                () -> {
                  try {
                    JSONObject c = api.catalog(base);
                    main.post(
                        () -> {
                          if (started && token == generation && engine == null) renderCatalog(c);
                        });
                  } catch (Exception e) {
                    main.post(
                        () -> {
                          if (started && token == generation)
                            message.setText("服务器暂时无法连接；可重新连接或自动搜索。");
                        });
                  }
                });
          }
          main.postDelayed(this, 3000);
        }
      };

  private void resolvePairing() {
    if (busy || selectedBase == null) return;
    String code = pairingCode.getText().toString().trim();
    if (!code.matches("[A-Za-z0-9-]{4,64}")) {
      message.setText("请输入后台生成的有效配对码");
      return;
    }
    busy = true;
    resolveCode.setEnabled(false);
    int token = ++generation;
    String base = selectedBase;
    hideKeyboard();
    worker.execute(
        () -> {
          try {
            JSONObject result =
                api.json(base, "/api/pairing/resolve", null, new JSONObject().put("code", code));
            main.post(
                () -> {
                  if (!started || token != generation) return;
                  busy = false;
                  resolveCode.setEnabled(true);
                  resolvedCode = code;
                  screens.removeAllViews();
                  JSONArray groups = result.optJSONArray("groups");
                  int count = 0;
                  Button first = null;
                  if (groups != null)
                    for (int g = 0; g < groups.length(); g++) {
                      JSONObject group = groups.optJSONObject(g);
                      if (group == null) continue;
                      JSONObject layout = group.optJSONObject("layout");
                      JSONArray positions = layout == null ? null : layout.optJSONArray("screens");
                      if (positions == null) continue;
                      for (int i = 0; i < positions.length(); i++) {
                        JSONObject position = positions.optJSONObject(i);
                        if (position == null) continue;
                        String id = position.optString("id");
                        boolean occupied =
                            position.optBoolean("online") || position.optBoolean("reserved");
                        Button b =
                            button(
                                group.optString("name")
                                    + " · 第 "
                                    + (i + 1)
                                    + " 块屏 · "
                                    + position.optString("name")
                                    + (occupied ? " ［已占用］" : ""),
                                () -> pair(id));
                        b.setEnabled(!occupied);
                        screens.addView(b);
                        count++;
                        if (first == null && !occupied) first = b;
                      }
                    }
                  message.setText(count == 0 ? "此配对码暂无可用屏幕，请在后台配置播放组。" : "配对码已验证；请选择此电视的位置。");
                  if (first != null) first.requestFocus();
                });
          } catch (Exception e) {
            main.post(
                () -> {
                  if (!started || token != generation) return;
                  busy = false;
                  resolveCode.setEnabled(true);
                  resolvedCode = null;
                  message.setText("配对码验证失败：" + e.getMessage());
                });
          }
        });
  }

  private void pair(String screen) {
    if (busy || selectedBase == null) return;
    busy = true;
    final String base = selectedBase;
    final int token = ++generation;
    message.setText("正在为这台电视配置屏幕…");
    worker.execute(
        () -> {
          try {
            JSONObject request = new JSONObject().put("screenId", screen);
            if (securePairing) {
              if (resolvedCode == null) throw new IllegalStateException("请先验证配对码");
              request.put("code", resolvedCode);
              request.put("client", "android-tv");
              request.put("name", Build.MANUFACTURER + " " + Build.MODEL);
              android.content.SharedPreferences identity =
                  getSharedPreferences("device-identity", MODE_PRIVATE);
              String deviceId = identity.getString("id", null);
              if (deviceId == null) {
                deviceId = UUID.randomUUID().toString();
                identity.edit().putString("id", deviceId).commit();
              }
              request.put("deviceId", deviceId);
            }
            JSONObject result = api.json(base, "/api/pair", null, request);
            String key = result.getString("key");
            // Persist the one-time credential before any further network round trip.
            store.save(base, screen, key);
            main.post(
                () -> {
                  if (!started || token != generation) return;
                  busy = false;
                  try {
                    resolvedCode = null;
                    pairingCode.setText("");
                    play(base, screen, key);
                  } catch (Exception e) {
                    message.setText("无法保存配对：" + e.getMessage());
                  }
                });
          } catch (Exception e) {
            main.post(
                () -> {
                  if (started && token == generation) {
                    busy = false;
                    message.setText(e.getMessage());
                    catalogSignature = null;
                  }
                });
          }
        });
  }

  private void play(String base, String screen, String key) {
    stopDiscovery();
    if (engine != null) engine.close();
    selectedBase = null;
    hasMedia = false;
    diagnosticsToggle.setText("诊断：暂停自动校时");
    playbackHint.setText("正在连接服务器…");
    playbackHint.setVisibility(View.VISIBLE);
    setup.setVisibility(View.GONE);
    controls.setVisibility(View.VISIBLE);
    playbackInfo.setText("正在连接 " + base + "\n屏幕：" + screen);
    controls.getChildAt(2).requestFocus();
    engine =
        new PlaybackEngine(
            this,
            wall,
            base,
            key,
            screen,
            new PlaybackEngine.Events() {
              public void status(String text) {
                playbackInfo.setText(base + "\n屏幕：" + screen + "\n" + text);
                if (!hasMedia) playbackHint.setText(text + "\n返回键可打开设置");
              }

              public void diagnostics(String text) {
                diagnosticsInfo.setText(text);
              }

              public void contentVisible(boolean visible) {
                hasMedia = visible;
                playbackHint.setVisibility(visible ? View.GONE : View.VISIBLE);
              }

              public void connected() {
                controls.setVisibility(View.GONE);
              }
            });
    engine.start();
    if (pendingInstallResult != null) {
      engine.installResult(pendingInstallResult);
      pendingInstallResult = null;
    }
  }

  private void resetPairing() {
    generation++;
    if (engine != null) {
      engine.close();
      engine = null;
    }
    store.clear();
    resolvedCode = null;
    pairingCode.setText("");
    worker.execute(
        () -> {
          FileCleaner.clear(new java.io.File(getFilesDir(), "media"));
          FileCleaner.clear(new java.io.File(getFilesDir(), "updates"));
          java.io.File[] snapshots =
              getFilesDir().listFiles((dir, name) -> name.startsWith("program-"));
          if (snapshots != null) for (java.io.File f : snapshots) f.delete();
        });
    busy = false;
    connect.setEnabled(true);
    showSetup();
    connectAddress(store.server(), false);
  }

  private void searchServers() {
    stopDiscovery();
    selectedBase = null;
    catalogSignature = null;
    generation++;
    busy = false;
    connect.setEnabled(true);
    screens.removeAllViews();
    servers.removeAllViews();
    found.clear();
    message.setText("正在搜索同一局域网的服务器（最长 45 秒）…");
    discovery =
        new NetworkDiscovery(
            this,
            new NetworkDiscovery.Listener() {
              public void found(String base, JSONObject c) {
                if (!started || !found.add(base)) return;
                Button b =
                    button(
                        "服务器  " + base + "  · " + (c.optBoolean("published") ? "已发布" : "未发布"),
                        () -> connectAddress(base, false));
                servers.addView(b);
                if (found.size() == 1) {
                  selectCatalog(base, c);
                  b.requestFocus();
                }
              }

              public void finished() {
                if (found.isEmpty()) message.setText("未发现服务器。请检查同一局域网、后台发布状态，或手工输入地址。");
              }
            });
    discovery.start(address.getText().toString());
  }

  private void stopDiscovery() {
    if (discovery != null) {
      discovery.close();
      discovery = null;
    }
  }

  private void hideKeyboard() {
    InputMethodManager input = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
    if (input != null) input.hideSoftInputFromWindow(address.getWindowToken(), 0);
  }

  @Override
  public boolean onKeyDown(int key, KeyEvent event) {
    if (engine != null
        && (key == KeyEvent.KEYCODE_MENU
            || key == KeyEvent.KEYCODE_DPAD_CENTER && controls.getVisibility() != View.VISIBLE)) {
      controls.setVisibility(View.VISIBLE);
      controls.getChildAt(2).requestFocus();
      return true;
    }
    return super.onKeyDown(key, event);
  }

  @Override
  public void onBackPressed() {
    if (engine != null) {
      if (controls.getVisibility() == View.VISIBLE) controls.setVisibility(View.GONE);
      else {
        controls.setVisibility(View.VISIBLE);
        controls.getChildAt(2).requestFocus();
      }
    } else super.onBackPressed();
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == DeviceOperations.INSTALL_REQUEST) {
      if (engine != null) engine.installResult(resultCode);
      else pendingInstallResult = resultCode;
    }
  }

  @Override
  protected void onStop() {
    started = false;
    generation++;
    main.removeCallbacksAndMessages(null);
    stopDiscovery();
    api.http.dispatcher().cancelAll();
    if (engine != null) {
      engine.close();
      engine = null;
    }
    busy = false;
    connect.setEnabled(true);
    super.onStop();
  }

  @Override
  protected void onDestroy() {
    worker.shutdownNow();
    api.close();
    super.onDestroy();
  }
}
