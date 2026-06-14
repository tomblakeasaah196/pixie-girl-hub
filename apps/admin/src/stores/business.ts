import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Active business (entity) context — attached to every API call + query key
 * (canon §4.1). Businesses have SEPARATE data; there is NO cross-business
 * "all" here. Only the Dashboard may aggregate. Brand identity (logo/colours)
 * comes from business_config; seeded here for the foundation.
 */
export interface Business {
  key: string;
  name: string;
  /** Layer-B gradient + accent (would come from business_config.accent_colour). */
  grad1: string;
  grad2: string;
  accent: string;
  monogram: string;
  logoUrl?: string | null;
}

export const BUSINESSES: Business[] = [
  { key: "pixiegirl", name: "Pixie Girl", grad1: "#a81d1d", grad2: "#690909", accent: "#690909", monogram: "P" },
  { key: "faitlynhair", name: "Faitlyn", grad1: "#7f703d", grad2: "#d5b8a4", accent: "#7f703d", monogram: "F" },
];

interface BusinessState {
  activeKey: string;
  setActive: (key: string) => void;
}

export const useBusinessStore = create<BusinessState>()(
  persist(
    (set) => ({
      activeKey: BUSINESSES[0].key,
      setActive: (activeKey) => set({ activeKey }),
    }),
    { name: "pgh-business" },
  ),
);

export const useActiveBusiness = (): Business => {
  const key = useBusinessStore((s) => s.activeKey);
  return BUSINESSES.find((b) => b.key === key) ?? BUSINESSES[0];
};
