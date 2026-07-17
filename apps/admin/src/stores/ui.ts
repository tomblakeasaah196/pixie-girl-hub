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
  /**
   * Personal palette override (canon §2.3 Layer A, per-user). Holds the name
   * of a preset from `@/lib/theme-presets`, or null to follow whatever the
   * admin set as the platform default. Client-side only — like `theme`, this
   * is a per-device comfort preference, not a shared/white-label setting, so
   * it never touches the platform logo, fonts, or product identity.
   */
  themePreset: string | null;
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
  /**
   * Full-bleed mode: a route has taken over the whole viewport (e.g. an
   * open conversation on mobile Messaging) and wants the shell to stop
   * rendering its own chrome — top bar, breadcrumb, bottom nav, floating
   * launcher — around it. Not persisted; a page sets it while mounted in
   * that state and clears it on the way out.
   */
  immersive: boolean;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setThemePreset: (name: string | null) => void;
  setDensity: (d: Density) => void;
  toggleSidebar: () => void;
  setMobileSidebarOpen: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  setImmersive: (v: boolean) => void;
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
      themePreset: null,
      sidebarCollapsed: false,
      mobileSidebarOpen: false,
      paletteOpen: false,
      appMenuOffset: { x: 0, y: 0 },
      switchingToBiz: null,
      paletteRecents: [],
      paletteRecentQueries: [],
      immersive: false,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () =>
        set({ theme: get().theme === "dark" ? "light" : "dark" }),
      setThemePreset: (themePreset) => set({ themePreset }),
      setDensity: (density) => set({ density }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setImmersive: (immersive) => set({ immersive }),
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
        themePreset: s.themePreset,
        sidebarCollapsed: s.sidebarCollapsed,
        appMenuOffset: s.appMenuOffset,
        paletteRecents: s.paletteRecents,
        paletteRecentQueries: s.paletteRecentQueries,
      }),
    },
  ),
);
