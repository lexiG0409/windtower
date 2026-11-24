// 离线缓存：先尝试联网拿最新版，断网时用上次缓存的页面（单人模式可离线玩）
// 所有路径都相对于网站所在目录，所以放在 / 或 /windtower/ 下都能用
const CACHE = "windtower-v5";
const BASE = new URL("./", self.location).pathname;
const SHELL = ["", "index.html", "api/questions", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"].map(p => BASE + p);
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith(BASE + "socket.io")) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match(BASE))));
});
