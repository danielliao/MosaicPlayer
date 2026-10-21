// Only bounded, non-secret playback counters are accepted from a device report.
export function playbackDiagnostics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const field of ['version', 'model', 'surface', 'decoder', 'playerState']) {
    if (typeof value[field] === 'string') result[field] = value[field].replace(/[\x00-\x1f]/g, '').slice(0, 120);
  }
  for (const field of ['sdk', 'renderFps', 'renderedFrames', 'droppedFrames', 'skippedFrames', 'correctionSeeks', 'rateChanges', 'rebufferCount', 'maxTickGapMs', 'positionMs', 'bufferedMs', 'speed']) {
    if (Number.isFinite(value[field]) && value[field] >= 0 && value[field] <= 1e12) result[field] = value[field];
  }
  for (const field of ['correctionsEnabled', 'isPlaying']) if (typeof value[field] === 'boolean') result[field] = value[field];
  return result;
}
