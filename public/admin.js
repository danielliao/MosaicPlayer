const $ = (s) => document.querySelector(s);
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let key = sessionStorage.getItem("mosaic-admin") || "",
  state,
  devices = [],
  ws,
  filter = "all",
  selectedBase = location.origin,
  toastTimer,
  mediaSignature = "",
  previewId = null;
const mediaUrl = (id) => `/media/${id}?key=${encodeURIComponent(key)}`;
const size = (bytes) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
const duration = (secs) =>
  `${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, "0")}`;
function toast(message, error = false) {
  $("#toast").textContent = message;
  $("#toast").className = `toast${error ? " error" : ""}`;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 5500);
}
async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `请求失败 (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}
function view(name) {
  document.body.dataset.view = name;
  document
    .querySelectorAll(".nav-item")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  const titles = {
    overview: [
      "播放总览",
      "让每块屏幕，成为同一幅画面。",
      "上传内容、连接设备，让精彩在屏幕之间自然延伸。",
    ],
    media: [
      "素材库",
      "每一份内容，都值得被看见。",
      "本地保存图片与视频，随时投放到整幅拼接画布。",
    ],
    devices: [
      "设备管理",
      "连接屏幕，延伸你的画面。",
      "为每台设备分配独立链接，连接后自动对齐播放进度。",
    ],
    layout: [
      "屏幕布局",
      "一幅画布，无限可能。",
      "设置屏幕排列与边框补偿，让画面在接缝处保持连贯。",
    ],
  };
  $("#breadcrumb").textContent = titles[name][0];
  $("#page-title").textContent = titles[name][1];
  $("#page-description").textContent = titles[name][2];
}
document
  .querySelectorAll(".nav-item")
  .forEach((b) => (b.onclick = () => view(b.dataset.view)));
$("#edit-layout").onclick = $("#device-layout").onclick = () => view("layout");
$("#connect-devices").onclick = () => view("devices");
$("#help-button").onclick = () => $("#help-dialog").showModal();
$("#close-help").onclick = () => $("#help-dialog").close();
function render() {
  const l = state.layout,
    m = state.media.find((m) => m.id === state.playback.mediaId),
    width = l.cols * l.tileWidth + (l.cols - 1) * l.gapX,
    height = l.rows * l.tileHeight + (l.rows - 1) * l.gapY;
  $("#wall-dimensions").textContent = `${width} × ${height}`;
  $("#layout-summary").textContent =
    `${l.cols} 列 × ${l.rows} 行 · ${l.cols >= l.rows ? "横向" : "纵向"}拼接`;
  $("#media-count").textContent =
    $("#nav-count").textContent =
    $("#library-count").textContent =
      state.media.length;
  $("#media-summary").textContent = state.media.length
    ? `${state.media.filter((m) => m.type === "video").length} 个视频 · ${state.media.filter((m) => m.type === "image").length} 张图片`
    : "图片和视频，一个空间管理";
  $("#total-devices").textContent = `/ ${l.screens.length} 台`;
  $("#screen-count").textContent = l.screens.length;
  $("#wall-preview").style.aspectRatio = `${width}/${height}`;
  const grid = $("#preview-grid");
  grid.style.gridTemplateColumns = `repeat(${l.cols},1fr)`;
  grid.style.gridTemplateRows = `repeat(${l.rows},1fr)`;
  grid.style.columnGap = `${(l.gapX / width) * 100}%`;
  grid.style.rowGap = `${(l.gapY / height) * 100}%`;
  grid.innerHTML = l.screens
    .map(
      (s) =>
        `<div class="preview-tile"><span>${escape(s.name)} · ${s.col + 1},${s.row + 1}</span></div>`,
    )
    .join("");
  for (const k of ["cols", "rows", "tileWidth", "tileHeight", "gapX", "gapY"])
    if (document.activeElement !== $("#layout-form").elements[k])
      $("#layout-form").elements[k].value = l[k];
  if (previewId !== m?.id) {
    previewId = m?.id;
    $("#preview-media").innerHTML = m
      ? m.type === "image"
        ? `<img alt="当前拼接内容" src="${mediaUrl(m.id)}">`
        : `<video muted loop autoplay playsinline src="${mediaUrl(m.id)}"></video>`
      : "";
    const video = $("#preview-media video");
    if (video) {
      video.muted = true;
      video.play().catch(() => {});
    }
  }
  const v = $("#preview-media video");
  if (v) {
    if (state.playback.paused) v.pause();
    else v.play().catch(() => {});
  }
  $("#playing-title").textContent = m?.name || "还没有播放内容";
  $("#playing-detail").textContent = state.pending
    ? "正在等待在线设备加载素材…"
    : m
      ? `${m.width} × ${m.height} · ${m.type === "video" ? `${duration(m.duration)} · 静音循环播放` : "图片 · 持续显示"}`
      : "上传素材，开始你的第一幅拼接画面";
  $("#playback-badge").textContent = state.pending
    ? "准备中"
    : m
      ? state.playback.paused
        ? "已暂停"
        : "播放中"
      : "待机中";
  $("#playback-badge").classList.toggle(
    "active",
    !!m && !state.playback.paused,
  );
  $("#pause-button").disabled = !m || !!state.pending;
  $("#restart-button").disabled = !m || !!state.pending;
  $("#stop-button").disabled = !m && !state.pending;
  $("#pause-button").textContent = state.playback.paused ? "▶" : "Ⅱ";
  $("#pause-button").setAttribute(
    "aria-label",
    state.playback.paused ? "继续播放" : "暂停播放",
  );
  $("#step-one").textContent = state.media.length ? "✓" : "↗";
  $("#step-three").textContent = m ? "✓" : "↗";
  $("#preview-caption").textContent = state.pending
    ? "素材准备中 · 加载完成后统一开始"
    : m
      ? "画布预览 · 播放同步以设备端状态为准"
      : "布局示意 · 连接设备后可显示校准画面";
  renderMedia();
  renderDevices();
}
function renderMedia() {
  const signature = JSON.stringify([
    state.media.map((m) => m.id),
    filter,
    state.playback.mediaId,
    state.pending?.id,
  ]);
  if (signature === mediaSignature) return;
  mediaSignature = signature;
  const list = state.media.filter((m) => filter === "all" || m.type === filter);
  $("#media-list").innerHTML = list.length
    ? list
        .map(
          (m) =>
            `<article class="media-card ${state.playback.mediaId === m.id ? "playing" : ""}"><div class="thumbnail">${m.type === "image" ? `<img src="${mediaUrl(m.id)}" alt="${escape(m.name)}" loading="lazy">` : `<video src="${mediaUrl(m.id)}#t=0.1" preload="metadata" muted playsinline></video>`}<span class="media-type">${m.type === "video" ? `▶ ${duration(m.duration)}` : "▧ 图片"}</span></div><div class="media-info"><div class="media-name" title="${escape(m.name)}">${escape(m.name)}</div><div class="media-meta">${m.width} × ${m.height} · ${size(m.size)}</div><div class="media-actions"><button class="button ${state.playback.mediaId === m.id ? "primary" : "secondary"}" data-play="${m.id}" ${state.pending ? "disabled" : ""}>${state.playback.mediaId === m.id ? "↻ 重新播放" : "▶ 播放"}</button><button class="icon-button" aria-label="删除 ${escape(m.name)}" data-delete="${m.id}" ${state.playback.mediaId === m.id || state.pending?.mediaId === m.id ? "disabled" : ""}>×</button></div></div></article>`,
        )
        .join("")
    : `<div class="empty-library">${state.media.length ? "当前分类还没有素材" : "还没有素材，从你的第一张图片或第一段视频开始。"}</div>`;
}
function playerLink(screen) {
  return `${selectedBase}/play?screen=${screen.id}&key=${screen.key}`;
}
function renderDevices() {
  if (!state) return;
  const published = state.publication?.enabled === true;
  $("#publication-status").textContent = published ? "屏幕已发布 · 客户端可自行选屏" : "尚未发布屏幕";
  $("#publication-toggle").textContent = published ? "停止新设备接入" : "发布屏幕供客户端选择";
  $("#publication-help").textContent = published
    ? "局域网内的客户端可领取空闲屏幕的播放权限。停止发布不影响已经配对的设备。"
    : "发布后，局域网原生客户端可直接选择屏幕编号，无需复制链接。";
  const online = devices.filter((d) => d.online).length;
  $("#online-count").textContent = online;
  $("#device-summary").textContent =
    online === state.layout.screens.length
      ? "全部屏幕已连接"
      : online
        ? `还有 ${state.layout.screens.length - online} 台等待连接`
        : "等待设备连接";
  $("#step-two").textContent = online ? "✓" : "↗";
  const reports = devices.filter(
    (d) =>
      d.online &&
      d.report?.drift !== null &&
      d.report?.drift !== undefined &&
      d.report.status === "playing",
  );
  const max = reports.length
    ? Math.max(...reports.map((d) => Math.abs(d.report.drift)))
    : null;
  $("#drift-value").textContent = max === null ? "—" : max;
  $("#drift-summary").textContent =
    max === null
      ? "等待播放器上报"
      : `在线设备最大绝对偏差 · ${reports.length} 台`;
  $("#network-warning").hidden = !/localhost|127\.0\.0\.1/.test(selectedBase);
  $("#device-rows").innerHTML = state.layout.screens
    .map((s, i) => {
      const d = devices.find((d) => d.id === s.id),
        report = d?.report;
      const diagnostic = report?.diagnostics;
      const diagnosticText = diagnostic ? `Android ${diagnostic.sdk ?? "?"} · ${diagnostic.model ?? ""} · v${diagnostic.version ?? "?"} · 渲染 ${diagnostic.renderFps ?? "—"} fps · 丢帧 ${diagnostic.droppedFrames ?? 0} · 校正跳转 ${diagnostic.correctionSeeks ?? 0} · 缓冲 ${diagnostic.rebufferCount ?? 0}${diagnostic.correctionsEnabled === false ? " · 诊断：自动校时暂停" : ""}` : "";
      return `<tr><td><div class="screen-name"><span class="screen-icon">${String(i + 1).padStart(2, "0")}</span><div><strong>${escape(s.name)}</strong><small>${report?.width ? `${report.client === "native-macos" ? "原生 Mac · " : report.client === "android-tv" ? "Android TV · " : ""}${report.width} × ${report.height}` : "等待设备注册"}</small></div></div></td><td>第 ${s.row + 1} 行 / 第 ${s.col + 1} 列</td><td><span class="${d?.online ? "device-online" : "device-offline"}"><span class="dot ${d?.online ? "green" : ""}"></span>${d?.online ? "在线" : "未连接"}</span>${d?.online && diagnostic ? `<small class="device-report">${escape(diagnosticText)}</small>` : ""}${d?.connections > 1 ? ` <small>(${d.connections} 个连接)</small>` : ""}${report?.status && d?.online ? `<small class="device-report"> · ${escape({ playing: "播放中", paused: "已暂停", ready: "已就绪", loading: "加载中", waiting: "等待开始", idle: "待机", error: "加载失败", blocked: "需要点击启用" }[report.status] || report.status)}</small>` : ""}</td><td>${d?.online && report?.drift != null ? `${Math.abs(report.drift)} ms` : "—"}</td><td><button class="table-link" data-copy="${s.id}">复制链接</button><a class="native-link table-link" href="mosaic-player://connect?url=${encodeURIComponent(playerLink(s))}">原生打开 ↗</a><a class="open-link" href="${playerLink(s)}" target="_blank" rel="noopener">浏览器</a></td></tr>`;
    })
    .join("");
}
document.querySelectorAll("[data-filter]").forEach(
  (b) =>
    (b.onclick = () => {
      filter = b.dataset.filter;
      document
        .querySelectorAll("[data-filter]")
        .forEach((x) => x.classList.toggle("active", x === b));
      renderMedia();
    }),
);
async function command(action, mediaId) {
  try {
    await api("/api/playback", {
      method: "POST",
      body: JSON.stringify({ action, mediaId }),
    });
    if (action === "play") toast("正在准备素材，在线设备就绪后统一播放");
  } catch (e) {
    toast(e.message, true);
  }
}
$("#media-list").onclick = async (e) => {
  const play = e.target.closest("[data-play]"),
    del = e.target.closest("[data-delete]");
  if (play) command("play", play.dataset.play);
  if (del) {
    const m = state.media.find((m) => m.id === del.dataset.delete);
    if (confirm(`删除素材「${m.name}」？这会删除后台保存的文件。`))
      try {
        await api(`/api/media/${m.id}`, { method: "DELETE" });
        toast("素材已删除");
      } catch (e) {
        toast(e.message, true);
      }
  }
};
$("#pause-button").onclick = () =>
  command(state.playback.paused ? "resume" : "pause");
$("#restart-button").onclick = () => command("play", state.playback.mediaId);
$("#stop-button").onclick = () => command("stop");
$("#device-rows").onclick = async (e) => {
  const b = e.target.closest("[data-copy]");
  if (!b) return;
  const link = playerLink(
    state.layout.screens.find((s) => s.id === b.dataset.copy),
  );
  try {
    if (navigator.clipboard && window.isSecureContext)
      await navigator.clipboard.writeText(link);
    else {
      const t = document.createElement("textarea");
      t.value = link;
      t.style.position = "fixed";
      t.style.opacity = "0";
      document.body.append(t);
      t.select();
      if (!document.execCommand("copy")) throw new Error();
      t.remove();
    }
    toast("设备播放链接已复制");
  } catch {
    prompt("复制此设备播放链接", link);
  }
};
$("#network-address").onchange = (e) => {
  selectedBase = e.target.value;
  renderDevices();
};
$("#publication-toggle").onclick = async () => {
  const button = $("#publication-toggle");
  button.disabled = true;
  try {
    const enabled = !state.publication?.enabled;
    await api("/api/publication", { method: "PUT", body: JSON.stringify({ enabled }) });
    toast(enabled ? "屏幕已发布，可在原生客户端选择屏幕编号" : "已停止新的自助接入，已配对设备继续播放");
  } catch (e) { toast(e.message, true); }
  finally { button.disabled = false; }
};
$("#layout-form").onsubmit = async (e) => {
  e.preventDefault();
  const values = Object.fromEntries(
    [...new FormData(e.target)].map(([k, v]) => [k, Number(v)]),
  );
  const old = state.layout;
  if (
    (values.cols < old.cols || values.rows < old.rows) &&
    !confirm("缩小布局会移除超出范围的设备，原设备链接将失效。继续保存？")
  )
    return;
  try {
    await api("/api/layout", { method: "PUT", body: JSON.stringify(values) });
    toast("屏幕布局已更新");
  } catch (e) {
    toast(e.message, true);
  }
};
let uploading = false;
function upload(file) {
  if (!file || uploading) return;
  if (file.size > 1024 ** 3) return toast("单个文件最大 1 GB", true);
  uploading = true;
  $("#upload-progress").hidden = false;
  $("#upload-progress").value = 0;
  $("#upload-label").textContent = `正在上传 ${file.name}`;
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/media");
  xhr.setRequestHeader("Authorization", `Bearer ${key}`);
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      $("#upload-progress").value = (e.loaded / e.total) * 100;
      if (e.loaded === e.total)
        $("#upload-label").textContent = "上传完成，正在验证素材…";
    }
  };
  const finish = () => {
    uploading = false;
    $("#upload-progress").hidden = true;
    $("#upload-label").textContent = "拖放文件到这里，或点击上传";
    $("#file-input").value = "";
  };
  xhr.onload = () => {
    let result;
    try {
      result = JSON.parse(xhr.responseText);
    } catch {
      result = { error: "上传失败" };
    }
    toast(
      xhr.status === 201 ? "素材已上传，点击播放即可同步投放" : result.error,
      xhr.status !== 201,
    );
    finish();
  };
  xhr.onerror = () => {
    toast("网络连接失败，请重试上传", true);
    finish();
  };
  const form = new FormData();
  form.append("file", file);
  xhr.send(form);
}
$("#top-upload").onclick = $("#drop-zone").onclick = () =>
  $("#file-input").click();
$("#file-input").onchange = (e) => upload(e.target.files[0]);
for (const type of ["dragenter", "dragover"])
  $("#drop-zone").addEventListener(type, (e) => {
    e.preventDefault();
    $("#drop-zone").classList.add("dragging");
  });
for (const type of ["dragleave", "drop"])
  $("#drop-zone").addEventListener(type, (e) => {
    e.preventDefault();
    $("#drop-zone").classList.remove("dragging");
    if (type === "drop") upload(e.dataTransfer.files[0]);
  });
let reconnectTimer;
function connect() {
  clearTimeout(reconnectTimer);
  ws = new WebSocket(
    `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws?key=${encodeURIComponent(key)}`,
  );
  ws.onopen = () => {
    $("#connection-dot").className = "dot green";
    $("#connection-label").innerHTML =
      "同步服务在线<small>局域网同步服务</small>";
    $("#offline-banner").hidden = true;
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "state") {
      state = msg.state;
      devices = msg.devices;
      render();
    }
    if (msg.type === "devices") {
      devices = msg.devices;
      renderDevices();
    }
    if (msg.type === "notice") toast(msg.message, true);
  };
  ws.onclose = () => {
    $("#connection-dot").className = "dot red";
    $("#connection-label").innerHTML =
      "正在重新连接<small>局域网同步服务</small>";
    $("#offline-banner").hidden = false;
    reconnectTimer = setTimeout(connect, 2500);
  };
}
async function start() {
  try {
    const result = await api("/api/state");
    state = result.state;
    devices = result.devices;
    sessionStorage.setItem("mosaic-admin", key);
    $("#login-dialog").close();
    render();
    const network = await api("/api/network");
    const addresses = [...new Set([...network.addresses, location.origin])];
    selectedBase = network.addresses[0] || location.origin;
    $("#network-address").innerHTML = addresses
      .map((a) => `<option value="${escape(a)}">${escape(a)}</option>`)
      .join("");
    $("#network-address").value = selectedBase;
    renderDevices();
    connect();
  } catch (e) {
    $("#login-error").textContent = key ? e.message : "";
    if (!$("#login-dialog").open) $("#login-dialog").showModal();
  }
}
$("#login-dialog").addEventListener("cancel", (e) => e.preventDefault());
$("#login-form").onsubmit = (e) => {
  e.preventDefault();
  key = $("#admin-key").value.trim();
  start();
};
if (!key) {
  try {
    const r = await fetch("/api/local-session", { method: "POST" });
    if (r.ok) key = (await r.json()).token;
  } catch {}
}
start();
