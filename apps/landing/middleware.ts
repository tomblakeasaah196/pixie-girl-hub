import { NextRequest, NextResponse } from "next/server";

/**
 * Host → brand HINT for the public sales subdomains.
 *
 * NO hardcoded domain map here — the authoritative host → brand mapping
 * lives in the DB (`business_config.sales_subdomain`, edited in Settings →
 * Business Setup) and is applied by the Hub's host-brand-resolver
 * middleware: lib/api.ts forwards the original Host on every backend call,
 * so a brand domain change is done entirely from the UI.
 *
 * This middleware only stamps a best-effort HINT (`x-brand-context`) from
 * the brand key appearing in the hostname, so Server Components that want
 * a brand before any API round-trip still have one. The resolved brand is
 * forwarded as a REQUEST header — setting it only on the *response* is
 * invisible to `headers()` in a Server Component.
 */
function resolveBrand(hostname: string): string | null {
  const host = hostname.split(":")[0].toLowerCase();
  // Brand-key substring match — domain-agnostic, so it survives domain
  // changes (any host containing the brand's name resolves to it).
  if (host.includes("faitlyn")) return "faitlynhair";
  if (host.includes("pixie")) return "pixiegirl";
  return process.env.DEFAULT_BRAND ?? null;
}

export function middleware(req: NextRequest) {
  const hostname = req.headers.get("host") || "";
  const brand = resolveBrand(hostname);

  // Clone the inbound request headers and stamp the brand on them. This is
  // what makes the brand visible to `headers()` inside Server Components,
  // which is how lib/api.ts forwards X-Brand-Context to the Hub backend.
  const country =
    req.headers.get("cf-ipcountry") ||
    req.headers.get("x-vercel-ip-country") ||
    req.headers.get("cloudfront-viewer-country") ||
    "";

  const requestHeaders = new Headers(req.headers);
  if (brand) {
    requestHeaders.set("x-brand", brand);
    requestHeaders.set("x-brand-context", brand);
  }
  if (country) {
    requestHeaders.set("x-visitor-country", country.toUpperCase());
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
