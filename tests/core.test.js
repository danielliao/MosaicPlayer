import test from "node:test";
import assert from "node:assert/strict";
import {
  positionAt,
  circularDrift,
  correction,
  geometry,
  estimateOffset,
} from "../public/sync.js";
import { validateLayout } from "../lib/model.js";
test("scheduled playback stays at zero before epoch, then loops", () => {
  const p = { epoch: 10000, paused: false };
  assert.equal(positionAt(p, 9000, 7), 0);
  assert.equal(positionAt(p, 26300, 7), 2.3000000000000007);
});
test("pause holds position independent of wall clock", () => {
  assert.equal(positionAt({ paused: true, position: 4.5 }, 100000, 7), 4.5);
});
test("loop boundary drift uses shortest distance", () => {
  assert.ok(Math.abs(circularDrift(0.02, 9.98, 10) - 0.04) < 1e-9);
  assert.ok(Math.abs(circularDrift(9.98, 0.02, 10) + 0.04) < 1e-9);
});
test("small drift adjusts rate; large drift seeks", () => {
  assert.equal(correction(2, 1.99, 10).rate, 1);
  assert.equal(correction(2, 1.9, 10).rate, 1.03);
  assert.equal(correction(2, 2.1, 10).rate, 0.97);
  assert.equal(correction(2, 1, 10).seek, true);
});
test("clock estimator excludes slow outliers", () => {
  assert.equal(
    estimateOffset([
      { rtt: 1, offset: 12 },
      { rtt: 3, offset: 13 },
      { rtt: 2, offset: 11 },
      { rtt: 200, offset: 500 },
    ]),
    12,
  );
});
test("geometry compensates bezel and letterboxes mismatched displays", () => {
  const g = geometry(
    { cols: 3, rows: 1, tileWidth: 1920, tileHeight: 1080, gapX: 40, gapY: 0 },
    { row: 0, col: 1 },
    1440,
    900,
  );
  assert.equal(g.wallWidth, 5840);
  assert.equal(g.x, 1960);
  assert.equal(g.offsetY, 45);
  assert.equal(g.scale, 0.75);
});
test("layout preserves device links by coordinate", () => {
  const a = validateLayout({
    cols: 3,
    rows: 1,
    tileWidth: 1920,
    tileHeight: 1080,
    gapX: 0,
    gapY: 0,
  });
  const b = validateLayout({ ...a, cols: 2, rows: 2 }, a.screens);
  assert.equal(b.screens[1].key, a.screens[1].key);
  assert.notEqual(b.screens[2].key, a.screens[2].key);
});
test("layout rejects oversized and malformed grids", () => {
  for (const patch of [
    { cols: 9 },
    { rows: 1.5 },
    { cols: 8, rows: 8 },
    { gapX: -1 },
    { tileWidth: "1920" },
  ])
    assert.throws(() =>
      validateLayout({
        cols: 3,
        rows: 1,
        tileWidth: 1920,
        tileHeight: 1080,
        gapX: 0,
        gapY: 0,
        ...patch,
      }),
    );
});
