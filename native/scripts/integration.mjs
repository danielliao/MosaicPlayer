import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { once } from "node:events";
process.env.PLAYER_DISCOVERY_ADVERTISE = "0";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const output = path.join(root, "output", `native-${Date.now()}`);
await mkdir(output, { recursive: true });
const binary =
  process.env.MOSAIC_APP_BINARY ||
  path.join(root, "native/.build/debug/MosaicPlayer");
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`,
  adminKey = randomBytes(24).toString("hex");
let server,
  screens,
  applications = [];
const logs = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(check, label, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(150);
  }
  throw Error(`Timeout: ${label}`);
}
async function api(route, { body, method = "GET" } = {}) {
  const response = await fetch(base + route, {
    method,
    headers: {
      Authorization: `Bearer ${adminKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw Error(`${route}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function startServer() {
  server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      PLAYER_DATA_DIR: path.join(output, ".server"),
      PLAYER_ADMIN_TOKEN: adminKey,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stream = createWriteStream(path.join(output, "server.log"), {
    flags: "a",
  });
  logs.push(stream);
  server.stdout.pipe(stream);
  server.stderr.pipe(stream);
  await waitUntil(
    () =>
      fetch(base)
        .then((r) => r.ok)
        .catch(() => false),
    "server ready",
  );
}
async function stopServer() {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await once(server, "exit");
  }
}
async function launch(index) {
  const connectionFile = path.join(output, `connection-${index}.json`);
  await writeFile(
    connectionFile,
    JSON.stringify({
      link: `${base}/play?screen=${screens[index].id}&key=${screens[index].key}`,
    }),
    { mode: 0o600 },
  );
  const child = spawn(binary, [], {
    env: {
      ...process.env,
      MOSAIC_TEST_MODE: "1",
      MOSAIC_TEST_CACHE: path.join(output, `cache-${index}`),
      MOSAIC_DIAGNOSTICS: path.join(output, `device-${index}.json`),
      MOSAIC_CONNECTION_FILE: connectionFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = createWriteStream(path.join(output, `device-${index}.log`), {
    flags: "a",
  });
  logs.push(log);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  applications[index] = child;
}
async function diagnostics() {
  return Promise.all(
    [0, 1, 2].map(async (i) => {
      try {
        return JSON.parse(
          await readFile(path.join(output, `device-${i}.json`), "utf8"),
        );
      } catch {
        return null;
      }
    }),
  );
}
async function upload(file, name, type) {
  const form = new FormData();
  form.append("file", new Blob([await readFile(file)], { type }), name);
  const response = await fetch(base + "/api/media", {
    method: "POST",
    headers: { Authorization: `Bearer ${adminKey}` },
    body: form,
  });
  assert.equal(response.status, 201);
  return response.json();
}
const results = {
  environment:
    "three native macOS app processes on one Mac; separate caches; isolated Node backend",
};
try {
  await startServer();
  screens = (await api("/api/state")).state.layout.screens;
  for (let i = 0; i < 3; i++) await launch(i);
  await waitUntil(async () => {
    const d = await diagnostics();
    return d.every((x) => x?.connected && x.clockReady);
  }, "three native clients connected");
  console.log(
    "PASS: three native processes authenticated and synchronized clocks",
  );
  const videoFile = path.join(output, "native-test.mp4"),
    imageFile = path.join(output, "native-calibration.png");
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=1920x360:rate=30",
    "-t",
    "6",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    videoFile,
  ]);
  execFileSync("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=1920x360",
    "-frames:v",
    "1",
    imageFile,
  ]);
  const video = await upload(videoFile, "native-test.mp4", "video/mp4");
  const image = await upload(imageFile, "native-calibration.png", "image/png");
  await api("/api/playback", {
    method: "POST",
    body: { action: "play", mediaId: video.id },
  });
  await waitUntil(
    async () => {
      const d = await diagnostics();
      return d.every(
        (x) =>
          x?.mediaId === video.id &&
          x.status === "playing" &&
          x.rendering.videoReady &&
          x.displaySleepPrevented,
      );
    },
    "native AVPlayer layers playing",
    45000,
  );
  console.log(
    "PASS: local video cache, AVPlayer layer rendering, and display sleep assertions",
  );
  const driftSamples = [],
    spreadSamples = [];
  for (let i = 0; i < 24; i++) {
    const d = await diagnostics();
    assert.ok(d.every((x) => x.status === "playing" && x.cached));
    driftSamples.push(...d.map((x) => Math.abs(x.drift)));
    const phase = d.map(
      (x) => (x.mediaTime - x.serverTime / 1000) % video.duration,
    );
    const differences = phase.map(
      (p) =>
        ((((p - phase[0] + video.duration / 2) % video.duration) +
          video.duration) %
          video.duration) -
        video.duration / 2,
    );
    spreadSamples.push(
      (Math.max(...differences) - Math.min(...differences)) * 1000,
    );
    await delay(500);
  }
  const precise = (value) => Number(value.toFixed(3));
  results.samples = 24;
  results.sampleIntervalMs = 500;
  results.maxReportedDriftMs = precise(Math.max(...driftSamples));
  results.maxNormalizedMediaSpreadMs = precise(Math.max(...spreadSamples));
  results.meanNormalizedMediaSpreadMs = precise(
    spreadSamples.reduce((a, b) => a + b) / spreadSamples.length,
  );
  assert.ok(
    results.maxReportedDriftMs < 500,
    `drift excessive: ${results.maxReportedDriftMs}`,
  );
  console.log("PASS: native looping timeline", JSON.stringify(results));
  await api("/api/playback", { method: "POST", body: { action: "pause" } });
  await waitUntil(
    async () =>
      (await diagnostics()).every(
        (x) => x.status === "paused" && !x.displaySleepPrevented,
      ),
    "pause and release wake assertions",
  );
  const paused = await diagnostics();
  const positions = paused.map((x) => x.mediaTime);
  results.pausedPositions = positions;
  assert.ok(Math.max(...positions) - Math.min(...positions) < 0.08);
  await api("/api/playback", { method: "POST", body: { action: "resume" } });
  await waitUntil(
    async () => (await diagnostics()).every((x) => x.status === "playing"),
    "resume",
  );
  console.log("PASS: pause/resume and power policy");
  await stopServer();
  await delay(3500);
  const offline = await diagnostics();
  assert.ok(
    offline.every((x) => !x.connected && x.status === "playing" && x.cached),
  );
  const before = offline[0].mediaTime;
  await delay(1200);
  assert.notEqual((await diagnostics())[0].mediaTime, before);
  results.cachedPlaybackWhileServerOffline = true;
  await startServer();
  await waitUntil(
    async () =>
      (await diagnostics()).every(
        (x) => x.connected && x.clockReady && x.status === "playing",
      ),
    "automatic reconnect",
  );
  console.log("PASS: server offline cache playback and reconnect");
  applications[2].kill("SIGTERM");
  await once(applications[2], "exit");
  await rm(path.join(output, "device-2.json"));
  await launch(2);
  await waitUntil(async () => {
    const d = await diagnostics();
    return (
      d[2]?.connected && d[2].status === "playing" && Math.abs(d[2].drift) < 180
    );
  }, "late native rejoin");
  results.lateJoin = true;
  const broken = await upload(imageFile, "broken-download.png", "image/png");
  await writeFile(
    path.join(output, ".server", "media", broken.filename),
    "truncated",
  );
  await api("/api/playback", {
    method: "POST",
    body: { action: "play", mediaId: broken.id },
  });
  await waitUntil(async () => {
    const s = (await api("/api/state")).state;
    return s.pending === null && s.playback.mediaId === video.id;
  }, "failed download retains current video");
  results.failedPreparationRetainedVideo = true;
  // Immediately request a good asset: this exercises the retry cooldown path.
  await api("/api/playback", {
    method: "POST",
    body: { action: "play", mediaId: image.id },
  });
  await waitUntil(
    async () =>
      (await diagnostics()).every(
        (x) => x.mediaId === image.id && x.rendering.imageReady,
      ),
    "native image rendering",
  );
  const images = await diagnostics();
  results.imageOffsets = images.map((x) => x.rendering.wallX);
  assert.equal(results.imageOffsets[0], 0);
  assert.ok(
    results.imageOffsets[1] < 0 &&
      results.imageOffsets[2] < results.imageOffsets[1],
  );
  const layout = (await api("/api/state")).state.layout;
  await api("/api/layout", { method: "PUT", body: { ...layout, gapX: 40 } });
  await waitUntil(async () => {
    const d = await diagnostics();
    return d[1].rendering.wallX < results.imageOffsets[1];
  }, "native bezel layout update");
  console.log(
    "PASS: image layers, individual crop regions, and live bezel updates",
  );
  await api("/api/playback", { method: "POST", body: { action: "stop" } });
  await waitUntil(
    async () =>
      (await diagnostics()).every(
        (x) => x.mediaId === "" && !x.displaySleepPrevented,
      ),
    "stop clears native media",
  );
  results.stopped = true;
  results.success = true;
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(`NATIVE_INTEGRATION_PASSED ${path.join(output, "results.json")}`);
} finally {
  for (const child of applications)
    if (child && child.exitCode === null) child.kill("SIGTERM");
  await stopServer();
  for (const log of logs) log.end();
  for (let i = 0; i < 3; i++)
    await rm(path.join(output, `connection-${i}.json`), { force: true });
}
