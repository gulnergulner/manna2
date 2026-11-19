// Keep only the offline player shell. Private pages and API responses stay online.
const shell = "/saved-audio.html";
self.addEventListener("install", event => {
  event.waitUntil(caches.open("manna-shell-v1").then(cache => cache.add(shell)));
});
self.addEventListener("fetch", event => {
  if (event.request.mode === "navigate" && new URL(event.request.url).pathname === "/") {
    event.respondWith(fetch(event.request).catch(() => caches.match(shell)));
  }
});
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
