package local.mosaic.tv;

import java.util.*;

public final class SyncMath {
  private SyncMath() {}

  public static double position(
      boolean paused, double position, double epoch, double now, double duration) {
    double p = paused ? position : Math.max(0, (now - epoch) / 1000);
    return duration > 0 ? p % duration : p;
  }

  public static double drift(double target, double actual, double duration) {
    double d = target - actual;
    return duration > 0 ? ((d + duration / 2) % duration + duration) % duration - duration / 2 : d;
  }

  public static float rate(double delta) {
    return Math.abs(delta) < 0.025 ? 1f : delta > 0 ? 1.03f : 0.97f;
  }

  public static final class Clock {
    private final List<double[]> samples = new ArrayList<>();

    public synchronized void record(double sent, double received, double server) {
      double rtt = received - sent;
      if (rtt < 0 || rtt >= 10000 || !Double.isFinite(server)) return;
      samples.add(new double[] {rtt, server - (sent + received) / 2});
      if (samples.size() > 24) samples.remove(0);
    }

    public synchronized boolean ready() {
      return samples.size() >= 3;
    }

    public synchronized void reset() {
      samples.clear();
    }

    private List<double[]> sorted() {
      List<double[]> copy = new ArrayList<>(samples);
      copy.sort(Comparator.comparingDouble(a -> a[0]));
      return copy;
    }

    public synchronized double offset() {
      List<double[]> best = sorted();
      List<Double> offsets = new ArrayList<>();
      for (int i = 0; i < Math.min(3, best.size()); i++) offsets.add(best.get(i)[1]);
      Collections.sort(offsets);
      return offsets.isEmpty() ? 0 : offsets.get(offsets.size() / 2);
    }

    public synchronized double rtt() {
      return samples.isEmpty() ? 0 : sorted().get(0)[0];
    }
  }

  public static final class Crop {
    public double viewportX,
        viewportY,
        viewportWidth,
        viewportHeight,
        contentX,
        contentY,
        contentWidth,
        contentHeight;
  }

  public static Crop crop(
      int cols,
      int rows,
      double tileW,
      double tileH,
      double gapX,
      double gapY,
      int col,
      int row,
      double viewW,
      double viewH,
      double sourceW,
      double sourceH) {
    return freeformCrop(cols*tileW+(cols-1)*gapX, rows*tileH+(rows-1)*gapY,
      col*(tileW+gapX),row*(tileH+gapY),tileW,tileH,0,viewW,viewH,sourceW,sourceH);
  }

  public static Crop freeformCrop(double canvasW,double canvasH,double x,double y,double tileW,double tileH,int rotation,double viewW,double viewH,double sourceW,double sourceH) {
    Crop c = new Crop();
    boolean swap=rotation%180!=0;
    double scale = Math.min(viewW / (swap?tileH:tileW), viewH / (swap?tileW:tileH));
    c.viewportWidth = tileW * scale;
    c.viewportHeight = tileH * scale;
    c.viewportX = (viewW - c.viewportWidth) / 2;
    c.viewportY = (viewH - c.viewportHeight) / 2;
    double wallW = canvasW * scale, wallH = canvasH * scale,
        cover = Math.max(wallW / sourceW, wallH / sourceH);
    c.contentWidth = sourceW * cover;
    c.contentHeight = sourceH * cover;
    c.contentX = (wallW - c.contentWidth) / 2 - x * scale;
    c.contentY = (wallH - c.contentHeight) / 2 - y * scale;
    return c;
  }
}
