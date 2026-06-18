import { headers } from "next/headers";

export type BrandKey = string;

export interface BrandConfig {
  key: BrandKey;
  name: string;
  fromEmail: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl?: string | null;
}

// Fallback for when the API is unreachable
const FALLBACK: Record<string, BrandConfig> = {
  pixiegirl: {
    key: "pixiegirl",
    name: "Pixie Girl",
    fromEmail: "noreply@pixiegirlglobal.com",
    primaryColor: "#a81d1d",
    secondaryColor: "#690909",
  },
  faitlynhair: {
    key: "faitlynhair",
    name: "Faitlyn Hair",
    fromEmail: "noreply@thefaitlynbrand.com",
    primaryColor: "#7f703d",
    secondaryColor: "#d5b8a4",
  },
};

export function getBrand(): BrandKey {
  return headers().get("x-brand") ?? "pixiegirl";
}

export async function getBrandConfig(): Promise<BrandConfig> {
  const brand = getBrand();
  try {
    const base = process.env.HUB_API_URL || "http://localhost:7000";
    const res = await fetch(`${base}/api/public/brand/${brand}`, {
      next: { revalidate: 60 }, // cache for 60s
    });
    if (res.ok) {
      const json = await res.json();
      return json?.data ?? FALLBACK[brand] ?? FALLBACK.pixiegirl;
    }
  } catch {
    // fall through to fallback
  }
  return FALLBACK[brand] ?? FALLBACK.pixiegirl;
}
