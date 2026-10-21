package local.mosaic.tv;

import static org.junit.Assert.*;

import org.junit.Test;

public class PlaybackDiagnosticsTest {
  @Test
  public void countsFramesOverActualIntervalAndResetsForNewDecoder() throws Exception {
    PlaybackDiagnostics probe = new PlaybackDiagnostics();
    Object first = new Object(), second = new Object();
    assertEquals(0, probe.sample(first, 1000, 100, 2, 3).getDouble("renderFps"), .01);
    assertEquals(30, probe.sample(first, 2000, 130, 5, 3).getDouble("renderFps"), .01);
    assertEquals(15, probe.sample(first, 4000, 160, 10, 3).getDouble("renderFps"), .01);
    assertEquals(0, probe.sample(second, 5000, 1, 0, 0).getDouble("renderFps"), .01);
    assertEquals(0, probe.sample(second, 6000, 0, 0, 0).getDouble("renderFps"), .01);
  }
}
