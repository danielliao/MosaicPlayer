package local.mosaic.tv;

import static org.junit.Assert.*;

import org.json.*;
import org.junit.Test;

public class ProgramTimelineTest {
  JSONObject program() throws Exception {
    return new JSONObject(
        "{playlist:[{mediaId:'image',durationMs:2000},{mediaId:'video',durationMs:3000}],music:[{mediaId:'song1',durationMs:7000},{mediaId:'song2',durationMs:4000}],audioMode:'music',volume:0.4}");
  }

  JSONObject manifest() throws Exception {
    return new JSONObject()
        .put("id", "manifest")
        .put("activateAt", 10000)
        .put("validUntil", 50000)
        .put("defaultProgram", program())
        .put(
            "intervals",
            new JSONArray()
                .put(
                    new JSONObject()
                        .put("start", 20000)
                        .put("end", 30000)
                        .put(
                            "program",
                            new JSONObject()
                                .put(
                                    "playlist",
                                    new JSONArray()
                                        .put(
                                            new JSONObject()
                                                .put("mediaId", "slot")
                                                .put("durationMs", 6000)))
                                .put("music", new JSONArray()))));
  }

  @Test
  public void defaultLoopBoundaryAndIndependentMusic() throws Exception {
    ProgramTimeline.Selection s = ProgramTimeline.resolve(manifest(), 15000);
    assertEquals("image", s.visual.mediaId);
    assertEquals(0, s.visual.positionMs);
    assertEquals("song1", s.music.mediaId);
    assertEquals(5000, s.music.positionMs);
    s = ProgramTimeline.resolve(manifest(), 12000);
    assertEquals("video", s.visual.mediaId);
    assertEquals(0, s.visual.positionMs);
    s = ProgramTimeline.resolve(manifest(), 18000);
    assertEquals("song2", s.music.mediaId);
    assertEquals(1000, s.music.positionMs);
  }

  @Test
  public void halfOpenIntervalsAndExpiredDefault() throws Exception {
    assertEquals("slot", ProgramTimeline.resolve(manifest(), 20000).visual.mediaId);
    assertEquals("image", ProgramTimeline.resolve(manifest(), 30000).visual.mediaId);
    JSONObject m = manifest();
    m.getJSONArray("intervals")
        .put(
            new JSONObject()
                .put("start", 50000)
                .put("end", 60000)
                .put(
                    "program",
                    new JSONObject()
                        .put(
                            "playlist",
                            new JSONArray()
                                .put(
                                    new JSONObject()
                                        .put("mediaId", "bad")
                                        .put("durationMs", 1000)))));
    assertEquals("image", ProgramTimeline.resolve(m, 50000).visual.mediaId);
    assertNull(ProgramTimeline.resolve(m, 9000));
  }

  @Test
  public void validatesWholeProgramDependenciesAndDurations() throws Exception {
    assertEquals(5, ProgramTimeline.dependencies(manifest()).size());
    JSONObject m = manifest();
    m.getJSONObject("defaultProgram")
        .getJSONArray("playlist")
        .getJSONObject(0)
        .put("durationMs", 0);
    assertThrows(JSONException.class, () -> ProgramTimeline.dependencies(m));
  }

  @Test
  public void agreesWithJavascriptAndSwiftFixture() throws Exception {
    JSONObject m =
        new JSONObject(
            "{id:'deployment',versionId:'v1',activateAt:10000,validUntil:50000,defaultProgram:{playlist:[{mediaId:'a',durationMs:3000},{mediaId:'b',durationMs:2000}],music:[{mediaId:'music',durationMs:7000}],audioMode:'music',volume:0.5},intervals:[{start:20000,end:30000,program:{playlist:[{mediaId:'c',durationMs:4000}],music:[],audioMode:'muted',volume:0}}]}");
    assertNull(ProgramTimeline.resolve(m, 9999));
    assertEquals("b", ProgramTimeline.resolve(m, 13000).visual.mediaId);
    assertEquals("a", ProgramTimeline.resolve(m, 15000).visual.mediaId);
    assertEquals(0, ProgramTimeline.resolve(m, 24000).visual.positionMs);
    assertEquals("a", ProgramTimeline.resolve(m, 30000).visual.mediaId);
    assertEquals("a", ProgramTimeline.resolve(m, 50000).visual.mediaId);
    assertEquals(1000, ProgramTimeline.resolve(m, 18000).music.positionMs);
  }
}
