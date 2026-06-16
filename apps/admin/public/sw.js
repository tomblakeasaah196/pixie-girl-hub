/* Pixie Girl Hub service worker — web push + PWA installability.
   Fetch handler is a passthrough (required for installability).
   Push and notificationclick fire when no tab is open. */

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Minimal passthrough — installability requires a fetch handler.
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Pixie Hub", body: event.data.text() };
  }
  const { title = "Pixie Hub", body = "", url = "/notifications", tag } = payload;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: tag || undefined,
      icon: "/android-chrome-192x192.png",
      badge: "/android-chrome-192x192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/notifications";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
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
