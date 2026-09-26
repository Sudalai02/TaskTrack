// ============================================================
// NEXORA SERVICE WORKER — offline-first app shell
// ============================================================

const CACHE = "nexora-cache-v9";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Clicking a notification focuses the app and routes to the alert's target.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = event.notification.data && event.notification.data.route;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          if (route) client.postMessage({ type: "nexora:navigate", route });
          return client.focus();
        }
      }
      return self.clients.openWindow(route ? `./#${route}` : "./");
    })
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept cross-origin traffic.
  if (url.origin !== location.origin) return;
  if (event.request.method !== "GET") return;

  // Always fetch index.html from network (needed for auth redirect flow).
  if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname.endsWith("/index.html")) {
    event.respondWith(fetch(event.request));
    return;
  }

  // App shell + local assets. App code (JS/CSS) is NETWORK-FIRST: this app
  // ships unbundled ES modules straight from disk with no cache-busting
  // query strings, so a cache-first strategy here pinned the browser to
  // whatever code it happened to load first and code fixes never arrived.
  // Offline still works — the network failure falls through to the cache.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match("./index.html"))
      )
  );
});
