import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_TOP, MODULES, TOP_LIMIT } from "@/lib/modules";

/**
 * Navigation priority — the user's resolved top-10. Drives BOTH the App Grid
 * and the sidebar "Priority" list so they never disagree (canon §3.1, §3.3).
 * Drag-to-reorder, pin/unpin. Dashboard is anchored (always first, never moved).
 */
interface NavState {
  top: string[]; // ordered module keys, dashboard first
  reorder: (keys: string[]) => void;
  pin: (key: string) => string | null; // returns dropped key if grid was full
  unpin: (key: string) => void;
  resetToDefault: () => void;
}

const ANCHOR = "dashboard";

function normalize(keys: string[]): string[] {
  const valid = keys.filter((k) => MODULES.some((m) => m.key === k) && k !== ANCHOR);
  return [ANCHOR, ...valid];
}

export const useNavStore = create<NavState>()(
  persist(
    (set, get) => ({
      top: normalize(DEFAULT_TOP),
      reorder: (keys) => set({ top: normalize(keys) }),
      pin: (key) => {
        const top = get().top.slice();
        if (top.includes(key)) return null;
        let dropped: string | null = null;
        if (top.length >= TOP_LIMIT) dropped = top.pop() ?? null;
        top.push(key);
        set({ top: normalize(top) });
        return dropped;
      },
      unpin: (key) => {
        if (key === ANCHOR) return;
        set({ top: get().top.filter((k) => k !== key) });
      },
      resetToDefault: () => set({ top: normalize(DEFAULT_TOP) }),
    }),
    { name: "pgh-nav" },
  ),
);

/** Keys not in the top grid, in catalogue order — the "More" set. */
export function moreKeys(top: string[]): string[] {
  return MODULES.map((m) => m.key).filter((k) => !top.includes(k));
}
