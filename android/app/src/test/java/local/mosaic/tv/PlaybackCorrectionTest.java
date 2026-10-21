package local.mosaic.tv;

import static org.junit.Assert.*;

import org.junit.Test;

public class PlaybackCorrectionTest {
  @Test
  public void slowPreciseSeekDoesNotRestartDecoderForever() {
    PlaybackCorrection policy = new PlaybackCorrection();
    double position = 0;
    long readyAt = 0;
    int seeks = 0;
    float speed = 1;
    for (long now = 0; now <= 25000; now += 50) {
      boolean ready = now >= readyAt;
      if (ready && now > 0) position += .05 * speed;
      PlaybackCorrection.Decision d =
          policy.update(now, now / 1000.0 - position, 1, false, true, ready, true);
      if (d.seek) {
        seeks++;
        position = now / 1000.0;
        readyAt = now + 450;
      }
      speed = d.speed;
    }
    assertEquals(
        "One initial seek; a 450 ms decoder recovery must not trigger repeated seeks", 1, seeks);
    assertEquals("Soft correction eventually catches up", 25, position, .08);
  }

  @Test
  public void bufferingNeverTriggersAnAutomaticSeek() {
    PlaybackCorrection p = new PlaybackCorrection();
    p.update(0, 0, 1, false, true, true, true);
    for (long now = 100; now <= 20000; now += 100)
      assertFalse(p.update(now, 4, 1, false, true, false, true).seek);
  }

  @Test
  public void shortClockSpikeDoesNotSeekAndLargePersistentDriftEventuallyDoes() {
    PlaybackCorrection p = new PlaybackCorrection();
    p.update(0, 0, 1, false, true, true, true);
    assertFalse(p.update(6000, 2, 1, false, true, true, true).seek);
    assertFalse(p.update(6100, 0, 1, false, true, true, true).seek);
    assertFalse(p.update(7000, 2, 1, false, true, true, true).seek);
    assertTrue(p.update(8500, 2, 1, false, true, true, true).seek);
    assertFalse(p.update(9200, 2, 1, false, true, true, true).seek);
  }

  @Test
  public void commandsStillSeekAndDiagnosticModeStopsCorrections() {
    PlaybackCorrection p = new PlaybackCorrection();
    assertTrue(p.update(0, 0, 1, false, true, true, false).seek);
    assertFalse(p.update(6000, 10, 1, false, true, true, false).seek);
    assertTrue(p.update(6010, 10, 2, true, true, true, false).seek);
    assertEquals(1, p.update(6100, 10, 2, true, true, true, false).speed, .001);
  }

  @Test
  public void smallPositionJitterDoesNotToggleSpeedEveryTick() {
    PlaybackCorrection p = new PlaybackCorrection();
    p.update(0, 0, 1, false, true, true, true);
    for (long now = 1000; now < 3000; now += 50)
      assertEquals(
          1, p.update(now, now % 100 == 0 ? .026 : .024, 1, false, true, true, true).speed, .001);
  }
}
