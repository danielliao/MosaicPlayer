import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playbackDiagnostics } from '../lib/diagnostics.js';
test('playback diagnostics retain bounded counters and discard arbitrary fields', () => {
  assert.deepEqual(playbackDiagnostics({ version:'0.1.1', decoder:'codec\u0000name', renderFps:29.9, droppedFrames:3, correctionSeeks:5, correctionsEnabled:false, key:'never copy', nested:{secret:'no'}, speed:NaN, bufferedMs:-1, sdk:'23' }), {version:'0.1.1',decoder:'codecname',renderFps:29.9,droppedFrames:3,correctionSeeks:5,correctionsEnabled:false});
  assert.equal(playbackDiagnostics(null),null);
  assert.equal(playbackDiagnostics([]),null);
  assert.equal(playbackDiagnostics({model:'x'.repeat(1000)}).model.length,120);
});
