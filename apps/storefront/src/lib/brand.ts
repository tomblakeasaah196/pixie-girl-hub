/**
 * Host → brand resolution for the Storefront Website.
 *
 * Mirrors apps/landing (middleware.ts + lib/brand.ts): the brand is derived from
 * the request HOST and forwarded to the Hub as `X-Brand-Context`. There is NO
 * brand switcher in the website — one deploy serves one brand per host.
 *
 * This is the Storefront WEBSITE (e.g. pixiegirlglobal.com / thefaitlynbrand.com),
 * NOT the Sales Campaign Landing (sales.<brand> → apps/landing). Never conflate.
 */

export type BrandKey = "pixiegirl" | "faitlynhair";

/** Explicit host map; substring fallback handles freshly-pointed aliases. */
const HOST_BRAND_MAP: Record<string, BrandKey> = {
  "pixiegirlglobal.com": "pixiegirl",
  "www.pixiegirlglobal.com": "pixiegirl",
  "thefaitlynbrand.com": "faitlynhair",
  "www.thefaitlynbrand.com": "faitlynhair",
  "faitlynhair.com": "faitlynhair",
  "www.faitlynhair.com": "faitlynhair",
};

function envDefaultBrand(): BrandKey {
  const fromServer =
    typeof process !== "undefined" ? process.env?.DEFAULT_BRAND : undefined;
  const fromClient =
    typeof import.meta !== "undefined"
      ? (import.meta as { env?: Record<string, string> }).env
          ?.VITE_STOREFRONT_BRAND
      : undefined;
  const v = (fromClient || fromServer || "pixiegirl").toLowerCase();
  return v === "faitlynhair" ? "faitlynhair" : "pixiegirl";
}

/**
 * Resolve a brand from a hostname (no port). Returns the env default when the
 * host is unknown (e.g. localhost / preview domains).
 */
export function brandFromHost(hostname?: string | null): BrandKey {
  if (!hostname) return envDefaultBrand();
  const host = hostname.split(":")[0].toLowerCase();
  if (HOST_BRAND_MAP[host]) return HOST_BRAND_MAP[host];
  if (host.includes("faitlyn")) return "faitlynhair";
  if (host.includes("pixie")) return "pixiegirl";
  return envDefaultBrand();
}

/** Client-side brand: from <html data-brand> set at SSR, else env. */
export function clientBrand(): BrandKey {
  if (typeof document !== "undefined") {
    const b = document.documentElement.getAttribute("data-brand");
    if (b === "faitlynhair" || b === "pixiegirl") return b;
  }
  return envDefaultBrand();
}
