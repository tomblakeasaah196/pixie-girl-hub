/* Pixie Girl Hub service worker — web push + PWA installability.
   Proper fetch handler required for installability across all browsers
   (Chrome, Edge, Firefox, Samsung Internet). */

// Bump this version on any change that should evict the old shell cache.
// The activate handler deletes every cache that isn't CACHE_NAME, so a new
// version guarantees clients drop stale assets on next activation.
const CACHE_NAME = "pixie-hub-shell-v5";
const OFFLINE_URL = "/offline.html";
const SHELL_ASSETS = [
  "/favicon.svg",
  "/pwa-icon.svg",
  "/pwa-icon-192.svg",
  OFFLINE_URL,
];

self.addEventListener("install", (event) => {
  // NOTE: we deliberately do NOT call self.skipWaiting() here. A newly
  // installed worker parks in the "waiting" state and lets the running page
  // decide when to switch over, so we never yank the app out from under a
  // user mid-task. The client surfaces an "update available" banner and only
  // posts SKIP_WAITING (see the message handler below) when the user opts in.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
});

// Triggered by the update banner. When the page tells us the user accepted the
// update, activate immediately; the activate handler's clients.claim() then
// fires a controllerchange on the page, which reloads it onto the new build.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Network-first with shell asset cache fallback.
// A real fetch handler (not an empty no-op) is required by Edge and
// Samsung Internet to consider the PWA installable.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // For navigation requests, always go to network first (SPA handles
  // routing) — only fall back to the precached offline page once the
  // network request itself has failed (offline, DNS failure, unreachable
  // server). We don't retry the network here: an immediate re-fetch of the
  // same failed request essentially never succeeds and just delays the
  // friendly fallback from appearing.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL)),
    );
    return;
  }

  // For cached shell assets, try cache first then network
  if (SHELL_ASSETS.some((asset) => url.pathname === asset)) {
    event.respondWith(
      caches
        .match(event.request)
        .then((cached) => cached || fetch(event.request)),
    );
    return;
  }

  // Everything else: network only (API calls, dynamic assets)
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Pixie Hub", body: event.data.text() };
  }
  const {
    title = "Pixie Hub",
    body = "",
    url = "/notifications",
    tag,
  } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: tag || undefined,
      icon: "/pwa-icon-192.svg",
      badge: "/pwa-icon-192.svg",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/notifications";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of all) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
