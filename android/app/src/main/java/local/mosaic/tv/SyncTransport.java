package local.mosaic.tv;

import java.util.concurrent.*;
import java.util.function.LongSupplier;
import okhttp3.*;
import org.json.*;

public final class SyncTransport implements AutoCloseable {
  public interface Listener {
    void state(JSONObject state);

    void connection(boolean online, String detail);

    default void command(JSONObject command) {}
  }

  public final SyncMath.Clock clock = new SyncMath.Clock();
  private final ApiClient api;
  private final String base, key, screen;
  private final Executor callbacks;
  private final Listener listener;
  private final LongSupplier elapsed;
  private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
  private final ConcurrentHashMap<Long, Double> pings = new ConcurrentHashMap<>();
  private final long wallAnchor, elapsedAnchor;
  private volatile boolean closed, online;
  private volatile WebSocket socket;
  private int retry;
  private long id;
  private final java.util.concurrent.atomic.AtomicBoolean fallbackReportPending =
      new java.util.concurrent.atomic.AtomicBoolean();

  public SyncTransport(
      ApiClient api,
      String base,
      String key,
      String screen,
      Executor callbacks,
      LongSupplier elapsed,
      Listener listener) {
    this.api = api;
    this.base = base;
    this.key = key;
    this.screen = screen;
    this.callbacks = callbacks;
    this.elapsed = elapsed;
    this.listener = listener;
    wallAnchor = System.currentTimeMillis();
    elapsedAnchor = elapsed.getAsLong();
  }

  public double localNow() {
    return wallAnchor + (elapsed.getAsLong() - elapsedAnchor);
  }

  public double now() {
    return localNow() + clock.offset();
  }

  public boolean online() {
    return online;
  }

  private void deliver(Runnable r) {
    callbacks.execute(
        () -> {
          if (!closed) r.run();
        });
  }

  public void start() {
    worker.execute(this::connect);
    worker.scheduleWithFixedDelay(this::ping, 3, 3, TimeUnit.SECONDS);
    worker.scheduleWithFixedDelay(this::poll, 5, 5, TimeUnit.SECONDS);
  }

  private void connect() {
    if (closed) return;
    try {
      double sent = localNow();
      JSONObject first = api.deviceState(base, key);
      receive(first, sent);
      if (closed) return;
      Request req =
          new Request.Builder()
              .url(base + "/ws")
              .header("Authorization", "Bearer " + key)
              .header("X-Mosaic-Capabilities", ApiClient.CAPABILITIES)
              .build();
      socket =
          api.http.newWebSocket(
              req,
              new WebSocketListener() {
                @Override
                public void onOpen(WebSocket ws, Response response) {
                  if (closed) {
                    ws.cancel();
                    return;
                  }
                  clock.reset();
                  pings.clear();
                  online = true;
                  retry = 0;
                  deliver(() -> listener.connection(true, "已连接，正在校时"));
                  try {
                    for (int i = 0; i < 8; i++)
                      worker.schedule(() -> ping(ws), i * 120L, TimeUnit.MILLISECONDS);
                  } catch (RejectedExecutionException ignored) {
                    ws.cancel();
                  }
                }

                @Override
                public void onMessage(WebSocket ws, String text) {
                  if (closed || ws != socket) return;
                  try {
                    if (text.length() > 1024 * 1024) throw new JSONException("服务器消息过大");
                    JSONObject msg = new JSONObject(text);
                    if ("clock".equals(msg.optString("type"))) {
                      Double sent = pings.remove(msg.getLong("id"));
                      if (sent != null) clock.record(sent, localNow(), msg.getDouble("serverTime"));
                    }
                    if ("command".equals(msg.optString("type"))) {
                      JSONObject command = msg.getJSONObject("command");
                      deliver(() -> listener.command(command));
                    }
                    if ("state".equals(msg.optString("type"))) {
                      JSONObject state = Protocol.validateState(msg.getJSONObject("state"), screen);
                      deliver(() -> listener.state(state));
                    }
                  } catch (Exception e) {
                    deliver(() -> listener.connection(false, "配置无效，请重新选屏"));
                    ws.close(1008, "Invalid state");
                  }
                }

                @Override
                public void onClosed(WebSocket ws, int code, String reason) {
                  lost(ws);
                }

                @Override
                public void onClosing(WebSocket ws, int code, String reason) {
                  ws.close(code, null);
                }

                @Override
                public void onFailure(WebSocket ws, Throwable t, Response r) {
                  lost(ws);
                }
              });
    } catch (Exception e) {
      if (!closed) {
        deliver(
            () -> listener.connection(false, e.getMessage() == null ? "无法连接服务器" : e.getMessage()));
        scheduleReconnect();
      }
    }
  }

  private void receive(JSONObject message, double sent) throws Exception {
    JSONObject state = Protocol.validateState(message.getJSONObject("state"), screen);
    // A single HTTP sample supplies a bounded initial clock before WS's faster samples.
    if (!clock.ready() && message.has("serverTime"))
      clock.record(sent, localNow(), message.getDouble("serverTime"));
    deliver(() -> listener.state(state));
    org.json.JSONArray commands = message.optJSONArray("commands");
    if (commands != null)
      for (int i = 0; i < commands.length(); i++) {
        JSONObject c = commands.getJSONObject(i);
        deliver(() -> listener.command(c));
      }
  }

  private void poll() {
    if (closed) return;
    try {
      double sent = localNow();
      receive(api.deviceState(base, key), sent);
    } catch (Exception ignored) {
      /* WS/reconnect shows connection failures. */
    }
  }

  public void report(JSONObject report) {
    if (send(report)) return;
    if (!fallbackReportPending.compareAndSet(false, true)) return;
    try {
      worker.execute(
          () -> {
            try {
              api.json(base, "/api/device/report", key, report);
            } catch (Exception ignored) {
            } finally {
              fallbackReportPending.set(false);
            }
          });
    } catch (RejectedExecutionException ignored) {
      fallbackReportPending.set(false);
    }
  }

  private void lost(WebSocket ws) {
    if (closed || socket != ws) return;
    online = false;
    socket = null;
    pings.clear();
    deliver(() -> listener.connection(false, "网络断开，继续本地播放并自动重连"));
    scheduleReconnect();
  }

  private void scheduleReconnect() {
    if (!closed)
      try {
        worker.schedule(this::connect, Math.min(10, 1 << Math.min(retry++, 3)), TimeUnit.SECONDS);
      } catch (RejectedExecutionException ignored) {
      }
  }

  private void ping() {
    ping(socket);
  }

  private void ping(WebSocket ws) {
    if (closed || ws == null || !online) return;
    long next = ++id;
    double now = localNow();
    pings.entrySet().removeIf(e -> now - e.getValue() > 10000);
    pings.put(next, now);
    ws.send(Protocol.put(Protocol.message("clock"), "id", next).toString());
  }

  public boolean send(JSONObject msg) {
    WebSocket ws = socket;
    return !closed && online && ws != null && ws.send(msg.toString());
  }

  @Override
  public void close() {
    closed = true;
    online = false;
    worker.shutdownNow();
    WebSocket ws = socket;
    if (ws != null) {
      ws.close(1000, "Player stopped");
      ws.cancel();
    }
    socket = null;
    pings.clear();
  }
}
