import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useBranding, type BusinessBranding } from "@/lib/branding";
import { initials } from "@/lib/format";

/**
 * Active business (entity) context — attached to every API call + query
 * key (canon §4.1). Businesses have SEPARATE data; there is NO cross-
 * business "all" here. Only the Dashboard may aggregate.
 *
 * The LIST of businesses + their brand identity (logo, accents, fonts)
 * lives in the database (shared.business_config) and is fetched via
 * /api/public/branding. The store only persists the active KEY so the
 * shell remembers which brand the user was on across reloads.
 */
export interface Business {
  key: string;
  name: string;
  grad1: string;
  grad2: string;
  accent: string;
  monogram: string;
  logoUrl?: string | null;
}

/** Fallback used before the branding payload lands (or if the API is
 *  unreachable). Mirrors the seed values in migration 000208 so the
 *  switcher renders correctly even on a cold connection. */
const FALLBACK_BUSINESSES: Business[] = [
  {
    key: "pixiegirl",
    name: "Pixie Girl",
    grad1: "#a81d1d",
    grad2: "#690909",
    accent: "#690909",
    monogram: "P",
  },
  {
    key: "faitlynhair",
    name: "Faitlyn",
    grad1: "#7f703d",
    grad2: "#d5b8a4",
    accent: "#7f703d",
    monogram: "F",
  },
];

interface BusinessState {
  activeKey: string;
  setActive: (key: string) => void;
}

export const useBusinessStore = create<BusinessState>()(
  persist(
    (set) => ({
      activeKey: FALLBACK_BUSINESSES[0].key,
      setActive: (activeKey) => set({ activeKey }),
    }),
    { name: "pgh-business" },
  ),
);

/** Project the API row onto the Business shape the shell expects. */
function project(row: BusinessBranding): Business {
  const accent = row.accent_colour ?? "#690909";
  const grad1 = row.brand_theme?.grad1 ?? row.secondary_colour ?? accent;
  const grad2 = row.brand_theme?.grad2 ?? accent;
  const accentFinal = row.brand_theme?.accent ?? accent;
  return {
    key: row.business_key,
    name: row.display_name,
    grad1,
    grad2,
    accent: accentFinal,
    monogram: initials(row.display_name).slice(0, 1) || "•",
    logoUrl: row.logo_path,
  };
}

/** All active businesses, DB-driven with a fallback. */
export function useBusinesses(): Business[] {
  const { data } = useBranding();
  if (data?.businesses?.length) return data.businesses.map(project);
  return FALLBACK_BUSINESSES;
}

/** The currently active business. Falls back to the first one if the
 *  persisted key no longer matches anything in the payload. */
export function useActiveBusiness(): Business {
  const list = useBusinesses();
  const key = useBusinessStore((s) => s.activeKey);
  return list.find((b) => b.key === key) ?? list[0];
}

// Kept as a re-export so any straggler still importing BUSINESSES
// gets the fallback constants until those call-sites move to the hook.
export const BUSINESSES = FALLBACK_BUSINESSES;
