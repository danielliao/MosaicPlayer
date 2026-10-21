package local.mosaic.tv;

import android.content.Context;
import android.graphics.*;
import android.net.Uri;
import android.os.*;
import androidx.media3.common.*;
import androidx.media3.exoplayer.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

final class PlaybackEngine implements SyncTransport.Listener, AutoCloseable {
  interface Events {
    void status(String text);

    void connected();

    void contentVisible(boolean visible);

    void diagnostics(String text);
  }

  private final PlaybackEvidence proofTracker=new PlaybackEvidence();
  private final ProofReporter proof;
  private final Context context;
  private final WallView wall;
  private final Events events;
  private final String screenId;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService files = Executors.newSingleThreadExecutor();
  private final ApiClient api = new ApiClient();
  private final MediaCache cache;
  private final SyncTransport transport;
  private final ProgramSession programs;
  private final DeviceOperations operations;
  private ExoPlayer musicPlayer;
  private String musicId;
  private boolean musicLoading, audioFocusLost;
  private String audioStatus = "muted";
  private final PlaybackCorrection musicCorrection = new PlaybackCorrection();
  private JSONObject state;
  private Loaded current, prepared;
  private String loadingId,
      readySent,
      failedId,
      programReadyId,
      programReadyMedia,
      programReadyManifest;
  private Future<?> download;
  private int generation;
  private boolean closed;
  private long lastReport, lastRevision = -1, retryAt;
  private final PlaybackCorrection correction = new PlaybackCorrection();
  private double lastDrift;
  private String status = "idle",
      displayedProgramId,
      displayedProgramVersionId,
      displayedPreparationId;
  private long displayedPlaybackRevision = -1;
  private final PlaybackDiagnostics diagnostics = new PlaybackDiagnostics();
  private boolean correctionsEnabled = true;
  private long correctionSeeks, rateChanges, rebufferCount, lastTickAt, maxTickGap;

  boolean toggleCorrections() {
    correctionsEnabled = !correctionsEnabled;
    return correctionsEnabled;
  }

  private static final class Loaded {
    JSONObject media;
    File file;
    Bitmap bitmap;
    ExoPlayer player;
    boolean ready, audioOutput, audioFocusLost;
    String decoderName = "unknown";

    void release() {
      if (player != null) player.release();
      if (bitmap != null) bitmap.recycle();
    }
  }

  PlaybackEngine(
      Context context, WallView wall, String base, String key, String screenId, Events events) {
    this.context = context;
    proof=new ProofReporter(context,api,base,key,screenId);
    this.wall = wall;
    this.screenId = screenId;
    this.events = events;
    cache = new MediaCache(new File(context.getFilesDir(), "media"), api, base, key);
    transport =
        new SyncTransport(
            api, base, key, screenId, r -> main.post(r), SystemClock::elapsedRealtime, this);
    try {
      programs =
          new ProgramSession(
              context.getFilesDir(),
              cache,
              base + "\n" + key + "\n" + screenId,
              main,
              new ProgramSession.Events() {
                public void ready(String id) {
                  PlaybackEngine.this.stageProgram(id);
                }

                public void failed(String id, String error) {
                  transport.send(
                      Protocol.put(
                          Protocol.put(Protocol.message("failed"), "id", id), "error", error));
                  events.status("节目准备失败：" + error);
                }

                public void status(String text) {
                  events.status(text);
                }
              });
    } catch (Exception e) {
      throw new IllegalStateException("无法创建节目存储", e);
    }
    operations =
        new DeviceOperations(
            context,
            wall,
            api,
            base,
            key,
            main,
            events::status,
            () -> current == null ? null : displayedProgramId,
            () -> current == null ? null : current.media.optString("id"));
  }

  void start() {
    programs.restore(
        () -> {
          try {
            JSONObject restored = programs.render((long) transport.now());
            if (restored != null) {
              state = restored;
              reconcile();
              events.status("正在恢复离线节目");
            }
          } catch (Exception e) {
            events.status("离线节目不可用");
          }
        });
    transport.start();
    main.post(tick);
  }

  @Override
  public void state(JSONObject next) {
    if (closed) return;
    if (current != null) programs.protect(current.file);
    JSONObject incomingPending = next.optJSONObject("pendingProgram"),
        incomingProgram = next.optJSONObject("program");
    if (programReadyId != null
        && (incomingPending == null || !programReadyId.equals(incomingPending.optString("id")))
        && (incomingProgram == null
            || !incomingProgram.optString("id").equals(programReadyManifest))) {
      programReadyId = null;
      programReadyMedia = null;
      programReadyManifest = null;
    }
    programs.accept(next);
    if (next.optJSONObject("program") == null) state = next;
    reconcile();
  }

  @Override
  public void command(JSONObject command) {
    operations.command(command);
  }

  void installUpdate() {
    operations.offerInstall();
  }

  void installResult(int result) {
    operations.installResult(result);
  }

  @Override
  public void connection(boolean online, String detail) {
    if (online) {
      readySent = null;
      events.connected();
    }
    events.status(detail);
  }

  private void reconcile() {
    if (state == null || closed) return;
    try {
      JSONObject pending = state.optJSONObject("pending"),
          playback = state.getJSONObject("playback");
      String desired =
          pending == null ? playback.optString("mediaId", "") : pending.optString("mediaId", "");
      if (desired.equals("null")) desired = "";
      if (programReadyId != null
          && (desired.isEmpty()
              || current != null && desired.equals(current.media.optString("id")))) {
        maybeReadyProgram();
        return;
      }
      if (desired.isEmpty()) {
        cancelLoading();
        releasePrepared();
        if (current != null) {
          wall.clear();
          current.release();
          current = null;
        }
        status = "idle";
        events.contentVisible(false);
        wall.setKeepScreenOn(false);
        events.status("已连接，等待后台选择素材");
        return;
      }
      if (current != null && desired.equals(current.media.optString("id"))) {
        if (programs.programId() != null) return;
        cancelLoading();
        releasePrepared();
        if (pending != null) ready(pending.optString("id"));
        return;
      }
      if (prepared != null && desired.equals(prepared.media.optString("id"))) {
        if (prepared.ready && pending != null) ready(pending.optString("id"));
        return;
      }
      if (desired.equals(loadingId)) return;
      if (desired.equals(failedId) && SystemClock.elapsedRealtime() < retryAt) return;
      cancelLoading();
      releasePrepared();
      load(Protocol.media(state, desired));
    } catch (Exception e) {
      events.status("配置错误：" + e.getMessage());
    }
  }

  private void stageProgram(String id) {
    if (closed) return;
    try {
      JSONObject media = programs.preparedMedia(id);
      if (media == null) return;
      programReadyId = id;
      programReadyManifest = programs.preparedManifestId(id);
      programReadyMedia = media.optString("id");
      JSONObject legacy = state == null ? null : state.optJSONObject("playback");
      String legacyId = legacy == null ? "" : legacy.optString("mediaId", "");
      if (current == null
          && !legacyId.isEmpty()
          && !"null".equals(legacyId)
          && !programReadyMedia.equals(legacyId)) return;
      if (current != null
          && programReadyMedia.equals(current.media.optString("id"))
          && current.ready) {
        ready(id);
        return;
      }
      if (prepared != null && programReadyMedia.equals(prepared.media.optString("id"))) {
        maybeReadyProgram();
        return;
      }
      if (programReadyMedia.equals(loadingId)) return;
      cancelLoading();
      releasePrepared();
      load(media);
    } catch (Exception e) {
      transport.send(
          Protocol.put(
              Protocol.put(Protocol.message("failed"), "id", id), "error", e.getMessage()));
    }
  }

  private void maybeReadyProgram() {
    if (programReadyId != null
        && prepared != null
        && prepared.ready
        && programReadyMedia.equals(prepared.media.optString("id"))) ready(programReadyId);
  }

  private void ready(String id) {
    if (!id.equals(readySent) && transport.send(Protocol.put(Protocol.message("ready"), "id", id)))
      readySent = id;
  }

  private void cancelLoading() {
    generation++;
    loadingId = null;
    if (download != null) {
      download.cancel(true);
      download = null;
    }
  }

  private void releasePrepared() {
    if (prepared != null) {
      prepared.release();
      prepared = null;
    }
  }

  private void load(JSONObject media) {
    final int token = ++generation;
    loadingId = media.optString("id");
    status = "loading";
    events.status("正在缓存 " + media.optString("name") + "，准备同步播放");
    Set<File> protectedFiles = new HashSet<>(programs.protectedFiles());
    if (current != null) protectedFiles.add(current.file);
    download =
        files.submit(
            () -> {
              Loaded result = new Loaded();
              result.media = media;
              try {
                result.file = cache.fetch(media, protectedFiles);
                if ("image".equals(media.optString("type"))) {
                  BitmapFactory.Options opts = new BitmapFactory.Options();
                  opts.inJustDecodeBounds = true;
                  BitmapFactory.decodeFile(result.file.getPath(), opts);
                  if (opts.outWidth <= 0 || opts.outHeight <= 0) throw new IOException("图片无法解码");
                  int sample = 1;
                  long budget = Math.min(32L * 1024 * 1024, Runtime.getRuntime().maxMemory() / 8);
                  while ((long) (opts.outWidth / sample) * (opts.outHeight / sample) * 4 > budget
                      || opts.outWidth / sample > 4096
                      || opts.outHeight / sample > 4096) sample *= 2;
                  opts.inJustDecodeBounds = false;
                  opts.inSampleSize = sample;
                  result.bitmap = BitmapFactory.decodeFile(result.file.getPath(), opts);
                  if (result.bitmap == null) throw new IOException("图片无法解码");
                  result.ready = true;
                }
                main.post(
                    () -> {
                      if (closed || token != generation) {
                        result.release();
                        return;
                      }
                      loadingId = null;
                      prepared = result;
                      if (result.bitmap != null) {
                        maybeReadyProgram();
                        reconcile();
                        return;
                      }
                      prepareVideo(result, token);
                    });
              } catch (Exception e) {
                main.post(
                    () -> {
                      result.release();
                      if (!closed && token == generation) failure(media, e.getMessage());
                    });
              }
            });
  }

  @androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
  private void prepareVideo(Loaded item, int token) {
    try {
      item.player =
          new ExoPlayer.Builder(context)
              .setLoadControl(
                  new DefaultLoadControl.Builder()
                      .setBufferDurationsMs(1000, 5000, 250, 500)
                      .build())
              .build();
      item.player.addAnalyticsListener(
          new androidx.media3.exoplayer.analytics.AnalyticsListener() {
            @Override
            public void onVideoDecoderInitialized(
                EventTime time, String name, long timestamp, long duration) {
              item.decoderName = name;
            }
          });
      item.player.setVolume(0);
      item.player.setRepeatMode(Player.REPEAT_MODE_ONE);
      item.player.setSeekParameters(SeekParameters.EXACT);
      item.player.addListener(
          new Player.Listener() {
            @Override
            public void onIsPlayingChanged(boolean playing) { if(!playing && current==item)proofTracker.reset(); }

            @Override
            public void onPlaybackStateChanged(int state) {
              if (closed || prepared != item && current != item) return;
              if (state == Player.STATE_BUFFERING && current == item) proofTracker.reset();
              if (state == Player.STATE_BUFFERING && item.ready && current == item) rebufferCount++;
              if (state == Player.STATE_READY && !item.ready) {
                item.ready = true;
                maybeReadyProgram();
                reconcile();
              }
            }

            @Override
            public void onPlayWhenReadyChanged(boolean ready, int reason) {
              if(!ready && current==item)proofTracker.reset();
              if (current == item
                  && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS) {
                item.audioFocusLost = true;
                events.status("视频原声失去音频焦点");
              }
            }

            @Override
            public void onPlayerError(PlaybackException error) {
              if (!closed && (prepared == item || current == item))
                failure(item.media, "电视无法解码该视频，请使用 H.264 / MP4：" + error.getErrorCodeName());
            }
          });
      item.player.setMediaItem(MediaItem.fromUri(Uri.fromFile(item.file)));
      item.player.prepare();
      main.postDelayed(
          () -> {
            if (!closed && token == generation && prepared == item && !item.ready)
              failure(item.media, "视频准备超时，请检查电视支持的编码格式");
          },
          20000);
    } catch (Exception e) {
      failure(item.media, e.getMessage());
    }
  }

  private void failure(JSONObject media, String reason) {
    failedId = media.optString("id");
    retryAt = SystemClock.elapsedRealtime() + 10000;
    loadingId = null;
    status = "error";
    if (prepared != null && prepared.media == media) releasePrepared();
    if (current != null && current.media == media) {
      wall.clear();
      current.release();
      current = null;
      events.contentVisible(false);
    }
    if (programReadyId != null && failedId.equals(programReadyMedia))
      transport.send(
          Protocol.put(
              Protocol.put(Protocol.message("failed"), "id", programReadyId), "error", reason));
    JSONObject pending = state == null ? null : state.optJSONObject("pending");
    if (pending != null && failedId.equals(pending.optString("mediaId")))
      transport.send(Protocol.put(Protocol.message("failed"), "id", pending.optString("id")));
    events.status(reason == null ? "媒体加载失败" : reason);
  }

  private final Runnable tick =
      new Runnable() {
        @Override
        public void run() {
          if (closed) return;
          try {
            long tickAt = SystemClock.elapsedRealtime();
            if (lastTickAt != 0) maxTickGap = Math.max(maxTickGap, tickAt - lastTickAt);
            lastTickAt = tickAt;
            observeProof();
            JSONObject scheduled = programs.render((long) transport.now());
            if (scheduled != null && scheduled != state) {
              state = scheduled;
              reconcile();
            }
            updatePlayback();
            observeProof();
            if (programReadyId != null) stageProgram(programReadyId);
            if (programReadyManifest != null && programReadyManifest.equals(displayedProgramId)) {
              programReadyId = null;
              programReadyMedia = null;
              programReadyManifest = null;
            }
            updateMusic();
            preloadNext();
            if (SystemClock.elapsedRealtime() - lastReport >= 1000) {
              lastReport = SystemClock.elapsedRealtime();
              JSONObject report = Protocol.message("report");
              Protocol.put(report, "client", "android-tv");
              Protocol.put(report, "status", status);
              Protocol.put(report, "version", BuildConfig.VERSION_NAME);
              Protocol.put(report, "versionCode", BuildConfig.VERSION_CODE);
              Protocol.put(
                  report, "capabilities", new JSONArray(ApiClient.CAPABILITIES.split(",")));
              Protocol.put(report, "cacheBudgetBytes", MediaCache.LIMIT);
              Protocol.put(report, "programId", current == null ? null : displayedProgramId);
              Protocol.put(
                  report, "programVersionId", current == null ? null : displayedProgramVersionId);
              Protocol.put(report, "preparation", programs.preparation());
              Protocol.put(report, "audioStatus", audioStatus);
              Protocol.put(
                  report, "mediaId", current == null ? null : current.media.optString("id"));
              Protocol.put(report, "updateStatus", operations.updateStatus());
              Protocol.put(report, "updateError", operations.updateError());
              if (current != null && displayedPlaybackRevision >= 0) {
                Protocol.put(report, "preparationId", displayedPreparationId);
                Protocol.put(report, "playbackRevision", displayedPlaybackRevision);
              }
              Protocol.put(
                  report, "model", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL);
              Protocol.put(report, "sdk", android.os.Build.VERSION.SDK_INT);
              Protocol.put(
                  report,
                  "scheduleExpired",
                  state != null
                      && state.optJSONObject("program") != null
                      && transport.now() >= state.optJSONObject("program").optLong("validUntil"));
              Protocol.put(report, "width", wall.getWidth());
              Protocol.put(report, "height", wall.getHeight());
              if (transport.clock.ready()) {
                Protocol.put(report, "rtt", transport.clock.rtt());
                Protocol.put(report, "drift", lastDrift * 1000);
              }
              JSONObject details = collectDiagnostics();
              Protocol.put(report, "diagnostics", details);
              events.diagnostics(
                  String.format(
                      java.util.Locale.CHINA,
                      "v%s · %s · %s\n"
                          + "渲染 %.1f fps · 丢帧 %d · 校正跳转 %d · 变速 %d · 缓冲 %d\n"
                          + "自动校时：%s · 解码器：%s",
                      BuildConfig.VERSION_NAME,
                      android.os.Build.MODEL,
                      details.optString("playerState"),
                      details.optDouble("renderFps"),
                      details.optInt("droppedFrames"),
                      correctionSeeks,
                      rateChanges,
                      rebufferCount,
                      correctionsEnabled ? "开启" : "已暂停（诊断）",
                      details.optString("decoder")));
              transport.report(report);
              maxTickGap = 0;
              reconcile();
            }
          } catch (Exception e) {
            proofTracker.reset();
            events.status("播放配置错误：" + e.getMessage());
          }
          long delay = 50;
          JSONObject playback = state == null ? null : state.optJSONObject("playback");
          if (playback != null && !playback.optBoolean("paused") && transport.clock.ready()) {
            double untilStart = playback.optDouble("epoch") - transport.now();
            if (untilStart > 0) delay = Math.max(1, Math.min(50, (long) Math.ceil(untilStart)));
          }
          main.postDelayed(this, delay);
        }
      };

  @androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
  private JSONObject collectDiagnostics() {
    ExoPlayer player = current == null ? null : current.player;
    DecoderCounters counters = player == null ? null : player.getVideoDecoderCounters();
    JSONObject d = new JSONObject();
    if (counters != null) {
      counters.ensureUpdated();
      d =
          diagnostics.sample(
              counters,
              SystemClock.elapsedRealtime(),
              counters.renderedOutputBufferCount,
              counters.droppedBufferCount,
              counters.skippedOutputBufferCount);
    }
    Protocol.put(d, "version", BuildConfig.VERSION_NAME);
    Protocol.put(d, "model", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL);
    Protocol.put(d, "sdk", android.os.Build.VERSION.SDK_INT);
    Protocol.put(d, "surface", "texture");
    Protocol.put(d, "correctionsEnabled", correctionsEnabled);
    Protocol.put(d, "correctionSeeks", correctionSeeks);
    Protocol.put(d, "rateChanges", rateChanges);
    Protocol.put(d, "rebufferCount", rebufferCount);
    Protocol.put(d, "maxTickGapMs", maxTickGap);
    Protocol.put(d, "decoder", current == null ? "none" : current.decoderName);
    if (player != null) {
      String[] names = {"unknown", "idle", "buffering", "ready", "ended"};
      Protocol.put(d, "playerState", names[player.getPlaybackState()]);
      Protocol.put(d, "positionMs", player.getCurrentPosition());
      Protocol.put(d, "bufferedMs", player.getTotalBufferedDuration());
      Protocol.put(d, "speed", player.getPlaybackParameters().speed);
      Protocol.put(d, "isPlaying", player.isPlaying());
    }
    return d;
  }

  private void updatePlayback() throws Exception {
    if (state == null) return;
    JSONObject p = state.getJSONObject("playback");
    String id = p.optString("mediaId", "");
    double now = transport.now();
    boolean paused = p.optBoolean("paused");
    if (!transport.clock.ready() && programs.programId() == null) {
      status = "waiting";
      return;
    }
    boolean due = paused || now >= p.optDouble("epoch");
    if (prepared != null && prepared.ready && id.equals(prepared.media.optString("id")) && due) {
      Loaded old = current;
      current = prepared;
      prepared = null;
      lastRevision = -1;
      correction.reset();
      wall.configure(
          state.getJSONObject("layout"),
          Protocol.screen(state, screenId),
          current.media.optDouble("width", 1920),
          current.media.optDouble("height", 1080));
      if (current.player != null) wall.showVideo(current.player);
      else wall.showImage(current.bitmap);
      if (old != null) old.release();
      failedId = null;
      events.contentVisible(true);
      events.status("正在显示 " + Protocol.screen(state, screenId).optString("name"));
    }
    if (current == null) {
      status = loadingId != null || prepared != null ? "loading" : "idle";
      return;
    }
    // A pending publication never interrupts the current media. Keep its old timeline until commit.
    if (!id.equals(current.media.optString("id"))) return;
    wall.configure(
        state.getJSONObject("layout"),
        Protocol.screen(state, screenId),
        current.media.optDouble("width", 1920),
        current.media.optDouble("height", 1080));
    if (due
        && (current.player == null || current.player.getPlaybackState() == Player.STATE_READY)) {
      displayedProgramId = programs.programId();
      displayedProgramVersionId = programs.programVersionId();
      displayedPreparationId =
          p.isNull("preparationId") ? null : p.optString("preparationId", null);
      displayedPlaybackRevision = p.optLong("revision", -1);
    }
    wall.setKeepScreenOn(!paused);
    status = paused ? "paused" : due ? "playing" : "waiting";
    if (current.player == null) {
      lastDrift = 0;
      return;
    }
    ExoPlayer player = current.player;
    ProgramTimeline.Selection resolvedProgram = programs.selection((long) now);
    double duration =
        resolvedProgram == null
            ? current.media.optDouble("duration", 0)
            : resolvedProgram.visual.durationMs / 1000.0;
    if (programs.programId() == null
        && player.getDuration() > 0
        && player.getDuration() != C.TIME_UNSET) duration = player.getDuration() / 1000.0;
    double target =
        SyncMath.position(paused, p.optDouble("position"), p.optDouble("epoch"), now, duration);
    lastDrift = SyncMath.drift(target, player.getCurrentPosition() / 1000.0, duration);
    long revision = p.optLong("revision"), elapsed = SystemClock.elapsedRealtime();
    PlaybackCorrection.Decision decision =
        correction.update(
            elapsed,
            lastDrift,
            revision,
            paused,
            due,
            player.getPlaybackState() == Player.STATE_READY,
            correctionsEnabled);
    if (decision.seek) {
      if (lastRevision == revision) correctionSeeks++;
      proofTracker.reset();
      player.seekTo((long) (target * 1000));
      lastRevision = revision;
    }
    if (player.getPlaybackParameters().speed != decision.speed) {
      rateChanges++;
      player.setPlaybackParameters(new PlaybackParameters(decision.speed));
    }
    ProgramTimeline.Selection program = resolvedProgram;
    boolean voice =
        program != null
            && screenId.equals(state.optString("audioScreenId"))
            && "video".equals(program.program.optString("audioMode"));
    if (voice != current.audioOutput) {
      current.audioOutput = voice;
      current.audioFocusLost = false;
      player.setAudioAttributes(
          new AudioAttributes.Builder()
              .setUsage(C.USAGE_MEDIA)
              .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
              .build(),
          voice);
    }
    player.setVolume(
        voice ? (float) Math.max(0, Math.min(1, program.program.optDouble("volume", 0))) : 0);
    player.setPlayWhenReady(!paused && due && !current.audioFocusLost);
  }

  private void observeProof() throws Exception {
    double now=transport.now();JSONObject p=state==null?null:state.optJSONObject("playback");
    ProgramTimeline.Selection selection=programs.selection((long)now);
    long duration=selection!=null?selection.visual.durationMs:current==null?0:Math.round(current.media.optDouble("duration",0)*1000);
    double epoch=p==null?0:p.optDouble("epoch");
    long start=selection!=null?(long)now-selection.visual.positionMs:duration>0?Math.round(epoch)+((long)Math.floor((now-epoch)/duration))*duration:0;
    boolean ready=current!=null&&p!=null&&current.media.optString("id").equals(p.optString("mediaId"))&&!p.optBoolean("paused")&&"playing".equals(status)&&now>=epoch&&(transport.clock.ready()||programs.programId()!=null)&&(current.bitmap!=null||current.player!=null&&current.player.isPlaying()&&current.player.getPlaybackState()==Player.STATE_READY&&Math.abs(lastDrift)<.18);
    if(current!=null){
      PlaybackEvidence.Sample sample=new PlaybackEvidence.Sample(current.media.optString("id"),programs.programId(),programs.programId()!=null?programs.programId():"direct:"+(p==null?-1:p.optLong("revision")),start,duration,now,ready&&(selection!=null||"video".equals(current.media.optString("type"))));
      sample.video=current.player!=null;sample.positionMs=current.player==null?0:current.player.getCurrentPosition();sample.sourceDurationMs=current.media.optDouble("duration",0)*1000;
      proof.add(proofTracker.observe(sample));
    }else proofTracker.reset();
    proof.flush();
  }

  private void preloadNext() throws Exception {
    if (programReadyId != null
        || current == null
        || prepared != null
        || loadingId != null
        || programs.programId() == null) return;
    long now = (long) transport.now();
    ProgramTimeline.Selection selection = programs.selection(now);
    if (selection == null) return;
    long remaining = selection.visual.durationMs - selection.visual.positionMs;
    if (remaining > 2000) return;
    ProgramTimeline.Selection next = programs.selection(now + remaining);
    if (!next.visual.mediaId.equals(current.media.optString("id")))
      load(Protocol.media(state, next.visual.mediaId));
  }

  private void updateMusic() throws Exception {
    ProgramTimeline.Selection selection = programs.selection((long) transport.now());
    boolean audible =
        selection != null
            && selection.music != null
            && state != null
            && screenId.equals(state.optString("audioScreenId"))
            && "music".equals(selection.program.optString("audioMode"));
    if (!audible) {
      boolean videoVoice =
          selection != null
              && state != null
              && screenId.equals(state.optString("audioScreenId"))
              && "video".equals(selection.program.optString("audioMode"))
              && current != null
              && current.player != null;
      audioStatus =
          videoVoice
              ? (current.audioFocusLost
                  ? "focus-lost"
                  : current.player.isPlaying() ? "video" : "buffering")
              : "muted";
      audioFocusLost = false;
      if (musicPlayer != null) {
        musicPlayer.release();
        musicPlayer = null;
      }
      musicId = null;
      return;
    }
    ProgramTimeline.Cursor cursor = selection.music;
    if (!cursor.mediaId.equals(musicId)) {
      if (musicLoading) return;
      musicLoading = true;
      audioStatus = "loading";
      String requested = cursor.mediaId;
      JSONObject media = Protocol.media(state, requested);
      Set<File> protect = new HashSet<>(programs.protectedFiles());
      files.execute(
          () -> {
            try {
              File audio = cache.fetch(media, protect);
              main.post(
                  () -> {
                    musicLoading = false;
                    if (closed) return;
                    if (musicPlayer != null) musicPlayer.release();
                    musicPlayer = new ExoPlayer.Builder(context).build();
                    musicId = requested;
                    musicCorrection.reset();
                    audioFocusLost = false;
                    audioStatus = "buffering";
                    musicPlayer.setAudioAttributes(
                        new AudioAttributes.Builder()
                            .setUsage(C.USAGE_MEDIA)
                            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                            .build(),
                        true);
                    musicPlayer.setRepeatMode(Player.REPEAT_MODE_ONE);
                    musicPlayer.addListener(
                        new Player.Listener() {
                          @Override
                          public void onPlayerError(PlaybackException e) {
                            events.status("音乐播放失败：" + e.getErrorCodeName());
                            audioStatus = "error";
                          }

                          @Override
                          public void onPlayWhenReadyChanged(boolean ready, int reason) {
                            if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS) {
                              events.status("音乐失去音频焦点");
                              audioStatus = "focus-lost";
                              audioFocusLost = true;
                            }
                          }
                        });
                    musicPlayer.setMediaItem(MediaItem.fromUri(Uri.fromFile(audio)));
                    musicPlayer.prepare();
                  });
            } catch (Exception e) {
              main.post(
                  () -> {
                    musicLoading = false;
                    audioStatus = "error";
                    events.status("音乐下载失败：" + e.getMessage());
                  });
            }
          });
      return;
    }
    if (musicPlayer == null) return;
    musicPlayer.setVolume(
        (float) Math.max(0, Math.min(1, selection.program.optDouble("volume", 0))));
    double drift =
        SyncMath.drift(
            cursor.positionMs / 1000.0,
            musicPlayer.getCurrentPosition() / 1000.0,
            cursor.durationMs / 1000.0);
    PlaybackCorrection.Decision decision =
        musicCorrection.update(
            SystemClock.elapsedRealtime(),
            drift,
            cursor.itemEpoch,
            false,
            true,
            musicPlayer.getPlaybackState() == Player.STATE_READY,
            correctionsEnabled);
    if (decision.seek) musicPlayer.seekTo(cursor.positionMs);
    if (musicPlayer.getPlaybackParameters().speed != decision.speed)
      musicPlayer.setPlaybackParameters(new PlaybackParameters(decision.speed));
    if (!audioFocusLost) {
      musicPlayer.setPlayWhenReady(true);
      audioStatus = musicPlayer.isPlaying() ? "playing" : "buffering";
    }
  }

  @Override
  public void close() {
    if (closed) return;
    closed = true;
    proofTracker.reset();proof.close();
    main.removeCallbacksAndMessages(null);
    transport.close();
    programs.close();
    operations.close();
    cache.cancel();
    if (musicPlayer != null) {
      musicPlayer.release();
      musicPlayer = null;
    }
    cancelLoading();
    files.shutdownNow();
    wall.clear();
    wall.setKeepScreenOn(false);
    if (current != null) {
      current.release();
      current = null;
    }
    releasePrepared();
    api.close();
  }
}
