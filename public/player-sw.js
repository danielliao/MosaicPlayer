// Only the credential-free player application shell is cached here.
// Accounts, APIs, media and enrollment always bypass this service worker.
const VERSION = "mosaic-player-shell-v2";
const SHELL = ["/play", "/player.js", "/player.css", "/sync.js", "/program.js", "/browser-program.js", "/favicon.svg"];
self.addEventListener("install", event => event.waitUntil((async () => {
  const cache = await caches.open(VERSION);
  await cache.addAll(SHELL.map(url => new Request(url, {cache:"reload"})));
  await self.skipWaiting();
})()));
self.addEventListener("activate", event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith("mosaic-player-shell-") && key !== VERSION) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      // Strip query credentials from shell requests; code reads them from the document URL.
      const response = await fetch(new Request(url.origin + url.pathname, {cache:"no-cache",credentials:"omit"}));
      if (response.ok) { await cache.put(url.pathname,response.clone()); return response; }
      return response;
    } catch {
      return await cache.match(url.pathname) || new Response("播放页面尚未离线缓存，请联网打开一次。",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
    }
  })());
});
