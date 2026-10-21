import { playbackDiagnostics } from "./lib/diagnostics.js";
import express from "express";
import multer from "multer";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "node:http";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { networkInterfaces, hostname } from "node:os";
import { token, validateLayout } from "./lib/model.js";
import { positionAt } from "./public/sync.js";
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(
  process.env.PLAYER_DATA_DIR || path.join(root, ".data"),
);
mkdirSync(path.join(dataDir, "media"), { recursive: true });
const stateFile = path.join(dataDir, "state.json");
const keyFile = path.join(dataDir, "admin-token");
if (!existsSync(keyFile)) writeFileSync(keyFile, token(), { mode: 0o600 });
const adminToken =
  process.env.PLAYER_ADMIN_TOKEN || readFileSync(keyFile, "utf8").trim();
let state = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, "utf8"))
  : {
      layout: validateLayout({
        cols: 3,
        rows: 1,
        tileWidth: 1920,
        tileHeight: 1080,
        gapX: 0,
        gapY: 0,
      }),
      media: [],
      playback: {
        mediaId: null,
        epoch: 0,
        paused: true,
        position: 0,
        revision: 0,
      },
    };
state.serverId ||= token().slice(0, 20);
state.publication ||= { enabled: false };
let pending = null;
const reservations = new Map();
const clockBase = Date.now(),
  monoBase = performance.now();
const now = () => clockBase + performance.now() - monoBase;
// Native players cache the complete asset before declaring readiness.
const prepareTimeoutMs = Math.min(
  600000,
  Math.max(30000, Number(process.env.PLAYER_PREPARE_TIMEOUT_MS) || 120000),
);
const save = () => {
  writeFileSync(stateFile + ".tmp", JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
  renameSync(stateFile + ".tmp", stateFile);
};
save();
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  res.set("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "32kb" }));
const identify = (key) =>
  key === adminToken
    ? { role: "admin" }
    : (() => {
        const screen = state.layout.screens.find((s) => s.key === key);
        return screen ? { role: "player", screenId: screen.id } : null;
      })();
const auth = (req, res, next) => {
  req.identity = identify(
    req.headers.authorization?.replace(/^Bearer /, "") || req.query.key,
  );
  if (!req.identity)
    return res
      .status(401)
      .json({ error: "连接密钥无效，请重新打开设备链接或登录" });
  next();
};
const admin = (req, res, next) =>
  auth(req, res, () =>
    req.identity.role === "admin"
      ? next()
      : res.status(403).json({ error: "需要管理权限" }),
  );
const publicState = () => ({
  ...state,
  layout: {
    ...state.layout,
    screens: state.layout.screens.map(({ key, ...s }) => s),
  },
  pending: pending ? { mediaId: pending.mediaId, id: pending.id } : null,
});
const clients = new Set();
const devices = () =>
  state.layout.screens.map((s) => {
    const peers = [...clients].filter(
      (c) => c.screenId === s.id && c.ws.readyState === WebSocket.OPEN,
    );
    return {
      id: s.id,
      online: peers.length > 0,
      connections: peers.length,
      report: peers[0]?.report || null,
    };
  });
function send(c, type, payload) {
  if (c.ws.readyState === WebSocket.OPEN)
    c.ws.send(JSON.stringify({ type, ...payload }));
}
function broadcast() {
  for (const c of clients)
    send(c, "state", {
      state:
        c.role === "admin"
          ? {
              ...state,
              pending: pending
                ? { mediaId: pending.mediaId, id: pending.id }
                : null,
            }
          : publicState(),
      devices: devices(),
    });
}
function commit() {
  if (!pending) return;
  state.playback = {
    mediaId: pending.mediaId,
    epoch: now() + 2000,
    paused: false,
    position: 0,
    revision: state.playback.revision + 1,
    preparationId: pending.id,
  };
  clearTimeout(pending.timer);
  pending = null;
  save();
  broadcast();
}
function cancelPending() {
  if (pending) clearTimeout(pending.timer);
  pending = null;
}
app.post("/api/local-session", (req, res) => {
  const ip = req.socket.remoteAddress,
    host = req.hostname;
  const local =
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (!local || req.headers.origin !== `${req.protocol}://${req.headers.host}`)
    return res.status(403).json({ error: "远程管理请使用管理密钥登录" });
  res.json({ token: adminToken });
});
app.get("/api/state", auth, (req, res) =>
  res.json({
    state:
      req.identity.role === "admin"
        ? {
            ...state,
            pending: pending
              ? { mediaId: pending.mediaId, id: pending.id }
              : null,
          }
        : publicState(),
    devices: devices(),
    serverTime: now(),
  }),
);
app.get("/api/network", admin, (req, res) =>
  res.json({
    addresses: Object.values(networkInterfaces())
      .flat()
      .filter((x) => x.family === "IPv4" && !x.internal)
      .map((x) => `http://${x.address}:${server.address().port}`),
  }),
);
app.put("/api/publication", admin, (req, res) => {
  if (typeof req.body?.enabled !== "boolean")
    return res.status(400).json({ error: "请选择是否发布屏幕" });
  state.publication = { enabled: req.body.enabled };
  if (!req.body.enabled) reservations.clear();
  save();
  broadcast();
  res.json(state.publication);
});
// Discovery deliberately exposes no media or credentials. A published wall
// allows LAN players to claim only the single screen they select.
app.get("/api/discovery", (req, res) => {
  const status = devices();
  res.json({
    service: "mosaic-player",
    protocolVersion: 1,
    serverId: state.serverId,
    name: process.env.PLAYER_SERVER_NAME || `Mosaic · ${hostname()}`,
    published: state.publication.enabled,
    cols: state.layout.cols,
    rows: state.layout.rows,
    screens: state.publication.enabled
      ? state.layout.screens.map(({ key, ...s }) => ({
          ...s,
          online: status.find(d => d.id === s.id).online,
          reserved: (reservations.get(s.id) || 0) > now(),
        }))
      : [],
  });
});
app.post("/api/pair", (req, res) => {
  // Native clients send no Origin. A web page must use its own origin;
  // cross-origin requests cannot acquire a screen credential.
  if (req.headers.origin && req.headers.origin !== `${req.protocol}://${req.headers.host}`)
    return res.status(403).json({ error: "请从原生播放器选择屏幕" });
  if (!state.publication.enabled)
    return res.status(403).json({ error: "后台尚未发布屏幕，请在设备管理中开启发布" });
  const screen = state.layout.screens.find(s => s.id === req.body?.screenId);
  if (!screen) return res.status(404).json({ error: "屏幕已移除，请刷新列表" });
  if (devices().find(d => d.id === screen.id).online || (reservations.get(screen.id) || 0) > now())
    return res.status(409).json({ error: "此屏幕已在线或正在连接，请选择其他屏幕；连接未完成时请等待 30 秒再试" });
  reservations.set(screen.id, now() + 30_000);
  res.json({ screenId: screen.id, key: screen.key });
});
app.put("/api/layout", admin, (req, res, next) => {
  try {
    if (pending) throw new Error("请等待素材准备完成后再修改布局");
    state.layout = validateLayout(req.body, state.layout.screens);
    save();
    for (const c of clients)
      if (
        c.role === "player" &&
        !state.layout.screens.some((s) => s.id === c.screenId)
      )
        c.ws.close(4001, "Screen removed");
    broadcast();
    res.json(state.layout);
  } catch (e) {
    next(e);
  }
});
const upload = multer({
  dest: path.join(dataDir, "media"),
  limits: { fileSize: 1024 * 1024 * 1024, files: 1, fields: 0 },
});
function probe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.FFPROBE_PATH || "ffprobe", [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      file,
    ]);
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
    child.stdout.on("data", (d) => {
      out += d;
      if (out.length > 2e6) child.kill("SIGKILL");
    });
    child.stderr.resume();
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(
        new Error(
          e.code === "ENOENT"
            ? "未找到 ffprobe，请安装 FFmpeg"
            : "素材检测失败",
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error();
        resolve(JSON.parse(out));
      } catch {
        reject(new Error("无法识别素材，请使用 JPEG、PNG、WebP 或 H.264 MP4"));
      }
    });
  });
}
app.post("/api/media", admin, upload.single("file"), async (req, res, next) => {
  let file = req.file?.path;
  try {
    if (!file) throw new Error("请选择素材");
    const meta = await probe(file);
    const video = meta.streams.find((s) => s.codec_type === "video");
    if (!video) throw new Error("素材没有图像轨道");
    const format = meta.format.format_name,
      codec = video.codec_name;
    const imageTypes = {
      png: ["png", "image/png"],
      mjpeg: ["jpg", "image/jpeg"],
      webp: ["webp", "image/webp"],
    };
    const image = Boolean(
      imageTypes[codec] && /image2|png_pipe|jpeg_pipe|webp_pipe/.test(format),
    );
    if (
      !image &&
      !(
        codec === "h264" &&
        /mp4|mov/.test(format) &&
        ["yuv420p", "yuvj420p"].includes(video.pix_fmt)
      )
    )
      throw new Error(
        "请上传 JPEG、PNG、静态 WebP 图片，或 H.264 / 8-bit 4:2:0 的 MP4 视频",
      );
    const duration = image ? 0 : Number(meta.format.duration);
    if (!image && (!Number.isFinite(duration) || duration <= 0))
      throw new Error("视频时长无效");
    if (
      !Number.isInteger(video.width) ||
      video.width <= 0 ||
      !Number.isInteger(video.height) ||
      video.height <= 0
    )
      throw new Error("无法识别图像尺寸，请使用有效的静态图片或 MP4 视频");
    if (
      video.width > 16384 ||
      video.height > 16384 ||
      video.width * video.height > 70000000
    )
      throw new Error("素材尺寸过大");
    const id = token().slice(0, 20),
      ext = image ? imageTypes[codec][0] : "mp4";
    const filename = `${id}.${ext}`;
    renameSync(file, path.join(dataDir, "media", filename));
    file = null;
    const media = {
      id,
      name: Buffer.from(req.file.originalname, "latin1")
        .toString("utf8")
        .slice(0, 180),
      type: image ? "image" : "video",
      mime: image ? imageTypes[codec][1] : "video/mp4",
      filename,
      width: video.width,
      height: video.height,
      duration,
      size: req.file.size,
      createdAt: now(),
    };
    state.media.unshift(media);
    save();
    broadcast();
    res.status(201).json(media);
  } catch (e) {
    if (file && existsSync(file)) unlinkSync(file);
    next(e);
  }
});
app.get("/media/:id", auth, (req, res) => {
  const media = state.media.find((m) => m.id === req.params.id);
  if (!media) return res.sendStatus(404);
  res.type(media.mime);
  res.set("Cache-Control", "private, max-age=3600");
  // Only server-generated filenames are resolved here. The default data
  // directory is hidden; Express otherwise refuses to serve its contents.
  res.sendFile(path.join(dataDir, "media", media.filename), {
    dotfiles: "allow",
  });
});
app.delete("/api/media/:id", admin, (req, res, next) => {
  try {
    if (
      state.playback.mediaId === req.params.id ||
      pending?.mediaId === req.params.id
    )
      throw new Error("正在播放或准备中的素材不能删除");
    const media = state.media.find((m) => m.id === req.params.id);
    if (!media) return res.sendStatus(404);
    state.media = state.media.filter((m) => m.id !== media.id);
    save();
    if (existsSync(path.join(dataDir, "media", media.filename)))
      unlinkSync(path.join(dataDir, "media", media.filename));
    broadcast();
    res.sendStatus(204);
  } catch (e) {
    next(e);
  }
});
app.post("/api/playback", admin, (req, res, next) => {
  try {
    const { action, mediaId } = req.body;
    if (action === "play") {
      if (!state.media.some((m) => m.id === mediaId))
        throw new Error("素材不存在");
      cancelPending();
      const expected = [...clients].filter(
        (c) => c.role === "player" && c.ws.readyState === WebSocket.OPEN,
      );
      pending = {
        id: token().slice(0, 10),
        mediaId,
        expected: new Set(expected),
        ready: new Set(),
      };
      pending.timer = setTimeout(() => {
        cancelPending();
        for (const c of clients)
          if (c.role === "admin")
            send(c, "notice", {
              message: "素材准备超时，已保留原播放内容。请检查设备后重试。",
            });
        broadcast();
      }, prepareTimeoutMs);
      broadcast();
      if (!expected.length) commit();
    } else if (action === "stop") {
      cancelPending();
      state.playback = {
        mediaId: null,
        epoch: 0,
        paused: true,
        position: 0,
        revision: state.playback.revision + 1,
      };
      save();
      broadcast();
    } else if (action === "cancel") {
      cancelPending();
      broadcast();
    } else if (action === "pause" || action === "resume") {
      if (pending) throw new Error("请先完成或取消素材准备");
      if (!state.playback.mediaId) throw new Error("请先选择素材");
      const p = state.playback,
        m = state.media.find((m) => m.id === p.mediaId);
      if (action === "pause" && !p.paused) {
        p.position = positionAt(p, now(), m.duration);
        p.paused = true;
      }
      if (action === "resume" && p.paused) {
        p.epoch = now() - p.position * 1000;
        p.paused = false;
      }
      p.revision++;
      save();
      broadcast();
    } else throw new Error("未知播放操作");
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
app.get("/downloads/mosaic-player.zip", (req, res) => {
  const archive = path.join(root, "native", "dist", "MosaicPlayer-macOS.zip");
  if (!existsSync(archive))
    return res
      .status(503)
      .type("text/plain")
      .send("原生播放端尚未打包，请运行 npm run build:native。");
  res.download(archive, "MosaicPlayer-macOS.zip");
});
app.get("/downloads/mosaic-player.apk", (req, res) => {
  const apk = path.join(root, "android", "dist", "MosaicPlayer-AndroidTV.apk");
  if (!existsSync(apk)) return res.status(503).type("text/plain").send("Android TV 安装包尚未构建，请运行 npm run build:android。");
  res.type("application/vnd.android.package-archive");
  res.download(apk, "MosaicPlayer-AndroidTV.apk");
});
app.use(express.static(path.join(root, "public")));
app.get("/play", (req, res) =>
  res.sendFile(path.join(root, "public", "play.html")),
);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  res.set("Cache-Control", "no-store");
  res.status(err.status || 400).json({
    error:
      err.code === "LIMIT_FILE_SIZE"
        ? "单个文件最大 1 GB"
        : err.message || "操作失败",
  });
});
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost"),
    identity = identify(
      req.headers.authorization?.replace(/^Bearer /, "") ||
        url.searchParams.get("key"),
    );
  if (url.pathname !== "/ws" || !identity) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) =>
    wss.emit("connection", ws, identity),
  );
});
wss.on("connection", (ws, identity) => {
  if (identity.role === "player") reservations.delete(identity.screenId);
  const c = { ws, ...identity, alive: true, report: null };
  clients.add(c);
  ws.on("pong", () => (c.alive = true));
  broadcast();
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "clock")
        send(c, "clock", { id: msg.id, serverTime: now() });
      if (msg.type === "report" && c.role === "player") {
        c.report = {
          client: ["native-macos", "android-tv"].includes(msg.client) ? msg.client : "browser",
          drift: Number.isFinite(msg.drift) ? Math.round(msg.drift) : null,
          rtt: Number.isFinite(msg.rtt) ? Math.round(msg.rtt) : null,
          status: String(msg.status || "").slice(0, 100),
          width: Number(msg.width) || 0,
          height: Number(msg.height) || 0,
          diagnostics: msg.client === "android-tv" ? playbackDiagnostics(msg.diagnostics) : null,
          at: now(),
        };
        for (const a of clients)
          if (a.role === "admin") send(a, "devices", { devices: devices() });
      }
      if (
        msg.type === "ready" &&
        c.role === "player" &&
        pending?.id === msg.id
      ) {
        pending.ready.add(c);
        if ([...pending.expected].every((peer) => pending.ready.has(peer)))
          commit();
      }
      if (
        msg.type === "failed" &&
        c.role === "player" &&
        pending?.id === msg.id
      ) {
        cancelPending();
        for (const a of clients)
          if (a.role === "admin")
            send(a, "notice", {
              message: "设备无法加载素材，已取消切换。请检查格式和网络。",
            });
        broadcast();
      }
    } catch {
      ws.close(1003, "Invalid message");
    }
  });
  ws.on("close", () => {
    clients.delete(c);
    if (pending?.expected.has(c)) {
      cancelPending();
      for (const a of clients)
        if (a.role === "admin")
          send(a, "notice", { message: "设备在准备过程中断开，已取消切换。" });
    }
    broadcast();
  });
  ws.on("error", () => ws.terminate());
});
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    c.ws.ping();
  }
}, 10000).unref();
let advertisement;
process.once("exit", () => advertisement?.kill());
process.once("SIGTERM", () => process.exit(0));
process.once("SIGINT", () => process.exit(0));
server.listen(
  Number(process.env.PORT) || 3210,
  process.env.HOST || "0.0.0.0",
  () => {
    console.log(
      `Mosaic Player: http://localhost:${server.address().port}\n管理密钥保存在 ${keyFile}\n局域网设备请使用后台提供的设备链接。`,
    );
    if (process.platform === "darwin" && process.env.PLAYER_DISCOVERY_ADVERTISE !== "0" &&
        !["127.0.0.1", "::1"].includes(process.env.HOST)) {
      advertisement = spawn("/usr/bin/dns-sd", [
        "-R", process.env.PLAYER_SERVER_NAME || `Mosaic-${hostname().split(".")[0]}`,
        "_mosaic-player._tcp", "local.", String(server.address().port),
        "version=1",
      ], { stdio: "ignore" });
      advertisement.on("error", () => console.warn("Bonjour 广播不可用；仍可手工输入服务器地址。"));
    }
  },
);
