package local.mosaic.tv;

import android.content.Context;
import android.net.nsd.*;
import android.net.wifi.WifiManager;
import android.os.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.JSONObject;

final class NetworkDiscovery implements AutoCloseable {
  interface Listener {
    void found(String base, JSONObject catalog);

    void finished();
  }

  private final ApiClient api = new ApiClient();
  private final ExecutorService workers = Executors.newFixedThreadPool(16);
  private final Handler main = new Handler(Looper.getMainLooper());
  private final NsdManager nsd;
  private final Listener listener;
  private NsdManager.DiscoveryListener browsing;
  private WifiManager.MulticastLock multicast;
  private final Set<String> tried = ConcurrentHashMap.newKeySet();
  private final ArrayDeque<NsdServiceInfo> queue = new ArrayDeque<>();
  private boolean resolving;
  private volatile boolean closed;

  NetworkDiscovery(Context context, Listener listener) {
    this.listener = listener;
    nsd = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
    try {
      WifiManager wifi =
          (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
      if (wifi != null) {
        multicast = wifi.createMulticastLock("mosaic-discovery");
        multicast.setReferenceCounted(false);
        multicast.acquire();
      }
    } catch (Exception ignored) {
    }
  }

  void start(String preferred) {
    probe(preferred);
    if (!BuildConfig.DEFAULT_SERVER.equals(preferred)) probe(BuildConfig.DEFAULT_SERVER);
    browse();
    workers.execute(
        () -> {
          try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            int count = 0;
            while (interfaces.hasMoreElements() && count < 4) {
              NetworkInterface nic = interfaces.nextElement();
              if (!nic.isUp() || nic.isLoopback()) continue;
              for (InterfaceAddress a : nic.getInterfaceAddresses())
                if (a.getAddress() instanceof Inet4Address) {
                  List<String> hosts =
                      Protocol.subnet(a.getAddress().getHostAddress(), a.getNetworkPrefixLength());
                  if (!hosts.isEmpty()) {
                    count++;
                    for (String host : hosts) probe("http://" + host + ":3210");
                  }
                }
            }
          } catch (Exception ignored) {
          }
        });
    main.postDelayed(
        () -> {
          if (!closed) {
            listener.finished();
            close();
          }
        },
        45000);
  }

  private void probe(String value) {
    if (closed) return;
    final String base;
    try {
      base = Protocol.serverAddress(value);
    } catch (Exception e) {
      return;
    }
    if (!tried.add(base)) return;
    try {
      workers.execute(
          () -> {
            if (closed) return;
            try {
              JSONObject catalog = api.catalog(base);
              main.post(
                  () -> {
                    if (!closed) listener.found(base, catalog);
                  });
            } catch (Exception ignored) {
            }
          });
    } catch (RejectedExecutionException ignored) {
    }
  }

  private void browse() {
    if (nsd == null) return;
    browsing =
        new NsdManager.DiscoveryListener() {
          public void onDiscoveryStarted(String t) {}

          public void onDiscoveryStopped(String t) {}

          public void onStartDiscoveryFailed(String t, int code) {
            try {
              nsd.stopServiceDiscovery(this);
            } catch (Exception ignored) {
            }
          }

          public void onStopDiscoveryFailed(String t, int code) {}

          public void onServiceLost(NsdServiceInfo s) {}

          public void onServiceFound(NsdServiceInfo s) {
            main.post(
                () -> {
                  if (!closed && queue.size() < 32) {
                    queue.add(s);
                    resolveNext();
                  }
                });
          }
        };
    try {
      nsd.discoverServices("_mosaic-player._tcp.", NsdManager.PROTOCOL_DNS_SD, browsing);
    } catch (Exception ignored) {
    }
  }

  @SuppressWarnings("deprecation")
  private void resolveNext() {
    if (closed || resolving || queue.isEmpty()) return;
    resolving = true;
    NsdServiceInfo info = queue.remove();
    try {
      nsd.resolveService(
          info,
          new NsdManager.ResolveListener() {
            public void onResolveFailed(NsdServiceInfo s, int code) {
              main.post(
                  () -> {
                    resolving = false;
                    resolveNext();
                  });
            }

            public void onServiceResolved(NsdServiceInfo s) {
              main.post(
                  () -> {
                    resolving = false;
                    if (!closed && s.getHost() != null) {
                      String host = s.getHost().getHostAddress();
                      if (s.getHost() instanceof Inet6Address) host = "[" + host + "]";
                      probe("http://" + host + ":" + s.getPort());
                    }
                    resolveNext();
                  });
            }
          });
    } catch (Exception e) {
      resolving = false;
      resolveNext();
    }
  }

  @Override
  public void close() {
    if (closed) return;
    closed = true;
    main.removeCallbacksAndMessages(null);
    workers.shutdownNow();
    api.close();
    if (nsd != null && browsing != null)
      try {
        nsd.stopServiceDiscovery(browsing);
      } catch (Exception ignored) {
      }
    if (multicast != null && multicast.isHeld()) multicast.release();
    queue.clear();
  }
}
