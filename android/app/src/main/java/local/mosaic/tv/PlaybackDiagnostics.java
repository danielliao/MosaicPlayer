package local.mosaic.tv;

import org.json.JSONObject;

/** Samples renderer counters without changing playback; FPS is not an optical measurement. */
final class PlaybackDiagnostics {
  private Object source;
  private long previousAt;
  private int previousRendered;

  JSONObject sample(Object source, long now, int rendered, int dropped, int skipped) {
    double fps = 0;
    if (this.source == source && now > previousAt && rendered >= previousRendered)
      fps = (rendered - previousRendered) * 1000.0 / (now - previousAt);
    this.source = source;
    previousAt = now;
    previousRendered = rendered;
    JSONObject value = new JSONObject();
    Protocol.put(value, "renderFps", Math.round(fps * 10) / 10.0);
    Protocol.put(value, "renderedFrames", rendered);
    Protocol.put(value, "droppedFrames", dropped);
    Protocol.put(value, "skippedFrames", skipped);
    return value;
  }
}
