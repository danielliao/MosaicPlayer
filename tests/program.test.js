import test from "node:test";
import assert from "node:assert/strict";
import { programCursor, programMediaIDs } from "../public/program.js";
const manifest = {
  id: "deployment", versionId: "v1", activateAt: 10000, validUntil: 50000,
  defaultProgram: { playlist: [{mediaId:"a",durationMs:3000},{mediaId:"b",durationMs:2000}], music:[{mediaId:"music",durationMs:7000}],audioMode:"music",volume:.5 },
  intervals: [{start:20000,end:30000,program:{playlist:[{mediaId:"c",durationMs:4000}],music:[],audioMode:"muted",volume:0}}],
};
test("program fixtures agree with Swift: intervals half-open, loops, fallback and independent audio", () => {
  assert.equal(programCursor(manifest,9999),null);
  assert.equal(programCursor(manifest,13000).mediaId,"b");
  assert.equal(programCursor(manifest,15000).mediaId,"a");
  assert.equal(programCursor(manifest,24000).position,0);
  assert.equal(programCursor(manifest,30000).mediaId,"a");
  assert.equal(programCursor(manifest,50000).mediaId,"a");
  assert.equal(programCursor(manifest,18000,true).position,1);
  assert.deepEqual(new Set(programMediaIDs(manifest)),new Set(["a","b","c","music"]));
});
test("invalid durations and time never produce infinite cursor", () => {
  assert.equal(programCursor({...manifest,defaultProgram:{playlist:[{mediaId:"a",durationMs:0}]}},10000),null);
  assert.equal(programCursor(manifest,NaN),null);
});
