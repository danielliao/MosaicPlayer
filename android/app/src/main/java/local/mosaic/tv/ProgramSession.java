package local.mosaic.tv;

import android.os.*;
import android.util.AtomicFile;
import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Whole-manifest preparation is independent of the current renderer. All I/O stays off main. */
final class ProgramSession implements AutoCloseable {
  interface Events {
    void ready(String id);

    void failed(String id, String error);

    void status(String status);
  }

  private final MediaCache cache;
  private final AtomicFile snapshot;
  private final Handler main;
  private final Events events;
  private final ExecutorService io = Executors.newSingleThreadExecutor();
  private final Map<String, JSONObject> cached = new HashMap<>();
  private JSONObject incoming, activeState, activeManifest;
  private volatile Set<File> protectedFiles = Collections.emptySet();
  private String preparing, preparedPending, renderKey;
  private JSONObject rendered;
  private String layoutKey = "";
  private boolean closed, expiredNotified, clockWarning;
  private String preparationId, preparationStatus = "idle", preparationError;
  private int completed, total;
  private int generation;

  ProgramSession(File directory, MediaCache cache, String scope, Handler main, Events events)
      throws Exception {
    this.cache = cache;
    this.main = main;
    this.events = events;
    StringBuilder id = new StringBuilder();
    for (byte b :
        MessageDigest.getInstance("SHA-256")
            .digest(scope.getBytes(java.nio.charset.StandardCharsets.UTF_8)))
      id.append(String.format(java.util.Locale.ROOT, "%02x", b));
    snapshot = new AtomicFile(new File(directory, "program-" + id + ".json"));
  }

  void restore(Runnable changed) {
    final int token = generation;
    io.execute(
        () -> {
          try (InputStream in = snapshot.openRead()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) != -1) {
              out.write(b, 0, n);
              if (out.size() > 4 * 1024 * 1024) throw new IOException("离线节目过大");
            }
            JSONObject saved = new JSONObject(out.toString("UTF-8")),
                manifest = saved.getJSONObject("program");
            Set<File> files = prepareFiles(saved, manifest, Collections.emptySet());
            main.post(
                () -> {
                  if (closed || token != generation || incoming != null) return;
                  activeState = saved;
                  activeManifest = manifest;
                  cached.put(manifest.optString("id"), saved);
                  protectedFiles = files;
                  changed.run();
                });
          } catch (Exception ignored) {
            /* No incomplete/corrupted offline state is played. */
          }
        });
  }

  void accept(JSONObject next) {
    incoming = next;
    JSONObject incomingLayout = next.optJSONObject("layout");
    layoutKey = incomingLayout == null ? "" : incomingLayout.toString();
    JSONObject active = next.optJSONObject("program"),
        pending = next.optJSONObject("pendingProgram");
    if (active == null && activeManifest != null) {
      activeManifest = null;
      activeState = null;
      renderKey = null;
      rendered = null;
      generation++;
      preparing = null;
      io.execute(snapshot::delete);
    }
    if (pending == null && preparedPending != null) {
      preparedPending = null;
      if (activeManifest != null) {
        try {
          Set<File> keep = new HashSet<>();
          for (String dep : ProgramTimeline.dependencies(activeManifest))
            keep.add(cache.path(Protocol.media(activeState, dep)));
          if (active != null && cached.containsKey(active.optString("id")))
            for (String dep : ProgramTimeline.dependencies(active))
              keep.add(cache.path(Protocol.media(next, dep)));
          protectedFiles = keep;
          String activeId = activeManifest.optString("id"),
              proposedId = active == null ? "" : active.optString("id");
          cached.keySet().removeIf(k -> !k.equals(activeId) && !k.equals(proposedId));
        } catch (Exception e) {
          events.status("节目缓存保护计算失败");
        }
      }
    }
    if (pending == null && preparing != null && !preparing.endsWith(":active")) {
      generation++;
      preparing = null;
    }
    if (active != null) prepare(next, active, null);
    if (pending != null && (active == null || cached.containsKey(active.optString("id"))))
      prepare(next, pending.optJSONObject("program"), pending.optString("id"));
  }

  private void prepare(JSONObject envelope, JSONObject manifest, String pendingId) {
    if (manifest == null || closed) return;
    String id = manifest.optString("id");
    if (cached.containsKey(id)) {
      // Commit can change activateAt while preserving manifest identity and media hashes.
      JSONObject stored = cached.get(id);
      Protocol.put(stored, "program", manifest);
      if (pendingId != null) {
        preparedPending = pendingId;
        events.ready(pendingId);
      }
      return;
    }
    String signature = id + ":" + (pendingId == null ? "active" : pendingId);
    if (signature.equals(preparing) || preparing != null) return;
    preparing = signature;
    preparationId = pendingId == null ? id : pendingId;
    preparationStatus = "downloading";
    preparationError = null;
    completed = 0;
    total = 0;
    events.status("节目预下载中");
    int token = generation;
    Set<File> protect = new HashSet<>(protectedFiles);
    io.execute(
        () -> {
          try {
            Set<File> ready = prepareFiles(envelope, manifest, protect);
            JSONObject stored = new JSONObject(envelope.toString());
            Protocol.put(stored, "program", manifest);
            stored.remove("pendingProgram");
            main.post(
                () -> {
                  if (closed || token != generation) return;
                  preparing = null;
                  JSONObject
                      latestPending =
                          incoming == null ? null : incoming.optJSONObject("pendingProgram"),
                      latestActive = incoming == null ? null : incoming.optJSONObject("program");
                  if (pendingId != null
                      && (latestPending == null || !pendingId.equals(latestPending.optString("id")))
                      && (latestActive == null || !id.equals(latestActive.optString("id")))) {
                    if (incoming != null) accept(incoming);
                    return;
                  }
                  preparationStatus = "ready";
                  completed = total;
                  cached.put(id, stored);
                  Set<File> keep = new HashSet<>(protectedFiles);
                  keep.addAll(ready);
                  protectedFiles = keep;
                  events.status("节目资源已准备");
                  if (pendingId != null) {
                    preparedPending = pendingId;
                    events.ready(pendingId);
                  }
                  if (incoming != null) accept(incoming);
                });
          } catch (Exception e) {
            main.post(
                () -> {
                  if (closed || token != generation) return;
                  preparing = null;
                  preparationStatus = "failed";
                  preparationError = e.getMessage();
                  events.failed(pendingId == null ? id : pendingId, e.getMessage());
                });
          }
        });
  }

  private Set<File> prepareFiles(JSONObject envelope, JSONObject manifest, Set<File> protect)
      throws Exception {
    Set<String> ids = ProgramTimeline.dependencies(manifest);
    Set<File> all = new HashSet<>(protect);
    long budget = 0;
    for (String id : ids) {
      JSONObject media = Protocol.media(envelope, id);
      String sha = media.optString("sha256");
      if (!sha.matches("[a-fA-F0-9]{64}")) throw new IOException("节目资源缺少 SHA-256");
      budget += media.getLong("size");
      if (budget > MediaCache.LIMIT) throw new IOException("节目超过 1 GiB 缓存预算");
      all.add(cache.path(media));
    }
    main.post(
        () -> {
          if (!closed) total = ids.size();
        });
    int count = 0;
    for (String id : ids) {
      cache.fetch(Protocol.media(envelope, id), all);
      int done = ++count;
      main.post(
          () -> {
            if (!closed) completed = done;
          });
    }
    return all;
  }

  String preparedManifestId(String pendingId) {
    JSONObject pending = incoming == null ? null : incoming.optJSONObject("pendingProgram");
    return pending != null && pendingId.equals(pending.optString("id"))
        ? pending.optJSONObject("program").optString("id")
        : null;
  }

  JSONObject preparedMedia(String pendingId) throws Exception {
    JSONObject pending = incoming == null ? null : incoming.optJSONObject("pendingProgram");
    if (pending == null || !pendingId.equals(pending.optString("id"))) return null;
    JSONObject manifest = pending.getJSONObject("program");
    ProgramTimeline.Selection first =
        ProgramTimeline.resolve(manifest, manifest.getLong("activateAt"));
    return Protocol.media(incoming, first.visual.mediaId);
  }

  void protect(File file) {
    if (file != null) {
      Set<File> keep = new HashSet<>(protectedFiles);
      keep.add(file);
      protectedFiles = keep;
    }
  }

  Set<File> protectedFiles() {
    return protectedFiles;
  }

  JSONObject preparation() {
    JSONObject report = new JSONObject();
    Protocol.put(report, "id", preparationId);
    Protocol.put(report, "status", preparationStatus);
    Protocol.put(report, "completed", completed);
    Protocol.put(report, "total", total);
    Protocol.put(report, "error", preparationError);
    return report;
  }

  String programVersionId() {
    return activeManifest == null ? null : activeManifest.optString("versionId");
  }

  String programId() {
    return activeManifest == null ? null : activeManifest.optString("id");
  }

  ProgramTimeline.Selection selection(long now) throws JSONException {
    return activeManifest == null
        ? null
        : ProgramTimeline.resolve(
            activeManifest, now < 1577836800000L ? activeManifest.optLong("activateAt") : now);
  }

  JSONObject render(long now) throws Exception {
    JSONObject proposed = incoming == null ? null : incoming.optJSONObject("program");
    if (proposed != null
        && now >= proposed.optLong("activateAt")
        && cached.containsKey(proposed.optString("id"))) {
      String id = proposed.optString("id");
      if (activeManifest == null || !id.equals(activeManifest.optString("id"))) {
        activeState = cached.get(id);
        activeManifest = proposed;
        expiredNotified = false;
        clockWarning = false;
        renderKey = null;
        JSONObject saved = new JSONObject();
        Protocol.put(saved, "layout", activeState.getJSONObject("layout"));
        Protocol.put(saved, "media", activeState.getJSONArray("media"));
        Protocol.put(saved, "playback", activeState.getJSONObject("playback"));
        Protocol.put(saved, "audioScreenId", incoming.opt("audioScreenId"));
        Protocol.put(saved, "program", proposed);
        Set<File> keep = new HashSet<>();
        for (String dependency : ProgramTimeline.dependencies(proposed))
          keep.add(cache.path(Protocol.media(activeState, dependency)));
        JSONObject pending = incoming.optJSONObject("pendingProgram");
        if (pending != null)
          for (String dependency : ProgramTimeline.dependencies(pending.getJSONObject("program")))
            keep.add(cache.path(Protocol.media(incoming, dependency)));
        protectedFiles = keep;
        cached
            .keySet()
            .removeIf(
                k ->
                    !k.equals(id)
                        && (pending == null
                            || !k.equals(pending.optJSONObject("program").optString("id"))));
        io.execute(
            () -> {
              FileOutputStream out = null;
              try {
                out = snapshot.startWrite();
                out.write(saved.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                snapshot.finishWrite(out);
              } catch (Exception e) {
                if (out != null) snapshot.failWrite(out);
                main.post(() -> events.status("离线节目保存失败"));
              }
            });
      }
    }
    if (activeManifest == null) return null;
    if (now >= activeManifest.optLong("validUntil") && !expiredNotified) {
      expiredNotified = true;
      events.status("节目计划已过期，继续播放已缓存的默认节目");
    }
    if (now < 1577836800000L && !clockWarning) {
      clockWarning = true;
      events.status("系统时间异常，使用默认节目并等待联网校时");
    }
    ProgramTimeline.Selection s = selection(now);
    if (s == null) return rendered;
    String key = activeManifest.optString("id") + ":" + s.visual.mediaId + ":" + s.visual.itemEpoch;
    // Audio policy may change without a playlist cursor change.
    String audio =
        incoming == null
            ? activeState.optString("audioScreenId")
            : incoming.optString("audioScreenId");
    key += ":" + audio + ":" + layoutKey;
    if (!key.equals(renderKey)) {
      rendered = new JSONObject();
      Protocol.put(
          rendered,
          "layout",
          incoming == null
              ? activeState.getJSONObject("layout")
              : incoming.getJSONObject("layout"));
      Protocol.put(rendered, "media", activeState.getJSONArray("media"));
      Protocol.put(rendered, "program", activeManifest);
      Protocol.put(rendered, "audioScreenId", audio);

      Protocol.put(
          rendered,
          "playback",
          new JSONObject()
              .put("mediaId", s.visual.mediaId)
              .put("epoch", s.visual.itemEpoch)
              .put("position", 0)
              .put("paused", false)
              .put("revision", s.visual.itemEpoch));
      renderKey = key;
    }
    return rendered;
  }

  @Override
  public void close() {
    closed = true;
    generation++;
    io.shutdownNow();
  }
}
