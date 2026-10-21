import { positionAt, correction, geometry, estimateOffset } from "./sync.js";
import { SegmentTracker, ProofQueue, proofNamespace } from "./proof.js";
import { programCursor } from "./program.js";
import { FrozenTransition } from "./transitions.js";
import { BrowserProgram } from "./browser-program.js";
const $ = (s) => document.querySelector(s),
  query = new URLSearchParams(location.search),
  key = query.get("key"),
  screenId = query.get("screen");
let ws,
  state,
  screen,
  offset = 0,
  samples = [],
  inflight = new Map(),
  clockReady = false,
  clockCount = 0,
  current = null,
  prepared = null,
  loadingId = null,
  status = "idle",
  lastDrift = null,
  rtt = null,
  retryTimer,
  hideTimer,
  wakeLock,
  reconnectDelay = 1000,
  latestError = "",
  generation = 0,
  revoked = false;
const programs = new BrowserProgram({key,screenId,send,error: text => label(text)});
const capabilities = programs.supported ? ["programs", "audio", "freeform", "transitions"] : ["freeform", "transitions"];
const time = () => performance.timeOrigin + performance.now();
const synced = () => time() + offset;
function send(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function label(text) {
  $("#player-status").textContent = text;
}
function resize() {
  if (!screen || !state) return;
  const g = geometry(state.layout, screen, innerWidth, innerHeight);
  Object.assign($("#viewport").style, {
    transform: `rotate(${g.rotation}deg)`,
    transformOrigin: "center",
    left: `${g.offsetX}px`,
    top: `${g.offsetY}px`,
    width: `${g.tileWidth * g.scale}px`,
    height: `${g.tileHeight * g.scale}px`,
  });
  Object.assign($("#wall").style, {
    width: `${g.wallWidth}px`,
    height: `${g.wallHeight}px`,
    transform: `scale(${g.scale})`,
    left: `${-g.x * g.scale}px`,
    top: `${-g.y * g.scale}px`,
  });
}
window.addEventListener("resize", resize);
function destroy(item) {
  if (!item) return;
  if (item.el.tagName === "VIDEO") {
    item.el.pause();
    item.el.removeAttribute("src");
    item.el.load();
  }
  item.el.remove();
}
function load(media) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(media.type === "video" ? "video" : "img");
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) {
        destroy({ el });
        reject(error);
      } else resolve({ id: media.id, el, media });
    };
    const timer = setTimeout(
      () => finish(new Error("加载超时，请检查网络与视频编码")),
      25000,
    );
    el.onerror = () =>
      finish(new Error("无法解码素材，请使用 H.264 MP4 或常见图片格式"));
    if (media.type === "video") {
      for (const event of ["waiting","seeking","pause","error"]) el.addEventListener?.(event,()=>{if(current?.el===el)proofTracker.reset();});
      el.muted = true;
      el.defaultMuted = true;
      el.loop = true;
      el.playsInline = true;
      el.preload = "auto";
      el.oncanplay = () => finish();
    } else el.onload = () => finish();
    el.src = programs.assets.get(media.id) || `/media/${media.id}?key=${encodeURIComponent(key)}`;
  });
}
async function prepare(pending) {
  if (prepared?.pendingId === pending.id) {
    send({ type: "ready", id: pending.id });
    return;
  }
  if (loadingId === pending.id) return;
  const media = state.media.find((m) => m.id === pending.mediaId);
  if (!media) return;
  loadingId = pending.id;
  status = "loading";
  label("正在预加载下一份素材…");
  const gen = ++generation;
  try {
    const item = await load(media);
    if (gen !== generation || state.pending?.id !== pending.id) {
      destroy(item);
      return;
    }
    destroy(prepared);
    prepared = { ...item, pendingId: pending.id };
    loadingId = null;
    status = current ? "playing" : "ready";
    send({ type: "ready", id: pending.id });
    label("素材已就绪，等待统一开始时间");
  } catch (e) {
    if (gen !== generation) return;
    loadingId = null;
    latestError = current ? "" : e.message;
    status = current ? (state.playback.paused ? "paused" : "playing") : "error";
    label(current ? `新素材加载失败，保留原内容：${e.message}` : e.message);
    send({ type: "failed", id: pending.id });
  }
}
let visualTransition, nextRetryAt=0;
function mount(item) {
  const previous=current;current=item;
  visualTransition ||= new FrozenTransition({layer:$("#media-layer"),now:synced,doc:document,raf:fn=>requestAnimationFrame(fn)});
  item.frameReady=item.media.type==='image';
  if(item.media.type==='video'){
    const observe=()=>{item.frameReady=false;if(item.el.requestVideoFrameCallback)item.el.requestVideoFrameCallback(()=>{if(current===item)item.frameReady=true;});};
    item.el.addEventListener?.('seeking',observe);item.el.addEventListener?.('error',()=>{item.failed=true;if(current===item){status='error';latestError='新视频解码失败，保留可用画面';label(latestError);}});observe();
  }
  const ready=()=>!item.failed&&(item.media.type==='image'||(item.el.readyState>=2&&!item.el.seeking&&!item.el.paused&&(item.frameReady||!item.el.requestVideoFrameCallback)&&Math.abs(lastDrift||0)<180));
  visualTransition.begin(previous?.el,item.el,{transition:state.playback.transition,epoch:state.playback.epoch,ready,release:()=>destroy(previous)});
  $("#idle-art").hidden = true;
  latestError = "";
  lastDrift = null;
}
async function ensureCurrent() {
  if (!state?.playback.mediaId || !clockReady) return;
  const wanted = state.playback.mediaId;
  if (prepared?.id === wanted) {
    if (!state.playback.paused && synced() < state.playback.epoch) return;
    const item = prepared;
    prepared = null;
    mount(item);
    return;
  }
  if (current?.id === wanted) return;
  if (loadingId === wanted) return;
  const media = state.media.find((m) => m.id === wanted);
  if (!media) return;
  loadingId = wanted;
  status = "loading";
  label("正在加载当前内容…");
  const gen = ++generation;
  try {
    const item = await load(media);
    if (gen !== generation || state.playback.mediaId !== wanted) {
      destroy(item);
      return;
    }
    loadingId = null;
    if (!state.playback.paused && synced() < state.playback.epoch) {
      prepared = item;
      return;
    }
    mount(item);
  } catch (e) {
    if (gen !== generation) return;
    loadingId = null;
    status = "error";
    latestError = e.message;
    label(e.message);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      latestError = "";
      ensureCurrent();
    }, 5000);
  }
}
function apply() {
  if (!state) return;
  screen = state.layout.screens.find((s) => s.id === screenId);
  if (!screen) {
    status = "error";
    label("屏幕已被移除，请在后台重新获取播放链接");
    return;
  }
  $("#screen-name").textContent =
    `${screen.name} · 第 ${screen.row + 1} 行 / 第 ${screen.col + 1} 列`;
  resize();
  if (state.pending) {
    prepare(state.pending);
  } else {
    if (!state.playback.mediaId) {
      generation++;
      loadingId = null;
      visualTransition?.clear();
      destroy(current);
      destroy(prepared);
      current = prepared = null;
      latestError = "";
      lastDrift = null;
      status = "idle";
      $("#idle-art").hidden = false;
      return;
    }
    if (
      prepared?.pendingId &&
      prepared.pendingId !== state.playback.preparationId
    ) {
      destroy(prepared);
      prepared = null;
    }
    if (loadingId && loadingId !== state.playback.mediaId) {
      generation++;
      loadingId = null;
    }
    ensureCurrent();
  }
}
function ping() {
  if (ws?.readyState !== WebSocket.OPEN) return;
  const id = ++clockCount;
  inflight.set(id, time());
  send({ type: "clock", id });
  for (const [k, t] of inflight) if (time() - t > 10000) inflight.delete(k);
}
function quarantine() {
  revoked = true; generation++; clearTimeout(retryTimer);
  loadingId = null; state = null; screen = null; clockReady = false;
  visualTransition?.clear();destroy(current); destroy(prepared); current = prepared = null;
  programs.revoke(); status = "error"; latestError = "设备授权已撤销，请重新配对";
  $("#idle-art").hidden = false; label(latestError);
}
function receiveState(raw) {
  if (revoked) return;
  programs.receive(raw);
  if (raw.program || raw.pendingProgram) {
    const effective = programs.effective(synced());
    if (effective) state = effective;
    else if (!state) state = raw;
    screen = state.layout.screens.find(s => s.id === screenId); resize();
  } else { state = raw; apply(); }
}
async function connect() {
  if (revoked) return;
  if (!key || !screenId) {
    status = "error";
    label("播放链接不完整，请从后台设备管理重新复制链接");
    return;
  }
  try {
    const response = await fetch("/api/state", {headers:{Authorization:`Bearer ${key}`, "X-Mosaic-Capabilities": capabilities.join(",")},redirect:"error"});
    if ([401,403].includes(response.status)) { quarantine(); return; }
    if (response.ok) receiveState((await response.json()).state);
  } catch { /* Network loss permits already-authorized offline content. */ }
  if (revoked) return;
  ws = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws?key=${encodeURIComponent(key)}&capabilities=${capabilities.join(",")}`,
  );
  ws.onopen = () => {
    reconnectDelay = 1000;
    $("#connection-warning").hidden = true;
    samples = [];
    for (let i = 0; i < 8; i++) setTimeout(ping, i * 120);
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "clock") {
      const sent = inflight.get(msg.id);
      if (sent === undefined) return;
      inflight.delete(msg.id);
      const received = time();
      samples.push({
        rtt: received - sent,
        offset: msg.serverTime - (sent + received) / 2,
      });
      samples = samples.slice(-24);
      offset = estimateOffset(samples);
      rtt = Math.min(...samples.map((s) => s.rtt));
      clockReady = true;
      apply();
    }
    if (msg.type === "state") {
      receiveState(msg.state);
    }
  };
  ws.onclose = (e) => {
    if ([4001, 4003, 4401, 4403].includes(e.code)) { quarantine(); return; }
    if (revoked) return;
    $("#connection-warning").hidden = false;
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.6, 8000);
  };
  ws.onerror = () => {
    label("无法连接，请确认链接有效且后台服务在线");
  };
}
let playAttempt = false;
function preloadProgramNext(){
  const manifest=programs.active?.program;
  if(!manifest||!clockReady||state.pending||state.pendingProgram||loadingId||!current||current.id!==state.playback.mediaId||synced()<nextRetryAt)return;
  const cursor=programCursor(manifest,synced());if(!cursor||cursor.duration-cursor.position>3)return;
  const next=programCursor(manifest,cursor.epoch+cursor.duration*1000+1);
  if(!next||next.mediaId===current.id||prepared?.id===next.mediaId)return;
  const media=state.media.find(m=>m.id===next.mediaId);if(!media)return;
  const gen=++generation;loadingId=next.mediaId;
  load(media).then(item=>{if(gen!==generation||programs.active?.program.id!==manifest.id){destroy(item);return;}destroy(prepared);prepared=item;loadingId=null;}).catch(()=>{if(gen===generation){loadingId=null;nextRetryAt=synced()+5000;}});
}
function playbackTick() {
  if (revoked) return;
  const effective = programs.effective(synced());
  if (effective) { const changed = state?.playback?.mediaId !== effective.playback.mediaId; state = effective; screen = state.layout.screens.find(s => s.id === screenId); if (changed) apply(); }
  if (!state || !screen || !clockReady) return;
  if (!state.pending && !latestError) ensureCurrent();
  const p = state.playback;
  if (!current) {
    if (!p.mediaId && !state.pending) {
      status = "idle";
      label(
        `屏幕已连接 · 时钟往返 ${rtt?.toFixed(1) || "—"} ms · 等待后台播放内容`,
      );
    }
    return;
  }
  if (current.id !== p.mediaId) return; // Keep previous content playing until target renders.
  const el = current.el,
    before = !p.paused && synced() < p.epoch;
  if (before) {
    status = "waiting";
    el.pause?.();
    return;
  }
  if (current.media.type === "image") {
    status = p.paused ? "paused" : "playing";
    if(!visualTransition?.covering)programs.presentedID = programs.active?.program.id || null;
    lastDrift = null;
    label(
      `${p.paused ? "已暂停" : "图片显示中"} · 时钟往返 ${rtt?.toFixed(1) || "—"} ms`,
    );
    return;
  }
  el.volume = programs.videoVolume(synced()); el.muted = el.volume === 0;
  const target = positionAt(p, synced(), current.media.duration);
  const fix = correction(target, el.currentTime, current.media.duration);
  lastDrift = fix.drift * 1000;
  if (el.readyState < 2 || el.seeking) {
    status = "loading";
    return;
  }
  if (p.paused) {
    el.pause();
    el.playbackRate = 1;
    if (Math.abs(fix.drift) > 0.04) el.currentTime = target;
    status = "paused";
  } else {
    if (fix.seek) { proofTracker.reset(); el.currentTime = target; }
    el.playbackRate = fix.seek ? 1 : fix.rate;
    if (el.paused && !playAttempt) {
      playAttempt = true;
      el.play()
        .then(() => {
          latestError = "";
        })
        .catch(() => {
          status = "blocked";
          latestError = "请点击进入全屏以启用播放";
          label(latestError);
          document.body.classList.remove("hidden-controls");
        })
        .finally(() => (playAttempt = false));
    }
    status = latestError ? "blocked" : "playing";
    if (!visualTransition?.covering && !el.paused && !el.seeking && !latestError && Math.abs(fix.drift) < 1) programs.presentedID = programs.active?.program.id || null;
  }
  if (!latestError)
    label(
      `${status === "paused" ? "已暂停" : "同步播放中"} · 偏差 ${Math.abs(lastDrift).toFixed(0)} ms · 时钟往返 ${rtt?.toFixed(1) || "—"} ms`,
    );
}
const proofTracker = new SegmentTracker();
let proofStore;try{proofStore=localStorage;}catch{proofStore={getItem:()=>null,setItem:()=>{}};}
const proofQueue=new ProofQueue(proofStore,proofNamespace(location.origin+"/"+screenId+"/"+key));
let proofUploading=false;
function observeProof(){
    const now=synced(),p=state?.playback,program=programs.active?.program,cursor=program?programCursor(program,now):null;
    const durationMs=Math.round((cursor?.duration||current?.media.duration||0)*1000);
    const startAt=cursor?Math.round(cursor.epoch):p&&durationMs?Math.round(p.epoch)+Math.floor((now-p.epoch)/durationMs)*durationMs:0;
    const ready=!visualTransition?.covering&&!revoked&&clockReady&&document.visibilityState==='visible'&&current?.id===p?.mediaId&&!p?.paused&&status==='playing'&&!latestError&&(current.media.type==='image'||current.el.readyState>=3&&!current.el.paused&&!current.el.seeking&&Math.abs(lastDrift||0)<180);
    const event=proofTracker.observe({now,startAt,durationMs,video:current?.media.type==='video',positionMs:(current?.el.currentTime||0)*1000,sourceDurationMs:(current?.el.duration||current?.media.duration||0)*1000,mediaId:current?.id,programId:program?.id||null,control:program?.id||`direct:${p?.revision}`,ready:ready&&(Boolean(cursor)||current?.media.type==='video')});
    if(event)proofQueue.add(event);
}
function tick(){observeProof();try{playbackTick();preloadProgramNext();}finally{observeProof();}}
setInterval(async()=>{
  if(revoked||proofUploading)return;const events=proofQueue.batch();if(!events.length)return;proofUploading=true;
  try{const r=await fetch('/api/device/play-events',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({events}),redirect:'error',signal:AbortSignal.timeout(12000)});if(r.ok)proofQueue.acknowledge(await r.json());}catch{}finally{proofUploading=false;}
},10000);
setInterval(tick, 100);
setInterval(ping, 3000);
setInterval(
  () =>
    send({
      type: "report",
      client: "browser", version: "0.3.0", capabilities, programId: programs.presentedID || null, mediaId: current?.id || null,
      playbackRevision: !visualTransition?.covering && current?.id === state?.playback.mediaId && status === "playing" &&
        synced() >= state.playback.epoch &&
        (current?.media.type === "image" || (current?.el.readyState >= 2 && !current.el.paused && !current.el.seeking && !latestError))
        ? state.playback.revision : null,
      drift: lastDrift,
      rtt,
      status,
      width: innerWidth,
      height: innerHeight,
    }),
  1000,
);
async function keepAwake() {
  try {
    if ("wakeLock" in navigator)
      wakeLock = await navigator.wakeLock.request("screen");
  } catch {}
}
$("#fullscreen").onclick = async () => {
  programs.unlockAudio();
  latestError = "";
  if (current?.el.tagName === "VIDEO" && !state.playback.paused)
    current.el.play().catch(() => {});
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    label("浏览器未允许全屏，可使用浏览器的全屏菜单");
  }
  await keepAwake();
  showControls();
};
function showControls() {
  document.body.classList.remove("hidden-controls");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(
    () => document.body.classList.add("hidden-controls"),
    6000,
  );
}
$("#hide-info").onclick = () => document.body.classList.add("hidden-controls");
document.addEventListener("mousemove", showControls);
document.addEventListener("touchstart", showControls, { passive: true });
document.addEventListener("keydown", showControls);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    ping();
    tick();
    keepAwake();
  }
});
window.addEventListener("online", () => {
  if (ws?.readyState === WebSocket.CLOSED) connect();
});
if (key && screenId) programs.restore().then(cached => { if (!revoked && !state && cached) {state = cached; screen = state.layout.screens.find(s => s.id === screenId); clockReady = true; resize();} });
connect();
showControls();

if (programs.supported && "serviceWorker" in navigator) navigator.serviceWorker.register("/player-sw.js").catch(() => label("离线页面保存失败，刷新页面需要联网"));
