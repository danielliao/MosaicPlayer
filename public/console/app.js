const $ = (s, root = document) => root.querySelector(s);
const app = $("#app");
const state = {
  session: null,
  page: "overview",
  data: {},
  filter: "all",
  search: "",
  loading: false,
};
const roles = {
  platform_admin: "平台管理员",
  tenant_admin: "租户管理员",
  operator: "运营员",
  store_operator: "门店操作员",
  viewer: "只读账号",
};
const labels = {
  active: "正常服务",
  suspended: "已暂停",
  online: "在线",
  offline: "离线",
  queued: "排队中",
  pending: "待处理",
  preparing: "预下载",
  downloading: "下载中",
  ready: "已准备",
  scheduled: "等待生效",
  waiting: "等待生效",
  committed: "已提交",
  applied: "已生效",
  active_program: "已生效",
  partial: "部分完成",
  failed: "失败",
  cancelled: "已取消",
  canceled: "已取消",
  completed: "完成",
  success: "成功",
  sent: "已下发",
  acknowledged: "已接收",
  pending_confirmation: "待遥控器确认",
  awaiting_confirmation: "待遥控器确认",
  available: "可升级",
  accepted: "已接收",
  installing: "安装中",
  unsupported: "不支持",
  expired: "已过期",
};
const navigation = [
  ["overview", "◫", "工作总览"],
  ["stores", "▦", "门店与播放组"],
  ["devices", "▣", "设备中心"],
  ["media", "◈", "素材库"],
  ["templates", "▤", "节目模板"],
  ["deployments", "↗", "发布管理"],
  ["updates", "⇧", "客户端升级"],
  ["users", "♙", "用户与权限"],
  ["audit", "≡", "操作审计"],
];
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on"))
      n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (
      k === "checked" ||
      k === "disabled" ||
      k === "selected" ||
      k === "required" ||
      k === "hidden"
    )
      n[k] = Boolean(v);
    else n.setAttribute(k, v);
  }
  for (const child of children.flat(Infinity))
    if (child !== null && child !== undefined && child !== false)
      n.append(
        child instanceof Node ? child : document.createTextNode(String(child)),
      );
  return n;
}
function button(text, fn, cls = "", attrs = {}) {
  return el(
    "button",
    { type: "button", class: cls, onClick: fn, ...attrs },
    text,
  );
}
function icon() {
  return el(
    "span",
    { class: "brand-mark", "aria-hidden": "true" },
    [1, 2, 3, 4].map(() => el("i")),
  );
}
function brand() {
  return el("div", { class: "brand" }, icon(), "Mosaic");
}
function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleString("zh-CN", { hour12: false });
}
function bytes(v) {
  const n = Number(v) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
function array(v) {
  if (Array.isArray(v)) return v;
  for (const key of [
    "items",
    "data",
    "entries",
    "tenants",
    "stores",
    "groups",
    "devices",
    "media",
    "templates",
    "versions",
    "deployments",
    "users",
    "releases",
    "updates",
    "events",
    "screenshots",
  ])
    if (Array.isArray(v?.[key])) return v[key];
  return [];
}
function nameOf(kind, id) {
  return (
    state.data[kind]?.find((x) => x.id === id)?.name ||
    (id ? String(id).slice(0, 8) : "未分配")
  );
}
function status(v) {
  const s = String(v || "pending");
  const cls =
    /^(active|online|ready|applied|success|completed|committed)$/.test(s)
      ? "green"
      : /(fail|offline|suspended|expired)/.test(s)
        ? "red"
        : /(preparing|download|queued|pending|waiting|scheduled)/.test(s)
          ? "orange"
          : "blue";
  return el(
    "span",
    { class: `badge ${cls}` },
    el("span", { class: "dot" }),
    labels[s] || s,
  );
}
function meta(...parts) {
  return el(
    "div",
    { class: "meta" },
    parts.filter(Boolean).map((p) => el("div", {}, p)),
  );
}
function empty(
  text = "暂无记录",
  hint = "添加第一条记录，开始管理您的播放网络。",
) {
  return el(
    "div",
    { class: "empty" },
    el("div", { class: "empty-symbol" }, "◫"),
    el("strong", {}, text),
    el("div", {}, hint),
  );
}
function toast(message, error = false) {
  const n = el(
    "div",
    { class: `toast ${error ? "error-toast" : ""}` },
    message,
  );
  $("#toasts").append(n);
  setTimeout(() => n.remove(), 5000);
}
async function api(path, options = {}) {
  const headers = { ...options.headers };
  if (options.method && !["GET", "HEAD"].includes(options.method)) {
    if (state.session?.csrf) headers["X-CSRF-Token"] = state.session.csrf;
    if (options.body && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(options.body);
    }
  }
  const r = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers,
  });
  let data;
  try {
    data = await r.json();
  } catch {
    data = {};
  }
  if (!r.ok) {
    if (r.status === 401 && path !== "/api/login" && path !== "/api/session") {
      state.session = null;
      renderLogin();
    }
    throw new Error(data.error || `请求失败 (${r.status})`);
  }
  return data;
}
const get = (p) => api(p),
  post = (p, body = {}) => api(p, { method: "POST", body }),
  put = (p, body) => api(p, { method: "PUT", body }),
  del = (p) => api(p, { method: "DELETE" });
const platform = () =>
  state.session?.user?.role === "platform_admin" &&
  !state.session?.tenant &&
  !state.session?.user?.tenantId;
const role = () => state.session?.user?.role;
const admin = () => role() === "tenant_admin" || role() === "platform_admin";
const operate = () => admin() || role() === "operator";
const storeOperate = () => operate() || role() === "store_operator";
function heading(title, description, actions = []) {
  return el(
    "div",
    { class: "page-heading" },
    el(
      "div",
      {},
      el("h1", {}, title),
      el("div", { class: "subtitle" }, description),
    ),
    el("div", { class: "actions" }, actions),
  );
}
function field(label, control, hint) {
  const id = `f-${crypto.randomUUID()}`;
  control.id = id;
  return el(
    "div",
    { class: "field" },
    el("label", { for: id }, label),
    control,
    hint ? el("small", {}, hint) : null,
  );
}
function input(value = "", type = "text", attrs = {}) {
  return el("input", { type, value: value ?? "", ...attrs });
}
function select(options, value = "", attrs = {}) {
  return el(
    "select",
    attrs,
    options.map((o) => {
      const [v, t] = Array.isArray(o) ? o : [o.id, o.name];
      return el(
        "option",
        { value: v, selected: String(v) === String(value) },
        t,
      );
    }),
  );
}
function row(...items) {
  return el("div", { class: "form-grid" }, items);
}
function check(text, checked = false) {
  const control = input("", "checkbox", { checked });
  return { control, node: el("label", { class: "check-row" }, control, text) };
}
function details(value) {
  return el("pre", { class: "details" }, JSON.stringify(value, null, 2));
}
function dialog(title, { wide = false, save = "保存", onSave } = {}) {
  const previousFocus = document.activeElement;
  const body = el("div", { class: "dialog-body" }),
    error = el("div", { class: "error", hidden: true }),
    footer = el("div", { class: "dialog-footer" }),
    close = () => {
      backdrop.remove();
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = document.querySelector(".dialog-backdrop")
        ? "hidden"
        : "";
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  const saveButton = onSave
    ? button(
        save,
        async () => {
          error.hidden = true;
          saveButton.disabled = true;
          try {
            await onSave();
            close();
          } catch (e) {
            error.textContent = e.message;
            error.hidden = false;
            body.scrollTo({ top: 0, behavior: "smooth" });
          } finally {
            saveButton.disabled = false;
          }
        },
        "primary",
      )
    : null;
  footer.append(button("关闭", close), ...(saveButton ? [saveButton] : []));
  const panel = el(
    "section",
    {
      class: `dialog ${wide ? "wide" : ""}`,
      role: "dialog",
      "aria-modal": "true",
      "aria-label": title,
    },
    el(
      "div",
      { class: "dialog-header" },
      el("h2", {}, title),
      button("×", close, "ghost small", { "aria-label": "关闭" }),
    ),
    body,
    footer,
  );
  const backdrop = el("div", { class: "dialog-backdrop" }, panel);
  body.append(error);
  document.body.append(backdrop);
  document.body.style.overflow = "hidden";
  const onKey = (e) => {
    if (document.querySelector(".dialog-backdrop:last-of-type") !== backdrop)
      return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
    if (e.key === "Tab") {
      const controls = [
        ...panel.querySelectorAll(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
        ),
      ].filter((n) => n.getClientRects().length);
      const first = controls[0],
        last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };
  document.addEventListener("keydown", onKey);
  setTimeout(() => body.querySelector("input,select,button")?.focus(), 30);
  return { body, close, footer, saveButton };
}
function confirmAction(title, text, fn) {
  const d = dialog(title, {
    save: "确认",
    onSave: async () => {
      await fn();
      await refresh();
      toast("操作已完成");
    },
  });
  d.body.append(el("p", { class: "meta" }, text));
}
function submitForm(form, fn) {
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    fn();
  });
}
function renderLogin(message = "") {
  app.replaceChildren(
    el(
      "main",
      { class: "login" },
      el(
        "section",
        { class: "login-aside" },
        brand(),
        el(
          "div",
          {},
          el("h1", {}, "每一块屏幕，\n都在同一时刻。"),
          el(
            "p",
            {},
            "从一个门店，到整个品牌网络。\n统一编排内容、管理设备，让每一次播放如期呈现。",
          ),
        ),
        el(
          "div",
          { class: "subtitle" },
          "MOSAIC · COMMERCIAL DISPLAY PLATFORM",
        ),
      ),
      el("section", { class: "login-form" }, loginForm(message)),
    ),
  );
}
function loginForm(message) {
  const f = el("form"),
    username = input("", "text", {
      required: true,
      autocomplete: "username",
      placeholder: "输入账号",
    }),
    password = input("", "password", {
      required: true,
      autocomplete: "current-password",
      placeholder: "输入密码",
    }),
    err = el("div", { class: "error", hidden: !message }, message),
    submit = el("button", { type: "submit", class: "primary" }, "登录管理台");
  f.append(
    el("h2", {}, "欢迎回来"),
    el("p", { class: "subtitle" }, "使用您的管理账号，连接播放网络。"),
    el("div", { style: "height:15px" }),
    err,
    field("账号", username),
    field("密码", password),
    submit,
    el(
      "p",
      { class: "subtitle", style: "margin-top:24px" },
      "忘记密码请联系租户管理员；管理员可在用户与权限中重置。",
    ),
  );
  submitForm(f, async () => {
    submit.disabled = true;
    err.hidden = true;
    try {
      state.session = await post("/api/login", {
        username: username.value,
        password: password.value,
      });
      state.page = platform() ? "tenants" : "overview";
      await refresh();
      if (state.session.user.mustChangePassword) passwordDialog(true);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    } finally {
      submit.disabled = false;
    }
  });
  return f;
}
function passwordDialog(required = false) {
  const current = input("", "password", { autocomplete: "current-password" }),
    next = input("", "password", {
      autocomplete: "new-password",
      minlength: 12,
    }),
    repeat = input("", "password", { autocomplete: "new-password" });
  const d = dialog(required ? "首次登录 · 修改密码" : "修改登录密码", {
    save: "更新密码",
    onSave: async () => {
      if (!current.value || next.value.length < 12)
        throw new Error("请输入原密码，并设置至少 12 位的新密码");
      if (next.value !== repeat.value) throw new Error("两次新密码不一致");
      await post("/api/password", {
        currentPassword: current.value,
        newPassword: next.value,
      });
      state.session = await get("/api/session");
      toast("密码已更新");
      await refresh();
    },
  });
  d.body.append(
    el(
      "div",
      { class: "help" },
      required ? "请先设置个人密码，再继续管理。" : "更新后请使用新密码登录。",
    ),
    field("当前密码", current),
    field("新密码", next, "至少 12 位"),
    field("再次输入新密码", repeat),
  );
}
function renderShell() {
  const nav = platform()
    ? [
        ["tenants", "▦", "租户与服务"],
        ["releases", "⇧", "APK 版本库"],
        ["audit", "≡", "平台审计"],
      ]
    : navigation.filter((n) => n[0] !== "users" || admin());
  const sidebar = el(
    "aside",
    { class: "sidebar" },
    brand(),
    el(
      "div",
      { class: "workspace-label" },
      platform() ? "PLATFORM WORKSPACE" : "TENANT WORKSPACE",
    ),
    el(
      "nav",
      { class: "nav", "aria-label": "主导航" },
      nav.map(([id, symbol, title]) =>
        button(
          el(
            "span",
            {},
            el("span", { class: "nav-symbol", "aria-hidden": "true" }, symbol),
            title,
          ),
          () => navigate(id),
          state.page === id ? "active" : "",
        ),
      ),
    ),
    el(
      "div",
      { class: "sidebar-foot" },
      "统一内容 · 精准呈现",
      el("br"),
      "Mosaic 商业管理平台 v2",
    ),
  );
  const topbar = el(
    "header",
    { class: "topbar" },
    button("☰", () => sidebar.classList.toggle("open"), "mobile-menu ghost", {
      "aria-label": "打开导航",
    }),
    el(
      "div",
      { class: "topbar-title" },
      platform()
        ? "平台运营控制台"
        : state.session.tenant?.name || "门店播放工作区",
    ),
    el(
      "div",
      { class: "user-menu" },
      el(
        "span",
        { class: "avatar" },
        state.session.user.name?.slice(0, 1) || "M",
      ),
      el(
        "span",
        { class: "user-name" },
        state.session.user.name || state.session.user.username,
      ),
      button("修改密码", () => passwordDialog(), "ghost small"),
      button(
        "退出",
        async () => {
          try {
            await post("/api/logout");
            state.session = null;
            state.data = {};
            renderLogin();
          } catch (e) {
            toast(e.message, true);
          }
        },
        "ghost small",
      ),
    ),
  );
  const main = el("main", { class: "main" }, topbar);
  if (
    !platform() &&
    (state.session.user.support || role() === "platform_admin")
  )
    main.append(
      el(
        "div",
        { class: "support-banner" },
        el(
          "span",
          {},
          `支持会话 · ${state.session.tenant?.name || "客户租户"} · 操作将记录审计`,
        ),
        button(
          "返回平台",
          async () => {
            try {
              await del("/api/platform/support");
              state.session = await get("/api/session");
              state.page = "tenants";
              await refresh();
            } catch (e) {
              toast(e.message, true);
            }
          },
          "small",
        ),
      ),
    );
  const tenant = state.session.tenant;
  if (
    tenant &&
    (tenant.status === "suspended" ||
      (tenant.expiresAt && new Date(tenant.expiresAt) < new Date()))
  )
    main.append(
      el(
        "div",
        { class: "service-banner" },
        "在线服务已暂停或到期，请联系平台续期。已缓存的节目可继续在设备播放。",
      ),
    );
  main.append(el("div", { class: "page", id: "page" }));
  app.replaceChildren(sidebar, main);
  return $("#page");
}
async function navigate(page) {
  state.page = page;
  state.search = "";
  state.filter = "all";
  await refresh();
}
async function fetchData(key, path) {
  state.data[key] = array(await get(path));
  return state.data[key];
}
async function refresh() {
  if (!state.session) return;
  const page = renderShell();
  page.append(el("div", { class: "muted" }, "正在读取最新数据…"));
  try {
    if (platform()) {
      if (state.page === "tenants")
        await fetchData("tenants", "/api/platform/tenants");
      if (state.page === "releases")
        await fetchData("releases", "/api/releases");
      if (state.page === "audit")
        await fetchData("audit", "/api/audit?limit=100");
    } else {
      const paths = {
        overview: [
          "overview",
          "stores",
          "groups",
          "devices",
          "deployments",
          "versions",
        ],
        stores: ["stores", "groups", "devices", "versions"],
        devices: ["devices", "stores", "groups"],
        media: ["media"],
        templates: ["templates", "media", "versions"],
        deployments: ["deployments", "versions", "stores", "groups"],
        updates: ["updates", "releases", "devices", "stores", "groups"],
        users: ["users", "stores"],
        audit: ["audit"],
      };
      const results = await Promise.allSettled(
        (paths[state.page] || []).map(async (key) => {
          if (key === "overview")
            state.data.overview = await get("/api/overview");
          else
            await fetchData(
              key,
              `/api/${key}${key === "audit" ? "?limit=100" : ""}`,
            );
        }),
      );
      const errors = results.filter((r) => r.status === "rejected");
      if (errors.length) throw errors[0].reason;
    }
    page.replaceChildren();
    const renderers = {
      overview: renderOverview,
      tenants: renderTenants,
      stores: renderStores,
      devices: renderDevices,
      media: renderMedia,
      templates: renderTemplates,
      deployments: renderDeployments,
      releases: renderReleases,
      updates: renderUpdates,
      users: renderUsers,
      audit: renderAudit,
    };
    (renderers[state.page] || renderOverview)(page);
  } catch (e) {
    page.replaceChildren(
      heading("暂时无法读取数据", "请检查账号权限及服务连接"),
      el("div", { class: "error" }, e.message),
      button("重新加载", refresh, "primary"),
    );
  }
}
function stats(items) {
  return el(
    "div",
    { class: "stats" },
    items.map(([label, value, note, symbol]) =>
      el(
        "section",
        { class: "stat" },
        el(
          "div",
          { class: "stat-label" },
          label,
          el("span", { class: "stat-icon" }, symbol || "◫"),
        ),
        el("div", { class: "stat-value" }, value ?? "—"),
        el("div", { class: "stat-note" }, note || "实时服务数据"),
      ),
    ),
  );
}
function renderOverview(page) {
  const d = state.data,
    o = d.overview || {},
    devices = d.devices || [],
    online = devices.filter((x) => x.online).length;
  page.append(
    heading("工作总览", "掌握门店播放网络的每一个变化。", [
      button("刷新数据", refresh),
      ...(storeOperate()
        ? [button("发布节目", () => navigate("deployments"), "primary")]
        : []),
    ]),
    stats([
      ["管理门店", d.stores.length, "已授权门店", "▦"],
      [
        "在线设备",
        `${online} / ${devices.length}`,
        "设备状态以最后心跳为准",
        "▣",
      ],
      [
        "素材总数",
        o.counters?.media ?? o.counts?.media ?? "—",
        "视频、图片与音乐",
        "▤",
      ],
      [
        "待处理发布",
        d.deployments.filter(
          (x) =>
            ![
              "applied",
              "active",
              "committed",
              "completed",
              "failed",
              "cancelled",
            ].includes(x.status),
        ).length,
        "查看组与设备回执",
        "↗",
      ],
    ]),
  );
  const latest = el(
    "section",
    { class: "card" },
    el(
      "div",
      { class: "card-head" },
      el("h2", {}, "最近发布"),
      button("全部记录 →", () => navigate("deployments"), "ghost small"),
    ),
  );
  latest.append(
    d.deployments.length
      ? el(
          "div",
          { class: "list" },
          d.deployments.slice(0, 5).map(deploymentRow),
        )
      : empty("还没有发布记录", "创建模板并发布一个明确版本后，在此查看进展。"),
  );
  const quota = el("section", { class: "card" }, el("h2", {}, "服务与用量"));
  const t = state.session.tenant || {},
    usage = o.usage || {},
    limits = o.limits || t.limits || {};
  quota.append(
    meta(
      `服务期限：${fmtDate(t.expiresAt)}`,
      `服务状态：${labels[t.status] || t.status || "以平台配置为准"}`,
    ),
  );
  for (const [key, label, value] of [
    ["stores", "门店", d.stores.length],
    ["devices", "设备", devices.length],
    ["users", "账号", usage.users],
    ["storageBytes", "素材存储", usage.storageBytes ?? usage.storage],
  ]) {
    const v = usage[key] ?? value;
    quota.append(
      el(
        "div",
        { style: "margin-top:17px" },
        el(
          "div",
          { class: "card-head", style: "margin-bottom:5px;font-size:12px" },
          label,
          `${key === "storageBytes" ? bytes(v) : (v ?? "—")} / ${key === "storageBytes" ? bytes(limits[key]) : (limits[key] ?? "—")}`,
        ),
        el(
          "div",
          { class: "progress" },
          el("span", {
            style: `width:${Math.min(100, limits[key] ? (100 * (v || 0)) / limits[key] : 0)}%`,
          }),
        ),
      ),
    );
  }
  page.append(el("div", { class: "split" }, latest, quota));
  page.append(
    el(
      "section",
      { class: "card section" },
      el("h2", {}, "安装播放端"),
      el(
        "p",
        { class: "meta" },
        "首次安装或旧版升级后，使用门店配对码选择屏幕。Android 在线更新仍需在电视上确认安装。",
      ),
      el(
        "div",
        { class: "actions" },
        el(
          "a",
          {
            class: "button",
            href: "/downloads/mosaic-player.apk",
            download: "MosaicPlayer-AndroidTV.apk",
          },
          "下载 Android TV APK",
        ),
        el(
          "a",
          {
            class: "button",
            href: "/downloads/mosaic-player-macos.zip",
            download: "MosaicPlayer-macOS.zip",
          },
          "下载 macOS 播放端",
        ),
      ),
    ),
  );
  const offline = devices.filter((x) => !x.online);
  if (offline.length)
    page.append(
      el(
        "div",
        { class: "section", style: "margin-top:24px" },
        el("h2", { class: "panel-title" }, "需要关注"),
        el(
          "div",
          { class: "help" },
          `${offline.length} 台设备当前离线。离线设备不会被当作发布成功；恢复连接后请检查实际版本和追赶状态。`,
        ),
      ),
    );
}
function renderTenants(page) {
  const tenants = state.data.tenants;
  page.append(
    heading("租户与服务", "为每一个品牌配置独立空间、服务期限和使用额度。", [
      button("刷新", refresh),
      button("+ 开通租户", () => tenantDialog(), "primary"),
    ]),
    stats([
      ["全部租户", tenants.length, "独立业务空间", "▦"],
      [
        "服务正常",
        tenants.filter((t) => t.status === "active").length,
        "以服务期限同时判断",
        "◉",
      ],
      [
        "已暂停",
        tenants.filter((t) => t.status === "suspended").length,
        "保留现有数据",
        "◷",
      ],
      [
        "即将到期",
        tenants.filter(
          (t) =>
            new Date(t.expiresAt) > new Date() &&
            new Date(t.expiresAt) - Date.now() < 30 * 86400000,
        ).length,
        "未来 30 天内",
        "◴",
      ],
    ]),
  );
  const search = input("", "search", {
      placeholder: "搜索租户名称",
      "aria-label": "搜索租户",
    }),
    list = el("div", { class: "grid" });
  const render = () => {
    list.replaceChildren(
      ...tenants
        .filter((x) =>
          String(x.name).toLowerCase().includes(search.value.toLowerCase()),
        )
        .map((t) =>
          el(
            "article",
            { class: "card" },
            el(
              "div",
              { class: "card-head" },
              el("h3", {}, t.name),
              status(t.status),
            ),
            meta(
              `截止 ${fmtDate(t.expiresAt)}`,
              `门店 ${t.limits?.stores ?? "—"} · 设备 ${t.limits?.devices ?? "—"} · 账号 ${t.limits?.users ?? "—"}`,
              `存储额度 ${bytes(t.limits?.storageBytes)}`,
            ),
            el(
              "div",
              { class: "card-footer" },
              button("服务与额度", () => tenantDialog(t), "small"),
              button("进入支持会话", () => supportDialog(t), "small"),
            ),
          ),
        ),
    );
    if (!list.children.length) list.append(empty("暂无匹配租户"));
  };
  search.addEventListener("input", render);
  page.append(el("div", { class: "toolbar" }, search), list);
  render();
}
function tenantDialog(tenant = {}) {
  const name = input(tenant.name || ""),
    service = select(
      [
        ["active", "正常服务"],
        ["suspended", "暂停服务"],
      ],
      tenant.status || "active",
    ),
    expiry = input(
      tenant.expiresAt
        ? new Date(tenant.expiresAt).toISOString().slice(0, 10)
        : new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
      "date",
    ),
    stores = input(tenant.limits?.stores ?? 10, "number", { min: 0 }),
    devices = input(tenant.limits?.devices ?? 50, "number", { min: 0 }),
    users = input(tenant.limits?.users ?? 10, "number", { min: 1 }),
    storage = input(
      (tenant.limits?.storageBytes ?? 10737418240) / 1073741824,
      "number",
      { min: 0, step: 0.1 },
    ),
    username = input("", "text", { autocomplete: "off" }),
    password = input("", "password", { autocomplete: "new-password" });
  const d = dialog(tenant.id ? "编辑租户服务" : "开通租户", {
    save: tenant.id ? "保存配置" : "开通租户",
    onSave: async () => {
      if (!name.value.trim() || !expiry.value)
        throw new Error("请填写名称和服务期限");
      const body = {
        name: name.value.trim(),
        status: service.value,
        expiresAt: new Date(`${expiry.value}T23:59:59+08:00`).toISOString(),
        limits: {
          stores: Number(stores.value),
          devices: Number(devices.value),
          users: Number(users.value),
          storageBytes: Math.round(Number(storage.value) * 1073741824),
        },
      };
      if (!tenant.id) {
        if (!username.value || password.value.length < 12)
          throw new Error("请设置管理员账号和至少 12 位密码");
        body.adminUsername = username.value;
        body.adminPassword = password.value;
      }
      await (tenant.id
        ? put(`/api/platform/tenants/${encodeURIComponent(tenant.id)}`, body)
        : post("/api/platform/tenants", body));
      toast("租户配置已保存");
      await refresh();
    },
  });
  d.body.append(
    field("租户名称", name),
    row(field("服务状态", service), field("服务截止日期（北京时间）", expiry)),
    el("h3", { class: "panel-title" }, "套餐额度"),
    row(field("门店数", stores), field("设备数", devices)),
    row(field("账号数", users), field("存储空间（GiB）", storage)),
    el(
      "div",
      { class: "help" },
      "调低额度不会删除数据；超过额度后将阻止继续新增。",
    ),
  );
  if (!tenant.id)
    d.body.append(
      el("h3", { class: "panel-title" }, "首位租户管理员"),
      field("管理员账号", username),
      field("初始密码", password, "至少 12 位；首次登录应修改。"),
    );
}
function supportDialog(tenant) {
  const reason = el("textarea", { placeholder: "填写本次客户支持的具体原因" });
  const d = dialog("进入客户支持会话", {
    save: "进入支持会话",
    onSave: async () => {
      if (!reason.value.trim()) throw new Error("请填写支持原因");
      await post("/api/platform/support", {
        tenantId: tenant.id,
        reason: reason.value.trim(),
      });
      state.session = await get("/api/session");
      state.page = "overview";
      await refresh();
    },
  });
  d.body.append(
    el(
      "div",
      { class: "help" },
      `即将进入「${tenant.name}」工作区。会话起止、原因和操作均记录平台审计。`,
    ),
    field("支持原因", reason),
  );
}
function renderStores(page) {
  const { stores, groups, devices } = state.data;
  page.append(
    heading("门店与播放组", "按门店时区编排内容，按播放组统一控制屏幕。", [
      button("刷新", refresh),
      ...(admin()
        ? [button("+ 添加门店", () => storeDialog(), "primary")]
        : []),
    ]),
  );
  if (!stores.length) {
    page.append(
      empty("尚未添加门店", "创建门店后即可设置播放组、布局和设备配对。"),
    );
    return;
  }
  for (const store of stores) {
    const owned = groups.filter((g) => g.storeId === store.id),
      section = el(
        "section",
        { class: "section" },
        el(
          "div",
          { class: "card-head" },
          el(
            "div",
            {},
            el(
              "h2",
              { class: "panel-title", style: "margin-bottom:5px" },
              store.name,
            ),
            meta(
              `${store.timezone || "Asia/Shanghai"} · ${owned.length} 个播放组 · ${devices.filter((x) => x.storeId === store.id).length} 台设备`,
              `门店默认版本：${store.templateVersionId ? nameOf("versions", store.templateVersionId) : "未指定"}`,
            ),
          ),
          el(
            "div",
            { class: "actions" },
            ...(admin()
              ? [button("编辑门店", () => storeDialog(store), "small")]
              : []),
            ...(storeOperate()
              ? [
                  button(
                    "+ 播放组",
                    () => groupDialog({ storeId: store.id }),
                    "small primary",
                  ),
                  button("生成配对码", () => pairingDialog(store.id), "small"),
                ]
              : []),
          ),
        ),
      );
    const grid = el("div", { class: "grid" });
    for (const group of owned) {
      const bound = devices.filter((x) => x.groupId === group.id),
        layout = group.layout || {};
      grid.append(
        el(
          "article",
          { class: "card" },
          el(
            "div",
            { class: "card-head" },
            el("h3", {}, group.name),
            el(
              "span",
              { class: "badge blue" },
              `${layout.cols || 1} × ${layout.rows || 1}`,
            ),
          ),
          layoutPreview(layout),
          meta(
            `在线 ${bound.filter((x) => x.online).length} / 已绑定 ${bound.length}`,
            `${group.inheritsStoreTemplate !== false ? "继承门店默认" : "播放组单独覆盖"}：${group.templateVersionId ? nameOf("versions", group.templateVersionId) : "未指定版本"}`,
            group.program?.versionId
              ? `当前生效版本：${nameOf("versions", group.program.versionId)}`
              : null,
            `发声屏幕：${layoutScreens(group).find((x) => x.id === group.audioScreenId)?.name || (group.audioScreenId ? "已指定" : "全部静音")}`,
          ),
          el(
            "div",
            { class: "card-footer" },
            ...(storeOperate()
              ? [
                  button("布局与声音", () => groupDialog(group), "small"),
                  button(
                    "配对设备",
                    () => pairingDialog(store.id, group.id),
                    "small",
                  ),
                  button("手动播放", () => manualDialog(group), "small"),
                ]
              : []),
            button(
              "设备状态",
              () => {
                state.page = "devices";
                refresh();
              },
              "small",
            ),
          ),
        ),
      );
    }
    section.append(
      owned.length
        ? grid
        : empty("该门店还没有播放组", "添加播放组并选择屏幕布局。"),
    );
    page.append(section);
  }
}
function layoutScreens(group) {
  return array(group.layout?.screens || group.screens);
}
function layoutPreview(layout) {
  const cols = Math.max(1, Math.min(16, Number(layout.cols) || 1)),
    rows = Math.max(1, Math.min(16, Number(layout.rows) || 1)),
    screens = Array.isArray(layout.screens) ? layout.screens : [];
  return el(
    "div",
    {
      class: "layout-preview",
      style: `grid-template-columns:repeat(${cols},minmax(0,1fr))`,
    },
    Array.from({ length: Math.min(16, cols * rows) }, (_, i) =>
      el("div", { class: "screen-tile" }, screens[i]?.name || `${i + 1} 号屏`),
    ),
  );
}
function storeDialog(store = {}) {
  const name = input(store.name || ""),
    timezone = input(store.timezone || "Asia/Shanghai"),
    version = select(
      [
        ["", "不指定默认版本"],
        ...(state.data.versions || []).map((x) => [
          x.id,
          `${x.name || x.id} · ${fmtDate(x.createdAt)}`,
        ]),
      ],
      store.templateVersionId || "",
    );
  const d = dialog(store.id ? "编辑门店" : "添加门店", {
    onSave: async () => {
      if (!name.value.trim() || !timezone.value.trim())
        throw new Error("请输入门店名称和 IANA 时区");
      try {
        new Intl.DateTimeFormat("zh", { timeZone: timezone.value });
      } catch {
        throw new Error("时区无效，例如 Asia/Shanghai");
      }
      const saved = await (store.id
        ? put(`/api/stores/${store.id}`, {
            name: name.value.trim(),
            timezone: timezone.value,
            templateVersionId: version.value || null,
          })
        : post("/api/stores", {
            name: name.value.trim(),
            timezone: timezone.value,
            templateVersionId: version.value || null,
          }));
      await refresh();
      toast("门店配置已保存");
      showAssignmentResults(saved.assignmentResults, "门店默认版本分配结果");
    },
  });
  d.body.append(
    field("门店名称", name),
    field(
      "时区",
      timezone,
      "填写 IANA 时区，例如 Asia/Shanghai、America/New_York",
    ),
    field(
      "门店默认模板版本",
      version,
      "保存新默认版本会为继承该门店的播放组创建发布任务；单独覆盖的组保持其指定版本。清空默认不会停止当前节目。",
    ),
  );
  if (store.id)
    d.body.append(
      el(
        "div",
        { class: "danger-zone" },
        button(
          "删除门店",
          () =>
            confirmAction(
              "删除门店",
              `确认删除「${store.name}」？有关联资源时服务端会拒绝删除。`,
              async () => {
                await del(`/api/stores/${store.id}`);
                d.close();
              },
            ),
          "danger",
        ),
      ),
    );
}
function groupDialog(group = {}) {
  const layout = group.layout || {},
    name = input(group.name || ""),
    store = select(
      state.data.stores,
      group.storeId || state.data.stores[0]?.id,
    ),
    cols = input(layout.cols || 2, "number", { min: 1, max: 8 }),
    rows = input(layout.rows || 1, "number", { min: 1, max: 8 }),
    tw = input(layout.tileWidth || 1920, "number", { min: 320, max: 7680 }),
    th = input(layout.tileHeight || 1080, "number", { min: 240, max: 4320 }),
    gx = input(layout.gapX || 0, "number", { min: 0, max: 500 }),
    gy = input(layout.gapY || 0, "number", { min: 0, max: 500 }),
    audio = select(
      [
        ["", "全部屏幕静音"],
        ...layoutScreens(group).map((x, i) => [
          x.id,
          x.name || `${i + 1} 号屏`,
        ]),
      ],
      group.audioScreenId || "",
    ),
    assignedVersion = select(
      [
        ["", "继承门店默认版本"],
        ...(state.data.versions || []).map((v) => [
          v.id,
          `${v.name || v.id} · ${fmtDate(v.createdAt)}`,
        ]),
      ],
      group.inheritsStoreTemplate === false
        ? group.templateVersionId || ""
        : "",
    ),
    assignmentHint = el("div", { class: "help" }),
    preview = el("div");
  if (group.id) store.disabled = true;
  const describeAssignment = () => {
    const owner = state.data.stores.find((s) => s.id === store.value);
    assignmentHint.textContent = assignedVersion.value
      ? `本组单独指定「${nameOf("versions", assignedVersion.value)}」；门店默认版本变更不会覆盖本组。保存版本变更后，服务端会创建发布任务。`
      : `本组继承「${owner?.name || "所属门店"}」的默认版本：${owner?.templateVersionId ? nameOf("versions", owner.templateVersionId) : "未指定"}。门店默认版本变更时本组将跟随下发；清空默认不会停止当前节目。`;
  };
  store.addEventListener("change", describeAssignment);
  assignedVersion.addEventListener("change", describeAssignment);
  describeAssignment();
  const draw = () =>
    preview.replaceChildren(
      layoutPreview({ cols: cols.value, rows: rows.value }),
    );
  cols.addEventListener("input", draw);
  rows.addEventListener("input", draw);
  draw();
  const d = dialog(group.id ? "播放组设置" : "添加播放组", {
    onSave: async () => {
      if (!name.value.trim() || !store.value)
        throw new Error("请输入播放组名称并选择门店");
      if (
        Number(cols.value) * Number(rows.value) > 16 ||
        Number(cols.value) < 1 ||
        Number(rows.value) < 1
      )
        throw new Error("每组支持 1–16 块屏幕");
      const body = {
        name: name.value.trim(),
        storeId: store.value,
        layout: {
          cols: Number(cols.value),
          rows: Number(rows.value),
          tileWidth: Number(tw.value),
          tileHeight: Number(th.value),
          gapX: Number(gx.value),
          gapY: Number(gy.value),
          screens: layout.screens || [],
        },
        audioScreenId: audio.value || null,
        templateVersionId: assignedVersion.value || null,
      };
      const saved = await (group.id
        ? put(`/api/groups/${group.id}`, body)
        : post("/api/groups", body));
      await refresh();
      toast("播放组配置已保存");
      showAssignmentResults(saved.assignmentResults, "播放组版本分配结果");
    },
  });
  d.body.append(
    field("播放组名称", name),
    field("所属门店", store),
    field("模板版本分配", assignedVersion),
    assignmentHint,
    row(field("列数", cols), field("行数", rows)),
    preview,
    row(field("单屏宽度 px", tw), field("单屏高度 px", th)),
    row(field("水平间隙 px", gx), field("垂直间隙 px", gy)),
    field(
      "唯一声音输出屏幕",
      audio,
      "新组保存后会创建屏幕位置，再进入本设置指定发声屏幕。",
    ),
  );
  if (group.id)
    d.body.append(
      el(
        "div",
        { class: "danger-zone" },
        button(
          "删除播放组",
          () =>
            confirmAction(
              "删除播放组",
              `确认删除「${group.name}」？请先解除有关设备绑定。`,
              async () => {
                await del(`/api/groups/${group.id}`);
                d.close();
              },
            ),
          "danger",
        ),
      ),
    );
}
function pairingDialog(storeId, groupId) {
  const store = select(state.data.stores, storeId),
    group = select(
      [
        ["", "允许选择本门店播放组"],
        ...state.data.groups
          .filter((x) => x.storeId === store.value)
          .map((x) => [x.id, x.name]),
      ],
      groupId || "",
    ),
    result = el("div");
  store.addEventListener("change", () =>
    group.replaceChildren(
      ...[
        ["", "允许选择本门店播放组"],
        ...state.data.groups
          .filter((x) => x.storeId === store.value)
          .map((x) => [x.id, x.name]),
      ].map(([v, t]) => el("option", { value: v }, t)),
    ),
  );
  const d = dialog("设备一次性配对码");
  const generate = button(
    "生成配对码",
    async () => {
      generate.disabled = true;
      try {
        const data = await post("/api/pairing", {
          storeId: store.value,
          ...(group.value ? { groupId: group.value } : {}),
        });
        result.replaceChildren(
          el("div", { class: "code" }, data.code),
          el(
            "p",
            { class: "meta" },
            `有效期至 ${fmtDate(data.expiresAt)}。在电视客户端输入此码，选择屏幕位置；成功绑定后配对码失效。`,
          ),
        );
      } catch (e) {
        toast(e.message, true);
      } finally {
        generate.disabled = false;
      }
    },
    "primary",
  );
  d.body.append(
    el(
      "div",
      { class: "help" },
      "请在设备旁完成配对。配对码只授权所选门店，不包含长期设备密钥。",
    ),
    field("门店", store),
    field("播放组", group),
    generate,
    el("div", { style: "height:18px" }),
    result,
  );
}
function manualDialog(group) {
  const media = select([
    ["", "选择单个视频或图片"],
    ...(state.data.media || [])
      .filter((x) => x.type !== "audio")
      .map((x) => [x.id, x.name]),
  ]);
  const d = dialog("播放组手动控制");
  const send = async (action) => {
    try {
      await post(`/api/groups/${group.id}/playback`, {
        action,
        ...(action === "play" ? { mediaId: media.value } : {}),
      });
      toast("指令已提交，请检查设备实际状态");
    } catch (e) {
      toast(e.message, true);
    }
  };
  d.body.append(
    el(
      "div",
      { class: "help" },
      "临时手动控制会影响当前播放。节目版本发布请使用发布管理，并查看设备准备与生效回执。",
    ),
    field("单素材播放", media),
    el(
      "div",
      { class: "actions" },
      button(
        "播放",
        () => {
          if (!media.value) {
            toast("请先选择素材", true);
            return;
          }
          send("play");
        },
        "primary",
      ),
      button("暂停", () => send("pause")),
      button("继续", () => send("resume")),
      button("停止", () => send("stop"), "danger"),
    ),
  );
  get("/api/media")
    .then((data) => {
      state.data.media = array(data);
      media.replaceChildren(
        ...[
          ["", "选择单个视频或图片"],
          ...state.data.media
            .filter((x) => x.type !== "audio")
            .map((x) => [x.id, x.name]),
        ].map(([v, t]) => el("option", { value: v }, t)),
      );
    })
    .catch((e) => toast(e.message, true));
}
function renderDevices(page) {
  const devices = state.data.devices;
  page.append(
    heading("设备中心", "查看连接、播放回报和客户端实际采集的画面。", [
      button("刷新状态", refresh),
      ...(storeOperate()
        ? [
            button(
              "配对新设备",
              () => pairingDialog(state.data.stores[0]?.id),
              "primary",
              { disabled: !state.data.stores.length },
            ),
          ]
        : []),
    ]),
  );
  const search = input("", "search", {
      placeholder: "搜索设备、门店或版本",
      "aria-label": "搜索设备",
    }),
    store = select([
      ["", "全部门店"],
      ...state.data.stores.map((x) => [x.id, x.name]),
    ]),
    filter = select([
      ["all", "全部状态"],
      ["online", "在线"],
      ["offline", "离线"],
    ]),
    list = el("div", { class: "grid" });
  const draw = () => {
    const filtered = devices.filter(
      (x) =>
        (!store.value || x.storeId === store.value) &&
        (filter.value === "all" ||
          Boolean(x.online) === (filter.value === "online")) &&
        `${x.name} ${nameOf("stores", x.storeId)} ${x.report?.version || ""}`
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    );
    list.replaceChildren(...filtered.map(deviceCard));
    if (!filtered.length)
      list.append(
        empty("暂无匹配设备", "在目标门店生成配对码，在客户端完成绑定。"),
      );
  };
  [search, store, filter].forEach((x) => x.addEventListener("input", draw));
  page.append(
    stats([
      ["已绑定设备", devices.length, "当前授权范围", "▣"],
      ["在线", devices.filter((x) => x.online).length, "以服务器判断为准", "◉"],
      ["离线", devices.filter((x) => !x.online).length, "保留最后上报", "◷"],
      [
        "支持节目",
        devices.filter((x) =>
          (x.report?.capabilities || x.capabilities || []).includes("programs"),
        ).length,
        "使用 capability 回报",
        "▤",
      ],
    ]),
    el(
      "div",
      { class: "toolbar" },
      search,
      el("div", { class: "actions" }, store, filter),
    ),
    list,
  );
  draw();
}
function deviceCard(device) {
  const r = device.report || {},
    group = state.data.groups.find((x) => x.id === device.groupId),
    screen = layoutScreens(group || {}).find((x) => x.id === device.screenId);
  const card = el(
    "article",
    { class: "card" },
    el(
      "div",
      { class: "card-head" },
      el("h3", {}, device.name || screen?.name || "未命名设备"),
      status(device.online ? "online" : "offline"),
    ),
    meta(
      `${nameOf("stores", device.storeId)} / ${group?.name || "未分组"} / ${screen?.name || String(device.screenId || "").slice(0, 8)}`,
      `${r.client || device.client || "未知客户端"} · ${r.versionName || r.version || "版本未上报"}`,
      `最后心跳 ${fmtDate(device.lastSeen)}`,
      `播放：${r.status || "未上报"} · 偏差 ${Number.isFinite(r.drift ?? r.driftMs) ? Number(r.drift ?? r.driftMs).toFixed(1) : "—"} ms`,
      r.mediaId ? `当前素材 ${nameOf("media", r.mediaId)}` : null,
      r.programId ? `节目 ${String(r.programId).slice(0, 12)}` : null,
    ),
  );
  if (r.error) card.append(el("div", { class: "error" }, r.error));
  card.append(
    el(
      "div",
      { class: "card-footer" },
      button("截屏与详情", () => screenshotDialog(device), "small"),
      ...(storeOperate()
        ? [button("绑定设置", () => deviceDialog(device), "small")]
        : []),
    ),
  );
  return card;
}
function deviceDialog(device) {
  const name = input(device.name || ""),
    group = select(
      state.data.groups.map((x) => [
        x.id,
        `${nameOf("stores", x.storeId)} / ${x.name}`,
      ]),
      device.groupId,
    ),
    screen = select([], device.screenId);
  const update = () =>
    screen.replaceChildren(
      ...layoutScreens(
        state.data.groups.find((x) => x.id === group.value) || {},
      ).map((x, i) =>
        el(
          "option",
          { value: x.id, selected: x.id === device.screenId },
          x.name || `${i + 1} 号屏`,
        ),
      ),
    );
  group.addEventListener("change", update);
  update();
  const d = dialog("设备绑定设置", {
    onSave: async () => {
      if (!name.value.trim() || !group.value || !screen.value)
        throw new Error("请填写名称并选择播放组和屏幕");
      await put(`/api/devices/${device.id}`, {
        name: name.value.trim(),
        groupId: group.value,
        screenId: screen.value,
      });
      await refresh();
      toast("设备绑定已更新；原绑定凭据将失效");
    },
  });
  d.body.append(
    field("设备名称", name),
    field("播放组", group),
    field("屏幕位置", screen),
    el(
      "div",
      { class: "help" },
      "重新分配会撤销旧绑定。跨租户迁移请先退绑，再使用目标租户的新配对码登记。",
    ),
    el(
      "div",
      { class: "danger-zone" },
      button(
        "解除绑定",
        () =>
          confirmAction(
            "解除设备绑定",
            `确认解除「${device.name}」的绑定？原设备凭据将被撤销。`,
            async () => {
              await del(`/api/devices/${device.id}`);
              d.close();
            },
          ),
        "danger",
      ),
    ),
  );
}
async function screenshotDialog(device) {
  const d = dialog(`${device.name || "设备"} · 实际画面`, { wide: true }),
    content = el("div"),
    request = button(
      "请求新截屏",
      async () => {
        request.disabled = true;
        try {
          const result = await post(`/api/devices/${device.id}/screenshot`);
          toast("已提交截屏请求，等待客户端采集和上传");
          content.prepend(
            el(
              "div",
              { class: "help" },
              `请求状态：${labels[result.status] || result.status || "等待客户端回报"}。请稍后刷新，未上传前不会显示成功截图。`,
            ),
          );
        } catch (e) {
          toast(e.message, true);
        } finally {
          setTimeout(() => (request.disabled = false), 5000);
        }
      },
      "primary",
      { disabled: !device.online || !storeOperate() },
    );
  const load = async () => {
    try {
      const images = array(await get(`/api/devices/${device.id}/screenshots`));
      content.replaceChildren();
      if (!images.length)
        content.append(
          empty("暂无实际截屏", "设备在线且支持截屏后，可提交采集请求。"),
        );
      for (const s of images) {
        const id = s.id;
        content.append(
          el(
            "article",
            { class: "section" },
            el("img", {
              class: "screenshot",
              src: `/api/screenshots/${encodeURIComponent(id)}/image`,
              alt: `${device.name} 实际渲染画面`,
              loading: "lazy",
              onError: (e) => {
                e.target.replaceWith(
                  el("div", { class: "error" }, "截屏已过期或无访问权限"),
                );
              },
            }),
            meta(
              `采集时间 ${fmtDate(s.capturedAt || s.createdAt)}`,
              `来源 ${s.metadata?.method || s.metadata?.client || "客户端实际渲染内容"} · 此画面并非电视面板实拍`,
            ),
          ),
        );
      }
    } catch (e) {
      content.replaceChildren(el("div", { class: "error" }, e.message));
    }
  };
  d.body.append(
    el(
      "div",
      { class: "actions", style: "margin-bottom:18px" },
      request,
      button("刷新截屏", load),
    ),
    content,
    el(
      "h3",
      { class: "panel-title", style: "margin-top:22px" },
      "设备上报详情",
    ),
    details(device.report || {}),
  );
  await load();
}
function renderMedia(page) {
  const media = state.data.media;
  page.append(
    heading("素材库", "统一管理视频、图片和音乐，已发布内容保留引用。", [
      button("刷新", refresh),
      ...(operate() ? [button("+ 上传素材", uploadDialog, "primary")] : []),
    ]),
  );
  const search = input("", "search", {
      placeholder: "搜索素材名称",
      "aria-label": "搜索素材",
    }),
    filters = el("div", { class: "filters" }),
    list = el("div", { class: "grid" });
  let type = "all";
  const draw = () => {
    const filtered = media.filter(
      (x) =>
        (type === "all" || x.type === type) &&
        String(x.name || x.originalName || "")
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    );
    list.replaceChildren(
      ...filtered.map((m) => {
        const card = el("article", { class: "card" }),
          preview = el(
            "div",
            { class: "media-preview" },
            m.type === "audio" ? "♫" : m.type === "video" ? "▷" : "◈",
          );
        if (m.type === "image")
          preview.replaceChildren(
            el("img", {
              src: `/media/${encodeURIComponent(m.id)}`,
              alt: m.name || "图片素材",
              loading: "lazy",
            }),
          );
        card.append(
          preview,
          el(
            "div",
            { class: "card-head" },
            el("h3", {}, m.name || m.originalName || m.id),
            el(
              "span",
              { class: "badge blue" },
              { video: "视频", image: "图片", audio: "音乐" }[m.type] || m.type,
            ),
          ),
          meta(
            `${bytes(m.size)}${m.type !== "audio" ? ` · ${m.width || 0} × ${m.height || 0}` : ""}`,
            m.durationMs
              ? `时长 ${(m.durationMs / 1000).toFixed(1)} 秒`
              : m.duration
                ? `时长 ${Number(m.duration).toFixed(1)} 秒`
                : null,
            `上传 ${fmtDate(m.createdAt)}`,
            m.archivedAt || m.archived ? "已归档，保留线上节目引用" : null,
          ),
          el(
            "div",
            { class: "card-footer" },
            button("预览与信息", () => mediaDialog(m), "small"),
            ...(operate()
              ? [
                  button(
                    "删除 / 归档",
                    () =>
                      confirmAction(
                        "删除或归档素材",
                        `确认处理「${m.name}」？已被节目版本引用的素材将归档，保留线上播放依赖。`,
                        () => del(`/api/media/${m.id}`),
                      ),
                    "small danger",
                  ),
                ]
              : []),
          ),
        );
        return card;
      }),
    );
    if (!filtered.length)
      list.append(
        empty("暂无匹配素材", "支持视频、图片和音频；文件会由服务端校验。"),
      );
  };
  for (const [key, text] of [
    ["all", "全部素材"],
    ["video", "视频"],
    ["image", "图片"],
    ["audio", "音乐"],
  ]) {
    const b = button(
      text,
      () => {
        type = key;
        [...filters.children].forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        draw();
      },
      key === "all" ? "active" : "",
    );
    filters.append(b);
  }
  search.addEventListener("input", draw);
  page.append(el("div", { class: "toolbar" }, filters, search), list);
  draw();
}
function uploadDialog() {
  const file = input("", "file", { accept: "video/*,image/*,audio/*" }),
    progress = el("div", { class: "meta" });
  const d = dialog("上传素材", {
    save: "开始上传",
    onSave: async () => {
      if (!file.files[0]) throw new Error("请选择视频、图片或音频文件");
      const data = new FormData();
      data.append("file", file.files[0]);
      progress.textContent = "正在上传并校验，请保持窗口打开…";
      await post("/api/media", data);
      await refresh();
      toast("素材上传并校验完成");
    },
  });
  d.body.append(
    el(
      "div",
      { class: "help" },
      "支持图片、视频和 MP3 / AAC / M4A / WAV 音频。实际格式、时长和租户容量由服务端校验。音频节目需要静态图片背景。",
    ),
    field("选择文件", file),
    progress,
  );
}
function mediaDialog(media) {
  const d = dialog(media.name || "素材详情", { wide: true });
  const url = `/media/${encodeURIComponent(media.id)}`;
  if (media.type === "image")
    d.body.append(
      el("img", {
        class: "screenshot",
        src: url,
        alt: media.name || "图片预览",
      }),
    );
  else
    d.body.append(
      el(media.type === "audio" ? "audio" : "video", {
        src: url,
        controls: true,
        preload: "metadata",
        style: "width:100%;max-height:420px",
      }),
    );
  d.body.append(details(media));
}
function renderTemplates(page) {
  page.append(
    heading("节目模板", "编辑默认节目与时段；发布后生成独立、不可变的版本。", [
      button("刷新", refresh),
      ...(operate()
        ? [button("+ 创建模板", () => templateDialog(), "primary")]
        : []),
    ]),
  );
  const list = el("div", { class: "grid" });
  for (const t of state.data.templates) {
    const versions = state.data.versions.filter((v) => v.templateId === t.id);
    list.append(
      el(
        "article",
        { class: "card" },
        el(
          "div",
          { class: "card-head" },
          el("h3", {}, t.name),
          el("span", { class: "badge blue" }, "草稿"),
        ),
        meta(
          t.description || "暂无模板说明",
          `${t.slots?.length ?? t.body?.slots?.length ?? 0} 个时段 · ${versions.length} 个已发布版本`,
          `更新 ${fmtDate(t.updatedAt || t.createdAt)}`,
        ),
        el(
          "div",
          { class: "card-footer" },
          button(
            operate() ? "编辑草稿" : "查看节目",
            () => templateDialog(t),
            "small",
          ),
          button("版本记录", () => versionDialog(t), "small"),
          ...(operate()
            ? [button("发布版本", () => publishTemplate(t), "small primary")]
            : []),
        ),
      ),
    );
  }
  page.append(
    state.data.templates.length
      ? list
      : empty("还没有节目模板", "先上传素材，再编排默认播放列表与日期时段。"),
  );
}
function durationOf(m) {
  return Math.round(Number(m?.durationMs) || Number(m?.duration || 0) * 1000);
}
function programEditor(initial = {}, title = "节目内容") {
  const container = el("section", { class: "editor-section" }),
    visual = el("div"),
    music = el("div"),
    audio = select(
      [
        ["muted", "全部静音"],
        ["music", "独立背景音乐"],
        ["video", "播放视频原声"],
      ],
      initial.audioMode || "muted",
    ),
    volume = input(Math.round((initial.volume ?? 1) * 100), "number", {
      min: 0,
      max: 100,
      step: 1,
    });
  const rows = { playlist: [], music: [] };
  function addItem(kind, source = {}) {
    const allowed = state.data.media.filter((m) =>
        kind === "music"
          ? m.type === "audio"
          : m.type === "image" || m.type === "video",
      ),
      media = select(
        [
          ["", "选择素材"],
          ...allowed.map((m) => [
            m.id,
            `${m.name || m.id}${m.archivedAt || m.archived ? "（归档）" : ""}`,
          ]),
        ],
        source.mediaId || "",
      ),
      seconds = input((Number(source.durationMs) || 5000) / 1000, "number", {
        min: 1,
        step: 0.1,
        "aria-label": "显示秒数",
      });
    if (source.mediaId && !allowed.some((m) => m.id === source.mediaId))
      media.append(
        el(
          "option",
          { value: source.mediaId, selected: true },
          "素材不可见或已移除",
        ),
      );
    const item = { media, seconds, node: null };
    const update = () => {
      const m = allowed.find((x) => x.id === media.value);
      seconds.disabled = m?.type !== "image";
      if (m?.type !== "image")
        seconds.value =
          durationOf(m) > 0 ? (durationOf(m) / 1000).toFixed(2) : "";
      seconds.title =
        m?.type === "image" ? "图片显示秒数" : "探测完整时长（秒）";
    };
    const tools = el(
      "span",
      { class: "row-tools" },
      button("↑", () => move(-1), "small", { "aria-label": "上移素材" }),
      button("↓", () => move(1), "small", { "aria-label": "下移素材" }),
      button(
        "×",
        () => {
          rows[kind].splice(rows[kind].indexOf(item), 1);
          item.node.remove();
        },
        "small danger",
        { "aria-label": "移除素材" },
      ),
    );
    const move = (direction) => {
      const items = rows[kind],
        index = items.indexOf(item),
        next = index + direction;
      if (next < 0 || next >= items.length) return;
      [items[index], items[next]] = [items[next], items[index]];
      (kind === "music" ? music : visual).replaceChildren(
        ...items.map((x) => x.node),
      );
    };
    item.node = el("div", { class: "program-row" }, media, seconds, tools);
    media.addEventListener("change", update);
    rows[kind].push(item);
    (kind === "music" ? music : visual).append(item.node);
    update();
  }
  container.append(
    el("h3", {}, title),
    el(
      "div",
      { class: "subtitle" },
      "列表按顺序循环；↑ ↓ 调整顺序。图片设置秒数，音视频使用服务端探测的完整时长。",
    ),
    el("div", { class: "playlist-label" }, "画面播放列表"),
    visual,
    button("+ 添加视频 / 图片", () => addItem("playlist"), "small"),
    row(field("声音模式", audio), field("音量 %", volume)),
    el("div", { class: "playlist-label" }, "背景音乐列表"),
    music,
    button("+ 添加音乐", () => addItem("music"), "small"),
    el(
      "p",
      { class: "subtitle" },
      "仅指定发声屏幕输出声音。视频原声与背景音乐互斥；静音模式保留音乐列表但不输出。",
    ),
  );
  (initial.playlist || []).forEach((x) => addItem("playlist", x));
  (initial.music || []).forEach((x) => addItem("music", x));
  const value = () => {
    const collect = (kind) =>
      rows[kind].map((x) => {
        if (!x.media.value)
          throw new Error(`${title}：请选择列表中的每一项素材`);
        const m = state.data.media.find((a) => a.id === x.media.value);
        if (!m) throw new Error(`${title}：有不可用素材，请重新选择`);
        const durationMs =
          m.type === "image"
            ? Math.round(Number(x.seconds.value) * 1000)
            : durationOf(m);
        if (
          !Number.isFinite(durationMs) ||
          (durationMs < 1000 && m.type === "image") ||
          durationMs <= 0
        )
          throw new Error(`${title}：图片时长至少 1 秒，音视频必须有有效时长`);
        return { mediaId: x.media.value, durationMs };
      });
    const playlist = collect("playlist"),
      tracks = collect("music");
    if (!playlist.length)
      throw new Error(`${title}：至少添加一个视频或图片；纯音乐需要静态背景`);
    if (audio.value === "music" && !tracks.length)
      throw new Error(`${title}：背景音乐模式至少添加一个音频`);
    const v = Number(volume.value);
    if (!Number.isFinite(v) || v < 0 || v > 100)
      throw new Error("音量应为 0–100");
    return { playlist, music: tracks, audioMode: audio.value, volume: v / 100 };
  };
  return { node: container, value };
}
function templateDialog(template = {}) {
  const source = template.body || template,
    name = input(template.name || ""),
    description = el("textarea", {}, template.description || ""),
    defaultEditor = programEditor(source.defaultProgram || {}, "默认节目"),
    slots = el("div"),
    slotEditors = [];
  const canEdit = operate();
  function addSlot(initial = {}) {
    const slotName = input(initial.name || `时段 ${slotEditors.length + 1}`),
      today = new Date().toISOString().slice(0, 10),
      startDate = input(initial.startDate || today, "date"),
      endDate = input(
        initial.endDate ||
          new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        "date",
      ),
      startTime = input(initial.startTime || "09:00", "time"),
      endTime = input(initial.endTime || "22:00", "time"),
      days = [1, 2, 3, 4, 5, 6, 7].map((n) => {
        const c = check(
          ["", "一", "二", "三", "四", "五", "六", "日"][n],
          (initial.weekdays || [1, 2, 3, 4, 5, 6, 7]).includes(n),
        );
        return { ...c, n };
      }),
      program = programEditor(initial.program || {}, "时段节目"),
      node = el("section", { class: "card section" });
    const editor = {
      node,
      value: () => {
        if (
          !slotName.value.trim() ||
          !startDate.value ||
          !endDate.value ||
          !startTime.value ||
          !endTime.value
        )
          throw new Error("请完整填写时段名称、日期和时间");
        if (startDate.value > endDate.value)
          throw new Error("时段结束日期不能早于开始日期");
        if (startTime.value === endTime.value)
          throw new Error(
            "时段起止时间不能相同；跨午夜可设置结束时间早于开始时间",
          );
        const weekdays = days.filter((x) => x.control.checked).map((x) => x.n);
        if (!weekdays.length) throw new Error("时段至少选择一个星期");
        return {
          ...(initial.id ? { id: initial.id } : {}),
          name: slotName.value.trim(),
          startDate: startDate.value,
          endDate: endDate.value,
          weekdays,
          startTime: startTime.value,
          endTime: endTime.value,
          program: program.value(),
        };
      },
    };
    node.append(
      el(
        "div",
        { class: "card-head" },
        el("h3", {}, "日期时段"),
        button(
          "移除此时段",
          () => {
            slotEditors.splice(slotEditors.indexOf(editor), 1);
            node.remove();
          },
          "small danger",
        ),
      ),
      field("时段名称", slotName),
      row(field("开始日期", startDate), field("结束日期", endDate)),
      el("div", { class: "label", style: "margin-bottom:8px" }, "每周生效日"),
      el(
        "div",
        { class: "weekdays" },
        days.map((x) => x.node),
      ),
      row(
        field("开始时间（门店当地时间）", startTime),
        field("结束时间（可跨午夜）", endTime),
      ),
      program.node,
    );
    slotEditors.push(editor);
    slots.append(node);
  }
  const d = dialog(template.id ? "编辑模板草稿" : "创建节目模板", {
    wide: true,
    ...(canEdit
      ? {
          save: "保存草稿",
          onSave: async () => {
            if (!name.value.trim()) throw new Error("请输入模板名称");
            const body = {
              name: name.value.trim(),
              description: description.value,
              defaultProgram: defaultEditor.value(),
              slots: slotEditors.map((x) => x.value()),
            };
            await (template.id
              ? put(`/api/templates/${template.id}`, body)
              : post("/api/templates", body));
            await refresh();
            toast("草稿已保存；需要发布版本后才能下发设备");
          },
        }
      : {}),
  });
  d.body.append(
    el(
      "div",
      { class: "help" },
      "保存草稿不会影响设备。每个时段按目标门店时区执行；跨午夜属于开始日。同模板时段重叠会在发布时被拒绝。",
    ),
    field("模板名称", name),
    field("模板说明", description),
    defaultEditor.node,
    el(
      "div",
      { class: "card-head" },
      el("h3", { class: "panel-title" }, "日期与时段"),
      button("+ 添加时段", () => addSlot(), "small primary"),
    ),
    slots,
  );
  (source.slots || []).forEach(addSlot);
  if (!canEdit) {
    d.body
      .querySelectorAll("input,select,textarea,button")
      .forEach((x) => (x.disabled = true));
  }
}
function publishTemplate(template) {
  const d = dialog("发布不可变版本", {
    save: "确认发布版本",
    onSave: async () => {
      const version = await post(`/api/templates/${template.id}/publish`);
      await refresh();
      toast(
        `已生成版本 ${version.name || String(version.id || "").slice(0, 8)}，请前往发布管理选择目标组`,
      );
    },
  });
  d.body.append(
    el(
      "div",
      { class: "help" },
      `将「${template.name}」当前草稿冻结为不可变版本。服务端会校验素材时长、时段冲突等；此操作尚未下发到任何设备。`,
    ),
  );
}
async function versionDialog(template) {
  const d = dialog(`${template.name} · 版本记录`, { wide: true });
  try {
    const versions = array(await get(`/api/templates/${template.id}/versions`));
    d.body.append(
      versions.length
        ? el(
            "div",
            { class: "list" },
            versions.map((v) =>
              el(
                "div",
                { class: "card" },
                el(
                  "div",
                  { class: "card-head" },
                  el("h3", {}, v.name || `版本 ${String(v.id).slice(0, 8)}`),
                  el("span", { class: "badge green" }, "不可变"),
                ),
                meta(
                  `发布于 ${fmtDate(v.createdAt)}`,
                  `版本 ID ${v.id}`,
                  v.sha256 ? `SHA-256 ${v.sha256}` : null,
                ),
                button(
                  "查看版本内容",
                  () => {
                    const view = dialog("已发布版本内容", { wide: true });
                    view.body.append(details(v.body || v));
                  },
                  "small",
                ),
              ),
            ),
          )
        : empty("尚无已发布版本"),
    );
  } catch (e) {
    d.body.append(el("div", { class: "error" }, e.message));
  }
}
function showAssignmentResults(results, title) {
  if (!Array.isArray(results) || !results.length) return;
  const failed = results.filter((r) => r.status === "failed");
  const accepted = results.length - failed.length;
  toast(
    `${accepted} 个组已创建发布任务${failed.length ? `，${failed.length} 个组未能提交` : ""}；请检查设备准备与实际生效回执`,
    failed.length > 0,
  );
  setTimeout(() => {
    const view = dialog(title, { wide: true });
    view.body.append(
      el(
        "div",
        { class: failed.length ? "error" : "help" },
        `共 ${results.length} 个播放组：${accepted} 个已创建任务，${failed.length} 个提交失败。创建任务不代表电视已播放。`,
      ),
      el("div", { class: "list" }, results.map(deploymentRow)),
    );
  }, 0);
}
function deploymentRow(d) {
  const progress = d.progress;
  const error = d.error || d.errors;
  const errorText =
    typeof error === "string"
      ? error
      : error && Object.keys(error).length
        ? Object.values(error)
            .map((v) =>
              typeof v === "string" ? v : v?.message || JSON.stringify(v),
            )
            .join("；")
        : null;
  const label = d.groupName || nameOf("groups", d.groupId);
  const main = el(
    "div",
    { class: "list-main" },
    el(
      "div",
      { class: "list-title" },
      `${label} · ${d.versionName || (d.versionId ? nameOf("versions", d.versionId) : "手动单素材播放")}`,
    ),
    meta(
      `创建 ${fmtDate(d.createdAt)} · 生效 ${fmtDate(d.activateAt)}`,
      errorText,
      typeof progress === "object" &&
        progress !== null &&
        progress.expected !== undefined
        ? `在线设备准备：${progress.ready ?? 0} / ${progress.expected}`
        : null,
      progress?.awaitingReports ? "组时间轴已提交，等待设备实际播放回报" : null,
    ),
  );
  if (typeof progress === "number")
    main.append(
      el(
        "div",
        { class: "progress" },
        el("span", {
          style: `width:${Math.max(0, Math.min(100, progress <= 1 ? progress * 100 : progress))}%`,
        }),
      ),
    );
  return el(
    "article",
    { class: "list-row" },
    main,
    status(d.status === "active" ? "active_program" : d.status),
    el(
      "div",
      { class: "actions" },
      button(
        "回执详情",
        () => {
          const view = dialog("组发布与设备回执", { wide: true });
          view.body.append(
            el(
              "div",
              { class: "help" },
              "已提交与已生效不同；请结合每台设备的实际状态、准备回执和错误判断。",
            ),
            details(d),
          );
        },
        "small",
      ),
      ...(storeOperate() && ["failed", "partial"].includes(d.status)
        ? [
            button(
              "重试",
              () =>
                confirmAction(
                  "重试发布",
                  "将重新准备此版本，请确认目标组设备和容量已满足要求。",
                  () => post(`/api/deployments/${d.id}/retry`),
                ),
              "small",
            ),
          ]
        : []),
      ...(storeOperate() &&
      ![
        "failed",
        "cancelled",
        "canceled",
        "applied",
        "active",
        "committed",
        "completed",
        "success",
      ].includes(d.status)
        ? [
            button(
              "取消",
              () =>
                confirmAction(
                  "取消待生效发布",
                  "取消后设备继续保留原节目。已生效的版本需通过新发布回退。",
                  () => post(`/api/deployments/${d.id}/cancel`),
                ),
              "small danger",
            ),
          ]
        : []),
    ),
  );
}
function renderDeployments(page) {
  page.append(
    heading(
      "发布管理",
      "将明确版本下发到门店与播放组，并跟踪准备、生效和设备回执。",
      [
        button("刷新回执", refresh),
        ...(storeOperate()
          ? [button("+ 批量发布", deploymentDialog, "primary")]
          : []),
      ],
    ),
    el(
      "div",
      { class: "help" },
      "设备必须先完整下载并准备节目。离线设备将显示待追赶；在线设备未准备完成时，该组保留原节目。HTTP 提交成功不代表电视已播放。",
    ),
  );
  const list = state.data.deployments;
  page.append(
    list.length
      ? el("div", { class: "list" }, list.map(deploymentRow))
      : empty(
          "还没有发布任务",
          "先创建并发布模板版本，再选择目标门店或播放组。",
        ),
  );
}
function deploymentDialog() {
  const versions = state.data.versions,
    version = select([
      ["", "选择已发布版本"],
      ...versions.map((x) => [
        x.id,
        `${x.name || "未命名版本"} · ${fmtDate(x.createdAt)}`,
      ]),
    ]),
    mode = select([
      ["now", "立即准备并生效"],
      ["scheduled", "定时生效"],
    ]),
    time = input("", "datetime-local"),
    replace = check("明确替换各组当前待生效目标", false),
    targets = el("div", { class: "check-list" }),
    checks = [];
  for (const store of state.data.stores) {
    const storeGroups = state.data.groups.filter((g) => g.storeId === store.id);
    const all = check(`${store.name} · 选择整店`, false);
    all.node.style.fontWeight = "700";
    targets.append(all.node);
    const items = storeGroups.map((g) => {
      const c = check(g.name, false);
      c.node.style.paddingLeft = "24px";
      targets.append(c.node);
      checks.push({ group: g, control: c.control });
      c.control.addEventListener("change", () => {
        all.control.checked = items.every((x) => x.control.checked);
        all.control.indeterminate =
          items.some((x) => x.control.checked) && !all.control.checked;
      });
      return c;
    });
    all.control.addEventListener("change", () =>
      items.forEach((x) => (x.control.checked = all.control.checked)),
    );
  }
  time.disabled = true;
  mode.addEventListener("change", () => (time.disabled = mode.value === "now"));
  const d = dialog("按门店批量发布", {
    save: "提交发布任务",
    onSave: async () => {
      const groupIds = checks
        .filter((x) => x.control.checked)
        .map((x) => x.group.id);
      if (!version.value || !groupIds.length)
        throw new Error("请选择已发布版本和至少一个播放组");
      let activateAt;
      if (mode.value === "scheduled") {
        if (!time.value || new Date(time.value).getTime() <= Date.now())
          throw new Error("请选择未来生效时间");
        activateAt = new Date(time.value).getTime();
      }
      const submitted = await post("/api/deployments", {
        versionId: version.value,
        groupIds,
        ...(activateAt ? { activateAt } : {}),
        replacePending: replace.control.checked,
      });
      await refresh();
      showAssignmentResults(array(submitted), "批量发布逐组结果");
    },
  });
  d.body.append(
    field("节目版本", version),
    row(field("生效方式", mode), field("生效时间（此浏览器当地时间）", time)),
    el("div", { class: "label" }, "目标门店与播放组"),
    targets.children.length ? targets : empty("暂无目标播放组"),
    replace.node,
    el(
      "div",
      { class: "help", style: "margin-top:16px" },
      "本次发布会为选中组指定独立版本，覆盖门店默认继承；可在播放组设置恢复继承。勾选替换表示取消旧待生效目标。每组独立校验并返回结果，有失败组时其余组仍可继续准备。",
    ),
  );
}
function renderReleases(page) {
  page.append(
    heading(
      "APK 版本库",
      "上传经验证的 Android 客户端安装包，供租户安排升级。",
      [button("刷新", refresh), button("+ 上传 APK", releaseDialog, "primary")],
    ),
  );
  page.append(releaseList());
}
function releaseList() {
  return state.data.releases.length
    ? el(
        "div",
        { class: "grid" },
        state.data.releases.map((r) =>
          el(
            "article",
            { class: "card" },
            el(
              "div",
              { class: "card-head" },
              el("h3", {}, r.versionName || `版本 ${r.versionCode}`),
              el("span", { class: "badge blue" }, `build ${r.versionCode}`),
            ),
            meta(
              r.packageName || "local.mosaic.tv",
              `minSDK ${r.minSdk ?? "—"} · ${bytes(r.size)}`,
              `上传 ${fmtDate(r.createdAt)}`,
              r.releaseNotes || "暂无发布说明",
            ),
            el(
              "div",
              { class: "card-footer" },
              button(
                "完整元数据",
                () => {
                  const d = dialog("APK 元数据");
                  d.body.append(details(r));
                },
                "small",
              ),
            ),
          ),
        ),
      )
    : empty("暂无可用安装包", "由平台管理员上传同包名、同签名的客户端 APK。");
}
function releaseDialog() {
  const file = input("", "file", {
      accept: ".apk,application/vnd.android.package-archive",
    }),
    notes = el("textarea", { placeholder: "此版本的功能、修复和升级注意事项" }),
    progress = el("div", { class: "meta" });
  const d = dialog("上传 Android 安装包", {
    save: "上传并校验",
    onSave: async () => {
      if (!file.files[0]) throw new Error("请选择 APK 文件");
      const form = new FormData();
      form.append("file", file.files[0]);
      form.append("releaseNotes", notes.value);
      progress.textContent = "正在上传并验证包信息和签名…";
      await post("/api/releases", form);
      await refresh();
      toast("APK 已上传并通过服务端验证");
    },
  });
  d.body.append(
    el(
      "div",
      { class: "help" },
      "服务端验证包名、签名、versionCode 和 minSDK。设备会再次验证安装包，并由用户使用遥控器确认安装。",
    ),
    field("APK 安装包", file),
    field("发布说明", notes),
    progress,
  );
}
function renderUpdates(page) {
  page.append(
    heading(
      "客户端升级",
      "安排 Android 设备升级窗口，逐台确认下载、安装与重启回报。",
      [
        button("刷新状态", refresh),
        ...(admin() ? [button("+ 下发升级", updateDialog, "primary")] : []),
      ],
    ),
    el(
      "div",
      { class: "help" },
      "普通电视需遥控器确认安装。只有设备重启后回报新版本，才能确认升级成功。旧版 0.1.1 首次升级仍需手动覆盖安装。",
    ),
  );
  const updates = state.data.updates;
  page.append(
    el("h2", { class: "panel-title" }, "升级任务"),
    updates.length
      ? el(
          "div",
          { class: "list" },
          updates.map((u) =>
            el(
              "article",
              { class: "list-row" },
              el(
                "div",
                { class: "list-main" },
                el(
                  "div",
                  { class: "list-title" },
                  u.deviceName || nameOf("devices", u.deviceId),
                ),
                meta(
                  `${u.versionName || nameOf("releases", u.releaseId)} · 创建 ${fmtDate(u.createdAt)}`,
                  `计划 ${fmtDate(u.activateAt)}`,
                  u.error || null,
                ),
              ),
              status(u.status),
              button(
                "任务详情",
                () => {
                  const d = dialog("升级任务详情", { wide: true });
                  d.body.append(details(u));
                },
                "small",
              ),
            ),
          ),
        )
      : empty("暂无升级任务", "选择已验证版本和支持升级的设备。"),
    el("h2", { class: "panel-title", style: "margin-top:28px" }, "可用版本"),
    releaseList(),
  );
}
function updateDialog() {
  const release = select([
      ["", "选择 APK 版本"],
      ...state.data.releases.map((r) => [
        r.id,
        `${r.versionName || r.versionCode} · build ${r.versionCode}`,
      ]),
    ]),
    store = select([
      ["", "全部门店"],
      ...state.data.stores.map((x) => [x.id, x.name]),
    ]),
    time = input("", "datetime-local"),
    targets = el("div", { class: "check-list" }),
    selected = new Set();
  const draw = () => {
    targets.replaceChildren();
    for (const device of state.data.devices.filter(
      (x) => !store.value || x.storeId === store.value,
    )) {
      const caps = device.report?.capabilities || device.capabilities || [],
        supported = caps.includes("updates"),
        c = check(
          `${device.name || device.id} · ${nameOf("stores", device.storeId)} · ${device.report?.versionName || device.report?.version || "版本未上报"}${supported ? "" : "（未上报升级能力）"}${device.online ? "" : " · 离线"}`,
          selected.has(device.id),
        );
      c.control.disabled = !supported;
      c.control.addEventListener("change", () =>
        c.control.checked
          ? selected.add(device.id)
          : selected.delete(device.id),
      );
      targets.append(c.node);
    }
    if (!targets.children.length) targets.append(empty("没有匹配设备"));
  };
  store.addEventListener("change", draw);
  draw();
  const d = dialog("安排客户端升级", {
    save: "下发升级任务",
    onSave: async () => {
      if (!release.value || !selected.size)
        throw new Error("请选择安装包和至少一台支持升级的设备");
      let activateAt;
      if (time.value) {
        activateAt = new Date(time.value).getTime();
        if (activateAt < Date.now())
          throw new Error("升级窗口不能早于当前时间");
      }
      await post("/api/updates", {
        releaseId: release.value,
        deviceIds: [...selected],
        ...(activateAt ? { activateAt } : {}),
      });
      await refresh();
      toast("升级任务已创建，请跟踪设备安装回报");
    },
  });
  d.body.append(
    field("目标安装包", release),
    field(
      "维护窗口（可选，此浏览器当地时间）",
      time,
      "留空为立即发出升级任务；设备仍需用户确认安装。",
    ),
    field("筛选门店", store),
    el("div", { class: "label" }, "目标设备"),
    targets,
    el(
      "div",
      { class: "help", style: "margin-top:16px" },
      "建议先选择少量试点设备。离线、旧客户端或签名不匹配不会被记为升级成功。",
    ),
  );
}
function renderUsers(page) {
  page.append(
    heading(
      "用户与权限",
      "管理团队角色与门店范围，禁用或变更权限将撤销原会话。",
      [
        button("刷新", refresh),
        button("+ 添加用户", () => userDialog(), "primary"),
      ],
    ),
  );
  page.append(
    state.data.users.length
      ? el(
          "div",
          { class: "list" },
          state.data.users.map((u) =>
            el(
              "article",
              { class: "list-row" },
              el(
                "div",
                { class: "list-main" },
                el("div", { class: "list-title" }, u.name || u.username),
                meta(
                  `账号 ${u.username || "—"} · ${roles[u.role] || u.role}`,
                  u.storeIds?.length
                    ? `门店：${u.storeIds.map((x) => nameOf("stores", x)).join("、")}`
                    : "门店范围：按角色授权",
                  u.mustChangePassword ? "下次登录须修改密码" : null,
                ),
              ),
              el(
                "span",
                { class: `badge ${u.enabled === false ? "red" : "green"}` },
                u.enabled === false ? "已禁用" : "正常",
              ),
              button("权限与密码", () => userDialog(u), "small"),
            ),
          ),
        )
      : empty("暂无用户"),
  );
}
function userDialog(user = {}) {
  const name = input(user.name || ""),
    username = input(user.username || "", "text", { autocomplete: "off" }),
    roleControl = select(
      Object.entries(roles).filter(([k]) => k !== "platform_admin"),
      user.role || "operator",
    ),
    enabled = check("账号启用", user.enabled !== false),
    password = input("", "password", { autocomplete: "new-password" }),
    scopes = state.data.stores.map((s) => ({
      ...check(s.name, (user.storeIds || []).includes(s.id)),
      id: s.id,
    }));
  const d = dialog(user.id ? "用户权限与密码" : "添加团队用户", {
    onSave: async () => {
      if (!name.value.trim() || !username.value.trim())
        throw new Error("请填写姓名和登录账号");
      if ((!user.id || password.value) && password.value.length < 12)
        throw new Error("初始或重置密码至少 12 位");
      const storeIds = scopes.filter((x) => x.control.checked).map((x) => x.id);
      if (roleControl.value === "store_operator" && !storeIds.length)
        throw new Error("请为门店操作员选择授权门店");
      const body = {
        name: name.value.trim(),
        username: username.value.trim(),
        role: roleControl.value,
        storeIds,
        enabled: enabled.control.checked,
        ...(password.value ? { password: password.value } : {}),
      };
      await (user.id
        ? put(`/api/users/${user.id}`, body)
        : post("/api/users", body));
      await refresh();
      toast("用户设置已保存");
    },
  });
  d.body.append(
    row(field("姓名", name), field("登录账号", username)),
    field("角色", roleControl),
    el(
      "div",
      { class: "help" },
      "租户管理员管理团队和配置；运营员编排与发布；门店操作员仅操作授权门店；只读账号查看授权状态。权限由服务端校验。",
    ),
    el("div", { class: "label" }, "授权门店"),
    el(
      "div",
      { class: "check-list" },
      scopes.map((x) => x.node),
    ),
    field(
      user.id ? "重置密码（留空保留原密码）" : "初始密码",
      password,
      "至少 12 位。重置后应告知用户首次登录修改。",
    ),
    enabled.node,
  );
}
function renderAudit(page) {
  page.append(
    heading(
      platform() ? "平台审计" : "操作审计",
      "按时间保留操作者、目标、结果和上下文。",
      [button("刷新", refresh)],
    ),
  );
  const list = state.data.audit,
    container = el("div", { class: "list" });
  const auditRow = (a) =>
    el(
      "article",
      { class: "list-row" },
      el(
        "div",
        { class: "list-main" },
        el("div", { class: "list-title" }, a.action || a.event || "审计事件"),
        meta(
          `${a.actorName || a.userName || a.actorId || a.userId || "系统"} · ${fmtDate(a.createdAt || a.at || a.timestamp)}`,
          `目标 ${a.targetName || a.targetId || a.target || "—"}`,
        ),
      ),
      el("span", { class: "badge" }, a.result || "已记录"),
      button(
        "详情",
        () => {
          const d = dialog("审计详情", { wide: true });
          d.body.append(details(a));
        },
        "small",
      ),
    );
  container.append(...list.map(auditRow));
  let cursor = list.at(-1)?.id;
  const older = button(
    "加载更早记录",
    async () => {
      older.disabled = true;
      try {
        const more = array(
          await get(
            `/api/audit?limit=100&cursor=${encodeURIComponent(cursor)}`,
          ),
        );
        if (!more.length) {
          older.textContent = "已显示全部记录";
          return;
        }
        container.append(...more.map(auditRow));
        cursor = more.at(-1).id;
        older.disabled = false;
      } catch (e) {
        toast(e.message, true);
        older.disabled = false;
      }
    },
    "",
    { disabled: !cursor },
  );
  page.append(
    list.length ? container : empty("暂无审计事件", "新操作会在服务端记录。"),
    el("div", { class: "actions", style: "margin-top:18px" }, older),
  );
}
async function boot() {
  try {
    state.session = await get("/api/session");
    state.page = platform() ? "tenants" : "overview";
    await refresh();
    if (state.session.user.mustChangePassword) passwordDialog(true);
  } catch {
    renderLogin();
  }
}
window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  toast(event.reason?.message || "操作未能完成，请重试", true);
});
boot();
