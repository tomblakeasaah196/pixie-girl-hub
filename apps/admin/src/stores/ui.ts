import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "dark" | "light";
type Density = "comfortable" | "compact";

/**
 * A record the user recently visited from ⌘K — used to render the empty-state
 * "Recent" list next time they open the palette. Client-side only: kept in
 * this browser, not synced across devices (v1 tradeoff).
 */
export interface PaletteRecent {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  route: string;
  visitedAt: number; // epoch ms
}

const RECENTS_LIMIT = 12;
const QUERY_HISTORY_LIMIT = 6;

interface UiState {
  theme: Theme;
  density: Density;
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  /** Command palette (⌘K) — not persisted. */
  paletteOpen: boolean;
  /** Persisted drag offset for the displaceable App-Menu pill (canon §3.4). */
  appMenuOffset: { x: number; y: number };
  /**
   * Business-switch overlay: set to the incoming business key for 5-7 seconds
   * while data + CSS re-paint; null = overlay hidden.
   */
  switchingToBiz: string | null;
  /** Most-recently-visited-from-palette records, newest first. */
  paletteRecents: PaletteRecent[];
  /** Most-recently-typed queries (deduped), newest first. */
  paletteRecentQueries: string[];
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setDensity: (d: Density) => void;
  toggleSidebar: () => void;
  setMobileSidebarOpen: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  setAppMenuOffset: (o: { x: number; y: number }) => void;
  setSwitchingToBiz: (key: string | null) => void;
  logPaletteVisit: (r: Omit<PaletteRecent, "visitedAt">) => void;
  logPaletteQuery: (q: string) => void;
  clearPaletteHistory: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      density: "comfortable",
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      paletteOpen: false,
      appMenuOffset: { x: 0, y: 0 },
      switchingToBiz: null,
      paletteRecents: [],
      paletteRecentQueries: [],
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set({ theme: get().theme === "dark" ? "light" : "dark" }),
      setDensity: (density) => set({ density }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setAppMenuOffset: (appMenuOffset) => set({ appMenuOffset }),
      setSwitchingToBiz: (switchingToBiz) => set({ switchingToBiz }),
      logPaletteVisit: (r) => {
        const now = Date.now();
        const prev = get().paletteRecents;
        // Dedupe by (type,id) — most recent wins.
        const next = [
          { ...r, visitedAt: now },
          ...prev.filter((x) => !(x.id === r.id && x.type === r.type)),
        ].slice(0, RECENTS_LIMIT);
        set({ paletteRecents: next });
      },
      logPaletteQuery: (q) => {
        const trimmed = q.trim();
        if (!trimmed) return;
        const prev = get().paletteRecentQueries;
        const next = [
          trimmed,
          ...prev.filter((x) => x.toLowerCase() !== trimmed.toLowerCase()),
        ].slice(0, QUERY_HISTORY_LIMIT);
        set({ paletteRecentQueries: next });
      },
      clearPaletteHistory: () =>
        set({ paletteRecents: [], paletteRecentQueries: [] }),
    }),
    {
      name: "pgh-ui",
      partialize: (s) => ({
        theme: s.theme,
        density: s.density,
        sidebarCollapsed: s.sidebarCollapsed,
        appMenuOffset: s.appMenuOffset,
        paletteRecents: s.paletteRecents,
        paletteRecentQueries: s.paletteRecentQueries,
      }),
    },
  ),
);
