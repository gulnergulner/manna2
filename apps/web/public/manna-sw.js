// Keep only the offline player shell. Private pages and API responses stay online.
const shell = "/saved-audio.html";
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open("manna-shell-v2");
    await cache.add(shell);
    await self.skipWaiting();
  })());
});
self.addEventListener("fetch", event => {
  if (event.request.mode === "navigate" && new URL(event.request.url).pathname === "/") {
    event.respondWith(fetch(event.request).catch(() => caches.match(shell)));
  }
});
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
