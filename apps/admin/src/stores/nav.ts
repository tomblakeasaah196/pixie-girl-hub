import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_TOP, MODULES, TOP_LIMIT } from "@/lib/modules";

/**
 * Navigation priority — the user's resolved top-10. Drives BOTH the App Grid
 * and the sidebar "Priority" list so they never disagree (canon §3.1, §3.3).
 * Drag-to-reorder, pin/unpin. Dashboard is anchored (always first, never moved).
 */

const BOTTOM_NAV_LIMIT = 4;
const DEFAULT_PINNED_BOTTOM: string[] = ["sales", "crm", "stock", "contacts"];

interface NavState {
  top: string[]; // ordered module keys, dashboard first
  /** User's pinned bottom-nav modules (max 4). */
  pinnedBottomNav: string[];
  reorder: (keys: string[]) => void;
  pin: (key: string) => string | null; // returns dropped key if grid was full
  unpin: (key: string) => void;
  resetToDefault: () => void;
  /** Pin a module to the mobile bottom nav bar. */
  pinToBottomNav: (key: string) => void;
  /** Unpin a module from the mobile bottom nav bar. */
  unpinFromBottomNav: (key: string) => void;
  /** Toggle pin state: pin if not pinned, unpin if already pinned. Returns true if pinned, false if unpinned. */
  toggleBottomNavPin: (key: string) => boolean;
}

const ANCHOR = "dashboard";

function normalize(keys: string[]): string[] {
  const valid = keys.filter((k) => MODULES.some((m) => m.key === k) && k !== ANCHOR);
  return [ANCHOR, ...valid];
}

function normalizeBottomNav(keys: string[]): string[] {
  return keys
    .filter((k) => MODULES.some((m) => m.key === k))
    .slice(0, BOTTOM_NAV_LIMIT);
}

export const useNavStore = create<NavState>()(
  persist(
    (set, get) => ({
      top: normalize(DEFAULT_TOP),
      pinnedBottomNav: normalizeBottomNav(DEFAULT_PINNED_BOTTOM),
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
      pinToBottomNav: (key) => {
        const current = get().pinnedBottomNav.slice();
        if (current.includes(key)) return;
        // If at limit, drop the oldest (first) entry
        if (current.length >= BOTTOM_NAV_LIMIT) current.shift();
        current.push(key);
        set({ pinnedBottomNav: normalizeBottomNav(current) });
      },
      unpinFromBottomNav: (key) => {
        set({ pinnedBottomNav: get().pinnedBottomNav.filter((k) => k !== key) });
      },
      toggleBottomNavPin: (key) => {
        const current = get().pinnedBottomNav;
        if (current.includes(key)) {
          get().unpinFromBottomNav(key);
          return false;
        }
        get().pinToBottomNav(key);
        return true;
      },
    }),
    {
      name: "pgh-nav",
      partialize: (s) => ({
        top: s.top,
        pinnedBottomNav: s.pinnedBottomNav,
      }),
    },
  ),
);

/** Keys not in the top grid, in catalogue order — the "More" set. */
export function moreKeys(top: string[]): string[] {
  return MODULES.map((m) => m.key).filter((k) => !top.includes(k));
}
