package local.mosaic.tv;

import static org.junit.Assert.*;

import org.junit.Test;

public class CoreTest {
  @Test
  public void sharedEpochPauseAndLoop() {
    assertEquals(0, SyncMath.position(false, 0, 10000, 9000, 7), 0.00001);
    assertEquals(2.3, SyncMath.position(false, 0, 10000, 26300, 7), 0.00001);
    assertEquals(4.2, SyncMath.position(true, 4.2, 0, 1e12, 7), 0.00001);
  }

  @Test
  public void loopBoundaryAndCorrection() {
    assertEquals(0.04, SyncMath.drift(0.02, 9.98, 10), 0.00001);
    assertEquals(-0.04, SyncMath.drift(9.98, 0.02, 10), 0.00001);
    assertEquals(1, SyncMath.rate(0.01), 0.001);
    assertEquals(1.03, SyncMath.rate(0.1), 0.001);
    assertEquals(0.97, SyncMath.rate(-0.1), 0.001);
  }

  @Test
  public void clockFiltersSlowSampleAndNeedsWarmup() {
    SyncMath.Clock clock = new SyncMath.Clock();
    clock.record(100, 102, 111);
    assertFalse(clock.ready());
    clock.record(200, 204, 213);
    clock.record(300, 306, 312);
    clock.record(400, 1400, 2000);
    assertTrue(clock.ready());
    assertEquals(10, clock.offset(), 0.001);
    assertEquals(2, clock.rtt(), 0.001);
    clock.reset();
    assertFalse(clock.ready());
  }

  @Test
  public void cropUsesWallCoverAndPhysicalViewport() {
    SyncMath.Crop crop = SyncMath.crop(3, 1, 1920, 1080, 40, 0, 1, 0, 1440, 900, 1920, 1080);
    assertEquals(45, crop.viewportY, 0.001);
    assertEquals(1440, crop.viewportWidth, 0.001);
    assertEquals(-1470, crop.contentX, 0.001);
    assertEquals(4380, crop.contentWidth, 0.001);
    assertEquals(-826.875, crop.contentY, 0.001);
  }

  @Test
  public void addressValidationAndBoundedSubnet() throws Exception {
    assertEquals("http://10.20.30.20:3210", Protocol.serverAddress("10.20.30.20"));
    assertEquals("https://mosaic.example", Protocol.serverAddress("https://mosaic.example/"));
    for (String value :
        new String[] {
          "file:///x", "http://user:pass@host", "http://host/play?key=secret", "http://host:99999"
        }) {
      try {
        Protocol.serverAddress(value);
        fail(value);
      } catch (IllegalArgumentException expected) {
      }
    }
    assertEquals(253, Protocol.subnet("10.20.30.20", 24).size());
    assertTrue(Protocol.subnet("10.20.30.20", 16).contains("10.20.30.21"));
    assertFalse(Protocol.subnet("10.20.30.20", 16).contains("10.20.31.1"));
    assertEquals(
        java.util.Collections.singletonList("192.168.1.6"), Protocol.subnet("192.168.1.5", 30));
    assertTrue(Protocol.subnet("8.8.8.8", 24).isEmpty());
  }
}
