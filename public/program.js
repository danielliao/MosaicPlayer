export function programContent(manifest, now) {
  let interval;
  if (now < manifest.validUntil) {
    let low = 0, high = manifest.intervals.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (manifest.intervals[middle].start <= now) low = middle + 1;
      else high = middle;
    }
    if (low > 0 && now < manifest.intervals[low - 1].end) interval = manifest.intervals[low - 1];
  }
  return { content: interval ? interval.program : manifest.defaultProgram, anchor: interval ? interval.start : manifest.activateAt };
}
export function programCursor(manifest, now, music = false) {
  if (!manifest || !Number.isFinite(now) || now < manifest.activateAt) return null;
  const { content, anchor } = programContent(manifest, now);
  const entries = music ? content.music : content.playlist;
  if (!entries?.length || entries.some(x => !Number.isFinite(x.durationMs) || x.durationMs <= 0)) return null;
  const length = entries.reduce((sum, x) => sum + x.durationMs, 0);
  let offset = Math.max(0, now - anchor) % length;
  for (const item of entries) {
    if (offset < item.durationMs) return { mediaId: item.mediaId, position: offset / 1000, epoch: now - offset, duration: item.durationMs / 1000, ...(content.transition ? {transition:content.transition} : {}) };
    offset -= item.durationMs;
  }
  return null;
}
export function programMediaIDs(manifest) {
  return [...new Set([manifest.defaultProgram, ...manifest.intervals.map(x => x.program)]
    .flatMap(x => [...x.playlist, ...(x.music || [])]).map(x => x.mediaId))];
}
