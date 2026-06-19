/**
 * Server-side fetcher for the Hub's public sales endpoint.
 *
 * Marked `"server-only"` so the build fails fast if it ever drifts into
 * a Client Component. Client-side helpers (signup + checkout POSTs)
 * live in lib/api-client.ts.
 *
 * On the Hub backend the route is `/api/public/sale/:slug`. In dev the
 * Next.js rewrite proxies the call to localhost:7000. In production the
 * sales subdomain (sales.pixiegirlglobal.com / sales.thefaitlynbrand.com)
 * is fronted by an edge that routes /api/* to the Hub backend; the brand
 * is then resolved server-side from the Host header by the host →
 * brand resolver middleware (src/middleware/host-brand-resolver.js).
 */

import "server-only";
import { headers } from "next/headers";
import type { LandingPayload } from "./types";

function apiBase(): string {
  return process.env.HUB_API_URL || "http://localhost:7000";
}

/** Fetch a campaign by slug. Returns null on 404 so callers can render notFound(). */
export async function fetchCampaign(
  slug: string,
): Promise<LandingPayload | null> {
  const host = headers().get("host") || "";
  const hostName = host.split(":")[0];
  const brandHint = headers().get("x-brand-context") || undefined;
  const url = `${apiBase()}/api/public/sale/${encodeURIComponent(slug)}`;
  const init: RequestInit = {
    method: "GET",
    headers: {
      Accept: "application/json",
      // Forward the inbound host so the resolver middleware on the Hub
      // can map sales.* → brand.
      Host: hostName,
      "X-Forwarded-Host": hostName,
      ...(brandHint ? { "X-Brand-Context": brandHint } : {}),
    },
    // Short revalidate window so the Live state ticks while keeping
    // Edge caches warm during high-traffic moments.
    next: { revalidate: 5 },
  };
  const res = await fetch(url, init);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Hub returned ${res.status} for /sale/${slug}`);
  }
  const json = (await res.json()) as { data?: LandingPayload };
  return (json?.data ?? (json as unknown as LandingPayload)) || null;
}

/** Fetch the sales index (storefront root). Returns the active/upcoming/past campaign summaries. */
export async function fetchSalesIndex(): Promise<{
  brand: string;
  active: { slug: string; name: string; hero_image_url?: string; state: "before" | "live" | "ended" } | null;
  upcoming: Array<{ slug: string; name: string; hero_image_url?: string; state: "before" | "live" | "ended"; starts_at: string }>;
  past: Array<{ slug: string; name: string; hero_image_url?: string; state: "before" | "live" | "ended"; ends_at: string }>;
} | null> {
  const host = headers().get("host") || "";
  const hostName = host.split(":")[0];
  const brandHint = headers().get("x-brand-context") || undefined;
  const url = `${apiBase()}/api/public/sale`;
  const init: RequestInit = {
    method: "GET",
    headers: {
      Accept: "application/json",
      Host: hostName,
      "X-Forwarded-Host": hostName,
      ...(brandHint ? { "X-Brand-Context": brandHint } : {}),
    },
    next: { revalidate: 5 },
  };
  const res = await fetch(url, init);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Hub returned ${res.status} for /api/public/sale`);
  }
  const json = (await res.json()) as { data?: any };
  return json?.data ?? null;
}

export function apiBaseUrl(): string {
  return apiBase();
}
