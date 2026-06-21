import { NextRequest, NextResponse } from "next/server";

/**
 * Host → brand resolver for the public sales subdomains.
 *
 * The resolved brand is forwarded to Server Components as a REQUEST header
 * (`x-brand-context`) so lib/api.ts can pass it on to the Hub backend as
 * `X-Brand-Context`. Setting the header only on the *response* (the previous
 * behaviour) is invisible to `headers()` in a Server Component — so any host
 * missing from the map fell straight through to a 404. That is exactly what
 * happened to sales.faitlynhair.com, which was never in the map.
 */
const HOST_BRAND_MAP: Record<string, string> = {
  "sales.pixiegirlglobal.com": "pixiegirl",
  "sales.faitlynhair.com": "faitlynhair",
  "sales.thefaitlynbrand.com": "faitlynhair",
  localhost: "pixiegirl", // dev default
};

function resolveBrand(hostname: string): string | null {
  const host = hostname.split(":")[0].toLowerCase();
  if (HOST_BRAND_MAP[host]) return HOST_BRAND_MAP[host];
  // Substring fallback so a freshly-pointed or aliased subdomain still
  // resolves to the right brand before it is added to the map above.
  if (host.includes("faitlyn")) return "faitlynhair";
  if (host.includes("pixie")) return "pixiegirl";
  return process.env.DEFAULT_BRAND ?? null;
}

export function middleware(req: NextRequest) {
  const hostname = req.headers.get("host") || "";
  const brand = resolveBrand(hostname);

  // Clone the inbound request headers and stamp the brand on them. This is
  // what makes the brand visible to `headers()` inside Server Components.
  const requestHeaders = new Headers(req.headers);
  if (brand) {
    requestHeaders.set("x-brand", brand);
    requestHeaders.set("x-brand-context", brand);
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  // Also echo on the response (harmless; useful for debugging / edge caches).
  if (brand) {
    res.headers.set("x-brand", brand);
    res.headers.set("x-brand-context", brand);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
