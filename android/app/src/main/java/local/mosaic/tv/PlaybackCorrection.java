package local.mosaic.tv;

/** Avoid repeatedly resetting a decoder that needs time to recover from an exact seek. */
final class PlaybackCorrection {
  static final class Decision {
    final boolean seek;
    final float speed;

    Decision(boolean seek, float speed) {
      this.seek = seek;
      this.speed = speed;
    }
  }

  private long lastRevision = Long.MIN_VALUE, lastSeek = -5000, largeDriftSince = -1, rateChangedAt;
  private float speed = 1;

  void reset() {
    lastRevision = Long.MIN_VALUE;
    lastSeek = -5000;
    largeDriftSince = -1;
    rateChangedAt = 0;
    speed = 1;
  }

  Decision update(
      long now,
      double drift,
      long revision,
      boolean paused,
      boolean due,
      boolean ready,
      boolean enabled) {
    // New server commands must still take effect immediately, including pause/restart/late join.
    if (lastRevision != revision) {
      lastRevision = revision;
      return seek(now);
    }
    if (!enabled || paused || !due || !ready) {
      largeDriftSince = -1;
      speed = 1;
      return new Decision(false, speed);
    }
    // Sub-second decoder recovery is corrected by speed, not another expensive precise seek.
    // Large drift must persist; a single clock sample or loop transition cannot cause a jump.
    if (Math.abs(drift) > 1.0) {
      if (largeDriftSince < 0) largeDriftSince = now;
      if (now - largeDriftSince >= 1200 && now - lastSeek >= 5000) return seek(now);
    } else largeDriftSince = -1;
    float next = speed;
    if (drift > .060) next = 1.03f;
    else if (drift < -.060) next = .97f;
    else if (speed > 1 && drift <= .020 || speed < 1 && drift >= -.020) next = 1;
    if (next != speed && now - rateChangedAt >= 500) {
      speed = next;
      rateChangedAt = now;
    }
    return new Decision(false, speed);
  }

  private Decision seek(long now) {
    lastSeek = now;
    largeDriftSince = -1;
    speed = 1;
    rateChangedAt = now;
    return new Decision(true, speed);
  }
}
