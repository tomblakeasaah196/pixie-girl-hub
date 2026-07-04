const DEVICE_KEY = "sf_device_id";

/**
 * Stable anonymous per-browser id used as an abuse-prevention quota key for
 * public AI features (Shade Finder, Shop AI Search). Not used for tracking —
 * nothing else is ever stored against it.
 */
export function deviceId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
