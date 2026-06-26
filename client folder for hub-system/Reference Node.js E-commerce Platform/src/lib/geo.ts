/**
 * GeoIP demo stub.
 *
 * PRODUCTION TODO — swap `detectGeo()` to call the real MaxMind GeoIP2 / GeoLite2
 * web service from a `createServerFn` handler, then hydrate the client with the
 * resolved country. Server fn shape:
 *
 *   const res = await fetch(
 *     `https://geoip.maxmind.com/geoip/v2.1/country/${ip}`,
 *     { headers: { Authorization: `Basic ${btoa(`${ACCOUNT_ID}:${LICENSE_KEY}`)}` } }
 *   );
 *
 * For now this returns a mock + accepts manual override via localStorage or
 * `?geo=NG` query string, so the rest of the funnel (currency, payment routing,
 * shipping thresholds) is wired and reviewable end-to-end.
 */

const KEY = "faitlyn.geo.override";

export type GeoInfo = {
  country: string;          // human label, e.g. "Nigeria"
  countryCode: string;      // ISO-2, e.g. "NG"
  source: "override" | "query" | "stub";
};

const COUNTRY_LABEL: Record<string, string> = {
  NG: "Nigeria", US: "United States", GB: "United Kingdom",
  DE: "Germany", FR: "France", CA: "Canada", ZA: "South Africa",
  GH: "Ghana", KE: "Kenya", AE: "United Arab Emirates",
};

function labelFor(code: string) {
  return COUNTRY_LABEL[code.toUpperCase()] ?? code.toUpperCase();
}

export function detectGeo(): GeoInfo {
  if (typeof window === "undefined") {
    return { country: "Nigeria", countryCode: "NG", source: "stub" };
  }

  // ?geo=NG override (handy for QA + demos)
  try {
    const q = new URLSearchParams(window.location.search).get("geo");
    if (q) {
      const code = q.toUpperCase().slice(0, 2);
      return { country: labelFor(code), countryCode: code, source: "query" };
    }
  } catch {}

  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const code = raw.toUpperCase().slice(0, 2);
      return { country: labelFor(code), countryCode: code, source: "override" };
    }
  } catch {}

  // Stub default — pretend we resolved Lagos.
  return { country: "Nigeria", countryCode: "NG", source: "stub" };
}

export function setGeoOverride(countryCode: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (!countryCode) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, countryCode.toUpperCase().slice(0, 2));
  } catch {}
}
