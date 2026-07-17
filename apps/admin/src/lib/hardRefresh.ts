/**
 * True hard refresh: drops the PWA's Cache Storage before reloading, so a
 * stuck shell cache can't survive the exact control the user reached for to
 * escape one. Navigations and JS/CSS bundles are already network-first /
 * network-only in the service worker (see public/sw.js) — only the small set
 * of precached SHELL_ASSETS need this extra step before window.location.reload().
 */
export async function hardRefresh(): Promise<void> {
  if ("caches" in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch {
      /* best effort — reload regardless */
    }
  }
  window.location.reload();
}
