/* Pixie Girl Hub service worker — web push + PWA installability.
   Proper fetch handler required for installability across all browsers
   (Chrome, Edge, Firefox, Samsung Internet). */

// Stamped with the git short SHA at build time (see the stamp-sw-build-id
// plugin in vite.config.ts). This makes sw.js byte-different on EVERY deploy,
// which is what makes browsers fire `updatefound` and show the in-app update
// banner. Without it, a deploy that only changes app JS leaves sw.js
// identical, so a long-lived PWA (especially iOS standalone, which suspends
// and resumes without a navigation) is never told a new build exists and
// keeps running stale code indefinitely. In dev the placeholder is served
// verbatim — harmless, it's just a string.
const BUILD_ID = "__PGH_BUILD__";

// The cache name embeds BUILD_ID so the activate handler (which deletes every
// cache that isn't CACHE_NAME) also evicts the previous deploy's shell cache.
const CACHE_NAME = "pixie-hub-shell-v6-" + BUILD_ID;
const OFFLINE_URL = "/offline.html";
// Fixed cache key for the last successfully fetched app HTML. Every SPA route
// serves the same document, so one cached copy covers every start URL.
const SHELL_URL = "/__app-shell__";
// How long a PWA launch waits on the network for index.html before starting
// from the cached copy instead. This is what caps the "blank screen" time on
// a slow/flaky mobile connection: a healthy network answers well inside this
// budget (and is served fresh); a bad one no longer holds the app hostage for
// 10–30s — the last known-good shell boots and the update banner still
// surfaces new builds when they exist.
const NAV_NETWORK_TIMEOUT_MS = 2000;
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

/**
 * Navigation strategy: network-first with a hard time budget.
 * - Fresh network HTML wins whenever it arrives inside the budget (deploys
 *   stay immediately visible on a healthy connection) and refreshes the
 *   cached shell copy for next launch.
 * - Past the budget — or on outright failure — the last good shell serves
 *   instantly and the app boots from cached assets, so a cold PWA start on
 *   bad mobile data paints in ~1–2s instead of hanging blank.
 * - No cached shell yet (very first visit): wait for the network like before,
 *   with offline.html as the terminal fallback.
 */
async function handleNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedShell = await cache.match(SHELL_URL);

  const networkFetch = fetch(request).then((res) => {
    // Never cache a redirected document — replaying it for a future
    // navigation is rejected by some browsers ("redirect mode is not
    // follow"), which would brick cached startups.
    if (res && res.ok && !res.redirected) cache.put(SHELL_URL, res.clone());
    return res;
  });

  if (!cachedShell) {
    try {
      return await networkFetch;
    } catch {
      return (await cache.match(OFFLINE_URL)) || Response.error();
    }
  }

  const winner = await Promise.race([
    networkFetch.catch(() => null),
    new Promise((resolve) =>
      setTimeout(() => resolve(null), NAV_NETWORK_TIMEOUT_MS),
    ),
  ]);
  // Serve fresh HTML when the network answered in time with a good response;
  // otherwise boot from the cached shell (a late network success still
  // refreshes the cache above for the NEXT launch).
  if (winner && winner.ok) return winner;
  return cachedShell;
}

/**
 * Vite build assets are content-hashed (immutable): cache-first is safe and
 * makes every repeat launch serve JS/CSS from disk with zero network wait.
 * The per-build cache name means a new deploy starts a fresh cache and the
 * activate handler wipes the old build's files.
 */
async function handleAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

// A real fetch handler (not an empty no-op) is required by Edge and
// Samsung Internet to consider the PWA installable.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(handleNavigation(event.request));
    return;
  }

  // Hashed build assets: cache-first (immutable per deploy).
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(handleAsset(event.request));
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

  // Everything else: network only (API calls, media, dynamic requests)
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
