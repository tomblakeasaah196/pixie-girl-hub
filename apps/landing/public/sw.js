/*
 * Self-destroying service worker.
 *
 * The sales landing is intentionally NOT a PWA. A previously-deployed worker
 * was caching pages and assets and serving customers stale content — buttons
 * that "silently failed", checkout that bounced back to an old page, etc.
 *
 * This worker exists only to evict any stale predecessor still registered in a
 * customer's browser. The browser re-fetches a registered worker's script in
 * the background; when it sees THIS version it installs immediately, deletes
 * every cache, unregisters itself, and reloads open tabs so they fetch the
 * live network version. It never intercepts fetches, so it adds no caching.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        /* best-effort */
      }
      try {
        await self.registration.unregister();
      } catch {
        /* best-effort */
      }
      try {
        const clients = await self.clients.matchAll({ type: "window" });
        for (const client of clients) client.navigate(client.url);
      } catch {
        /* best-effort */
      }
    })(),
  );
});
