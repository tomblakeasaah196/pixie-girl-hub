import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "dark" | "light";
type Density = "comfortable" | "compact";

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
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setDensity: (d: Density) => void;
  toggleSidebar: () => void;
  setMobileSidebarOpen: (v: boolean) => void;
  setPaletteOpen: (v: boolean) => void;
  setAppMenuOffset: (o: { x: number; y: number }) => void;
  setSwitchingToBiz: (key: string | null) => void;
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
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === "dark" ? "light" : "dark" }),
      setDensity: (density) => set({ density }),
      toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
      setMobileSidebarOpen: (mobileSidebarOpen) => set({ mobileSidebarOpen }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setAppMenuOffset: (appMenuOffset) => set({ appMenuOffset }),
      setSwitchingToBiz: (switchingToBiz) => set({ switchingToBiz }),
    }),
    {
      name: "pgh-ui",
      partialize: (s) => ({
        theme: s.theme,
        density: s.density,
        sidebarCollapsed: s.sidebarCollapsed,
        appMenuOffset: s.appMenuOffset,
      }),
    },
  ),
);
