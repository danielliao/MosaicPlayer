package local.mosaic.tv;

import java.util.*;
import org.json.*;

/** UTC manifests are compiled by the server; clients never interpret local time zones. */
public final class ProgramTimeline {
  private ProgramTimeline() {}

  public static final class Cursor {
    public final String mediaId;
    public final long positionMs, durationMs, itemEpoch;

    Cursor(String id, long position, long duration, long epoch) {
      mediaId = id;
      positionMs = position;
      durationMs = duration;
      itemEpoch = epoch;
    }
  }

  public static final class Selection {
    public final JSONObject program;
    public final Cursor visual, music;
    public final long anchor;

    Selection(JSONObject p, long a, long now) throws JSONException {
      program = p;
      anchor = a;
      visual = cursor(p.getJSONArray("playlist"), a, now);
      music = cursor(p.optJSONArray("music"), a, now);
    }
  }

  public static Selection resolve(JSONObject manifest, long now) throws JSONException {
    long anchor = manifest.getLong("activateAt");
    if (now < anchor) return null;
    JSONObject p = manifest.getJSONObject("defaultProgram");
    if (now >= anchor && now < manifest.getLong("validUntil")) {
      JSONArray intervals = manifest.getJSONArray("intervals");
      int low = 0, high = intervals.length() - 1;
      while (low <= high) {
        int middle = (low + high) >>> 1;
        JSONObject slot = intervals.getJSONObject(middle);
        if (now < slot.getLong("start")) high = middle - 1;
        else if (now >= slot.getLong("end")) low = middle + 1;
        else {
          p = slot.getJSONObject("program");
          anchor = slot.getLong("start");
          break;
        }
      }
    }
    return new Selection(p, anchor, Math.max(now, anchor));
  }

  private static Cursor cursor(JSONArray list, long anchor, long now) throws JSONException {
    if (list == null || list.length() == 0) return null;
    long duration = 0;
    for (int i = 0; i < list.length(); i++) {
      long d = list.getJSONObject(i).getLong("durationMs");
      if (d <= 0 || d > 86400000L || duration > Long.MAX_VALUE - d)
        throw new JSONException("无效节目时长");
      duration += d;
    }
    long offset = Math.floorMod(now - anchor, duration), start = now - offset;
    for (int i = 0; i < list.length(); i++) {
      JSONObject item = list.getJSONObject(i);
      long d = item.getLong("durationMs");
      if (offset < d) return new Cursor(item.getString("mediaId"), offset, d, start);
      offset -= d;
      start += d;
    }
    throw new JSONException("无效节目列表");
  }

  public static Set<String> dependencies(JSONObject manifest) throws JSONException {
    if (manifest.getLong("validUntil") <= manifest.getLong("activateAt"))
      throw new JSONException("无效节目覆盖范围");
    Set<String> ids = new LinkedHashSet<>();
    collect(manifest.getJSONObject("defaultProgram"), ids);
    JSONArray list = manifest.getJSONArray("intervals");
    long previous = Long.MIN_VALUE;
    for (int i = 0; i < list.length(); i++) {
      JSONObject slot = list.getJSONObject(i);
      long start = slot.getLong("start"), end = slot.getLong("end");
      if (end <= start || start < previous) throw new JSONException("节目时段重叠或无效");
      previous = end;
      collect(slot.getJSONObject("program"), ids);
    }
    return ids;
  }

  private static void collect(JSONObject program, Set<String> ids) throws JSONException {
    JSONArray visual = program.getJSONArray("playlist");
    if (visual.length() == 0) throw new JSONException("节目必须包含画面");
    for (String key : new String[] {"playlist", "music"}) {
      JSONArray list = program.optJSONArray(key);
      if (list == null) continue;
      cursor(list, 0, 0);
      for (int i = 0; i < list.length(); i++) ids.add(list.getJSONObject(i).getString("mediaId"));
    }
  }
}
