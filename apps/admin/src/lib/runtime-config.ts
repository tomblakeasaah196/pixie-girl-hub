/**
 * Runtime client config.
 *
 * The public address forms need the Google Maps/Places browser key. A
 * build-time `VITE_*` var gets baked into the bundle, so changing it on the
 * live server means a rebuild — exactly the "set it again" friction we want to
 * avoid. Instead we resolve the key at RUNTIME:
 *
 *   1. a build-time VITE var, if present (handy for local dev), else
 *   2. GET /api/public/config, served from the backend env var.
 *
 * The fetch is memoised for the page's lifetime; a transient failure clears
 * the cache so a later mount can retry.
 */

import { api } from "@/lib/api";

interface RuntimeConfig {
  maps: { places_key: string | null; configured: boolean };
}

// Build-time override (optional). Accepts either of the two historical names.
const BUILD_KEY = (import.meta.env.VITE_GOOGLE_PLACES_API_KEY ??
  import.meta.env.VITE_GOOGLE_MAPS_KEY) as string | undefined;

let configPromise: Promise<RuntimeConfig> | null = null;

function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  if (!configPromise) {
    configPromise = api.get<RuntimeConfig>("/config", "public").catch((err) => {
      configPromise = null; // allow a retry on the next call
      throw err;
    });
  }
  return configPromise;
}

let resolvedKey: string | null | undefined;

/**
 * Resolve the Maps/Places key. Returns null when none is configured (callers
 * degrade to a plain, typeable address field). Memoised across calls.
 */
export async function getMapsApiKey(): Promise<string | null> {
  if (BUILD_KEY) return BUILD_KEY;
  if (resolvedKey !== undefined) return resolvedKey;
  try {
    const cfg = await fetchRuntimeConfig();
    resolvedKey = cfg.maps?.places_key || null;
  } catch {
    return null; // leave resolvedKey unset so a retry is possible
  }
  return resolvedKey;
}
