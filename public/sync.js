export function positionAt(playback, now, duration) {
  const elapsed = playback.paused
    ? playback.position
    : Math.max(0, (now - playback.epoch) / 1000);
  return duration > 0 ? ((elapsed % duration) + duration) % duration : elapsed;
}
export function circularDrift(target, actual, duration) {
  let delta = target - actual;
  if (duration > 0)
    delta =
      ((((delta + duration / 2) % duration) + duration) % duration) -
      duration / 2;
  return delta;
}
export function correction(target, actual, duration) {
  const drift = circularDrift(target, actual, duration);
  return {
    drift,
    seek: Math.abs(drift) > 0.18,
    rate: Math.abs(drift) < 0.025 ? 1 : drift > 0 ? 1.03 : 0.97,
  };
}
export function geometry(layout, screen, width, height) {
  const free = layout.mode === "freeform";
  const wallWidth = free ? layout.canvasWidth : layout.cols * layout.tileWidth + (layout.cols - 1) * layout.gapX;
  const wallHeight = free ? layout.canvasHeight : layout.rows * layout.tileHeight + (layout.rows - 1) * layout.gapY;
  const tileWidth = free ? screen.width : layout.tileWidth, tileHeight = free ? screen.height : layout.tileHeight;
  const rotation = free ? screen.rotation || 0 : 0, swap = rotation % 180 !== 0;
  const scale = Math.min(width / (swap ? tileHeight : tileWidth), height / (swap ? tileWidth : tileHeight));
  return {wallWidth, wallHeight, tileWidth, tileHeight, rotation, scale,
    x: free ? screen.x : screen.col * (layout.tileWidth + layout.gapX),
    y: free ? screen.y : screen.row * (layout.tileHeight + layout.gapY),
    offsetX: (width - tileWidth * scale) / 2,
    offsetY: (height - tileHeight * scale) / 2,
  };
}
export function estimateOffset(samples) {
  const best = [...samples]
    .sort((a, b) => a.rtt - b.rtt)
    .slice(0, 3)
    .map((s) => s.offset)
    .sort((a, b) => a - b);
  return best.length ? best[Math.floor(best.length / 2)] : 0;
}
