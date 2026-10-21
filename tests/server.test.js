import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import WebSocket from "ws";
process.env.PLAYER_DISCOVERY_ADVERTISE = "0";
let dir, child, base, key, screen, media, socket;
async function api(route, options = {}) {
  return fetch(base + route, {
    ...options,
    headers: { Authorization: `Bearer ${key}`, ...options.headers },
  });
}
async function json(route, body) {
  return api(route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("Timeout");
};
before(async () => {
  // Match the hidden default storage path, not just a visible temp directory.
  dir = await mkdtemp(path.join(tmpdir(), ".mosaic-test-"));
  const port = 34000 + Math.floor(Math.random() * 10000);
  base = `http://127.0.0.1:${port}`;
  key = "integration-test-secret";
  child = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      PLAYER_DATA_DIR: dir,
      PLAYER_ADMIN_TOKEN: key,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitFor(async () =>
    fetch(base)
      .then((r) => r.ok)
      .catch(() => false),
  );
});
after(async () => {
  socket?.terminate();
  if (child) {
    child.kill();
    await once(child, "exit");
  }
  if (dir) await rm(dir, { recursive: true, force: true });
});
test("admin and local bootstrap enforce authorization", async () => {
  assert.equal((await fetch(base + "/api/state")).status, 401);
  assert.equal(
    (await fetch(base + "/api/local-session", { method: "POST" })).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/local-session", {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  const result = await api("/api/state");
  assert.equal(result.status, 200);
  screen = (await result.json()).state.layout.screens[0];
});
test("player cannot mutate configuration or read admin device keys", async () => {
  const result = await fetch(base + "/api/state?key=" + screen.key);
  const body = await result.json();
  assert.equal(body.state.layout.screens[0].key, undefined);
  assert.equal(
    (
      await fetch(base + "/api/layout?key=" + screen.key, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    403,
  );
});
test("upload validates actual bytes and cleans invalid file", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob(["not an image"], { type: "image/png" }),
    "fake.png",
  );
  assert.equal(
    (await api("/api/media", { method: "POST", body: form })).status,
    400,
  );
});
test("real PNG uploads and supports authorized retrieval", async () => {
  const file = path.join(dir, "fixture.png");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360",
    "-frames:v",
    "1",
    file,
  ]);
  const form = new FormData();
  form.append(
    "file",
    new Blob([await readFile(file)], { type: "image/png" }),
    "校准.png",
  );
  const r = await api("/api/media", { method: "POST", body: form });
  assert.equal(r.status, 201);
  media = await r.json();
  assert.equal(media.width, 640);
  assert.equal(media.type, "image");
  assert.equal(media.name, "校准.png");
  assert.equal((await fetch(base + "/media/" + media.id)).status, 401);
  assert.equal((await api("/media/" + media.id)).status, 200);
});
test("prepare waits for device readiness then schedules one shared epoch", async () => {
  socket = new WebSocket(
    base.replace("http:", "ws:") + "/ws?key=" + screen.key,
  );
  await once(socket, "open");
  const r = await json("/api/playback", { action: "play", mediaId: media.id });
  assert.equal(r.status, 200);
  let body = await (await api("/api/state")).json();
  assert.equal(body.state.playback.mediaId, null);
  assert.equal(body.state.pending.mediaId, media.id);
  socket.send(JSON.stringify({ type: "ready", id: body.state.pending.id }));
  await waitFor(async () => {
    body = await (await api("/api/state")).json();
    return body.state.playback.mediaId === media.id;
  });
  assert.ok(body.state.playback.epoch > body.serverTime + 1500);
  assert.equal(body.state.pending, null);
});
test("active media cannot be deleted; pause and resume preserve state", async () => {
  assert.equal(
    (await api("/api/media/" + media.id, { method: "DELETE" })).status,
    400,
  );
  assert.equal((await json("/api/playback", { action: "pause" })).status, 200);
  assert.equal(
    (await (await api("/api/state")).json()).state.playback.paused,
    true,
  );
  await json("/api/playback", { action: "resume" });
  assert.equal(
    (await (await api("/api/state")).json()).state.playback.paused,
    false,
  );
});
test("disconnect during prepare cancels switch and retains current playback", async () => {
  await json("/api/playback", { action: "play", mediaId: media.id });
  socket.close();
  await waitFor(async () => {
    const b = await (await api("/api/state")).json();
    return !b.state.pending;
  });
  const b = await (await api("/api/state")).json();
  assert.equal(b.state.playback.mediaId, media.id);
  assert.equal(b.devices[0].online, false);
});
test("state persists across server restart", async () => {
  child.kill();
  await once(child, "exit");
  child = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: base.split(":").at(-1),
      PLAYER_DATA_DIR: dir,
      PLAYER_ADMIN_TOKEN: key,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitFor(async () =>
    fetch(base)
      .then((r) => r.ok)
      .catch(() => false),
  );
  const b = await (await api("/api/state")).json();
  assert.equal(b.state.media[0].id, media.id);
  assert.equal(b.state.layout.screens[0].key, screen.key);
  assert.equal(b.state.playback.mediaId, media.id);
});

test("video upload supports seeking through byte-range requests", async () => {
  const file = path.join(dir, "fixture.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=320x240:rate=30",
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    file,
  ]);
  const form = new FormData();
  form.append(
    "file",
    new Blob([await readFile(file)], { type: "video/mp4" }),
    "video.mp4",
  );
  const upload = await api("/api/media", { method: "POST", body: form });
  assert.equal(upload.status, 201);
  const video = await upload.json();
  assert.equal(video.type, "video");
  const ranged = await api("/media/" + video.id, {
    headers: { Range: "bytes=0-99" },
  });
  assert.equal(ranged.status, 206);
  assert.equal((await ranged.arrayBuffer()).byteLength, 100);
});
test("stop clears active playback and allows deleting its file", async () => {
  await json("/api/playback", { action: "stop" });
  const body = await (await api("/api/state")).json();
  assert.equal(body.state.playback.mediaId, null);
  assert.equal(
    (await api("/api/media/" + media.id, { method: "DELETE" })).status,
    204,
  );
  assert.equal((await api("/media/" + media.id)).status, 404);
});

test("missing media files return uncached 404 responses", async () => {
  const body = await (await api("/api/state")).json();
  const video = body.state.media.find((m) => m.type === "video");
  await rm(path.join(dir, "media", video.filename));
  const response = await api("/media/" + video.id);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test('native WebSocket header authentication and client identification', async () => {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', {
    headers: { Authorization: `Bearer ${screen.key}` },
  });
  try {
    await once(ws, 'open');
    ws.send(JSON.stringify({ type:'report', client:'native-macos', status:'idle', width:1920, height:1080 }));
    await waitFor(async () => {
      const state = await (await api('/api/state')).json();
      return state.devices.find(d => d.id === screen.id)?.report?.client === 'native-macos';
    });
  } finally { ws.terminate(); }
});

test("published discovery gates pairing and reserves a screen atomically", async () => {
  let discovery = await fetch(base + "/api/discovery");
  assert.equal(discovery.status, 200);
  let catalog = await discovery.json();
  assert.equal(catalog.service, "mosaic-player");
  assert.equal(catalog.published, false);
  assert.deepEqual(catalog.screens, []);
  const pair = (id, headers = {}) => fetch(base + "/api/pair", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ screenId: id }),
  });
  assert.equal((await pair(screen.id)).status, 403);
  assert.equal((await fetch(base + "/api/publication", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  })).status, 401);
  assert.equal((await api("/api/publication", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  })).status, 200);
  catalog = await (await fetch(base + "/api/discovery")).json();
  assert.equal(catalog.published, true);
  assert.equal(catalog.screens[0].key, undefined);
  assert.equal(catalog.media, undefined);
  assert.equal((await pair("missing")).status, 404);
  assert.equal((await pair(screen.id, { Origin: "https://evil.example" })).status, 403);
  const responses = await Promise.all([pair(screen.id), pair(screen.id)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  const credential = await responses.find(r => r.status === 200).json();
  assert.equal(credential.screenId, screen.id);
  assert.equal(credential.key, screen.key);
  catalog = await (await fetch(base + "/api/discovery")).json();
  assert.equal(catalog.screens[0].reserved, true);
  const ws = new WebSocket(base.replace("http:", "ws:") + "/ws", {
    headers: { Authorization: `Bearer ${credential.key}` },
  });
  try {
    await once(ws, "open");
    catalog = await (await fetch(base + "/api/discovery")).json();
    assert.equal(catalog.screens[0].online, true);
    assert.equal((await pair(screen.id)).status, 409);
    await api("/api/publication", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal((await pair(screen.id)).status, 403);
    assert.deepEqual((await (await fetch(base + "/api/discovery")).json()).screens, []);
    assert.equal((await fetch(base + "/api/state", {
      headers: { Authorization: `Bearer ${credential.key}` },
    })).status, 200);
  } finally { ws.terminate(); }
});

test("Android TV clients retain their platform identity in device reports", async () => {
  const ws = new WebSocket(base.replace("http:", "ws:") + "/ws", {
    headers: { Authorization: `Bearer ${screen.key}` },
  });
  try {
    await once(ws, "open");
    ws.send(JSON.stringify({ type: "report", client: "android-tv", status: "playing", width: 1920, height: 1080, drift: 12, diagnostics: {version:"0.1.1", renderFps:29.8, droppedFrames:2, correctionSeeks:0, key:"discard"} }));
    await waitFor(async () => {
      const state = await (await api("/api/state")).json();
      return state.devices.find(d => d.id === screen.id)?.report != null;
    });
    const state = await (await api("/api/state")).json();
    const report = state.devices.find(d => d.id === screen.id).report;
    assert.equal(report.client, "android-tv");
    assert.deepEqual(report.diagnostics, {version:"0.1.1", renderFps:29.8, droppedFrames:2, correctionSeeks:0});
  } finally { ws.terminate(); }
});

test('legacy entry rejects unsupported freeform clients before sending a new layout',async()=>{const current=await(await api('/api/state')).json();const s=current.state.layout.screens[0];const old=new WebSocket(base.replace('http','ws')+'/ws?key='+s.key);await once(old,'open');try{const r=await api('/api/layout',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'freeform',canvasWidth:1920,canvasHeight:1080,screens:[{id:s.id,x:0,y:0,width:1920,height:1080,rotation:0}]})});assert.equal(r.status,409);}finally{old.close();await once(old,'close');}});
