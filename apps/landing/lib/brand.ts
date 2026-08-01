import { headers } from "next/headers";

export type BrandKey = string;

export interface BrandConfig {
  key: BrandKey;
  name: string;
  website: string | null;
  storefrontUrl: string | null;
  supportEmail: string | null;
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string | null;
}

// Visual-only fallback for when the Hub API is unreachable. Deliberately
// carries NO domains or mailboxes — those live in the DB (Settings →
// Business Setup → Public Identity) and are served by
// /api/public/brand/:key, so a brand domain change never touches code.
const FALLBACK: Record<string, BrandConfig> = {
  pixiegirl: {
    key: "pixiegirl",
    name: "Pixie Girl",
    website: null,
    storefrontUrl: null,
    supportEmail: null,
    primaryColor: "#a81d1d",
    secondaryColor: "#690909",
  },
  faitlynhair: {
    key: "faitlynhair",
    name: "Faitlyn Hair",
    website: null,
    storefrontUrl: null,
    supportEmail: null,
    primaryColor: "#7f703d",
    secondaryColor: "#d5b8a4",
  },
};

export function getBrand(): BrandKey {
  try {
    const host = headers().get("host") || "";
    if (host.includes("faitlyn")) return "faitlynhair";
    if (host.includes("pixie")) return "pixiegirl";
  } catch {
    // fall through to default
  }
  return "pixiegirl";
}

export async function getBrandConfig(): Promise<BrandConfig> {
  const brand = getBrand();
  const fallback = FALLBACK[brand] ?? FALLBACK.pixiegirl;
  try {
    const base = process.env.HUB_API_URL || "http://localhost:7000";
    const res = await fetch(`${base}/api/public/brand/${brand}`, {
      next: { revalidate: 60 }, // cache for 60s
    });
    if (res.ok) {
      const json = await res.json();
      const d = json?.data;
      if (d) {
        return {
          key: d.key ?? brand,
          name: d.name ?? fallback.name,
          website: d.website ?? null,
          storefrontUrl: d.storefront_url ?? null,
          supportEmail: d.support_email ?? null,
          primaryColor: d.accent_colour || fallback.primaryColor,
          secondaryColor: fallback.secondaryColor,
          logoUrl: d.logo_url ?? null,
        };
      }
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}
