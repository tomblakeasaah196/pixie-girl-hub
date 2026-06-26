import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";
export const THEME_KEY = "faitlyn:theme";

/**
 * Inline script — runs in <head> BEFORE first paint to prevent FOUC and to
 * ensure the server-rendered markup (always theme-neutral) is upgraded to the
 * correct theme class before React hydrates. Reads stored choice; falls back
 * to system preference.
 */
export const themeBootstrapScript = `(function(){try{var k='${THEME_KEY}';var s=localStorage.getItem(k);var m=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=(s==='light'||s==='dark')?s:(m?'dark':'light');var r=document.documentElement;r.classList.toggle('dark',t==='dark');r.style.colorScheme=t;r.setAttribute('data-theme',t);}catch(e){}})();`;

type Ctx = {
  /** Current theme. `undefined` on the server and during the first client render to stay SSR-safe. */
  theme: Theme | undefined;
  /** True once the provider has read the actual theme from the DOM/localStorage on the client. */
  mounted: boolean;
  toggle: () => void;
  setTheme: (t: Theme) => void;
};

const ThemeCtx = createContext<Ctx>({
  theme: undefined,
  mounted: false,
  toggle: () => {},
  setTheme: () => {},
});

function readDomTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light" || attr === "dark") return attr;
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // SSR-safe: start undefined so server and first client render match.
  // The bootstrap script has already applied the correct class to <html>,
  // so visuals (which are CSS-driven via `.dark`) are correct from paint 1.
  const [theme, setThemeState] = useState<Theme | undefined>(undefined);
  const [mounted, setMounted] = useState(false);

  // Read the real theme after hydration.
  useEffect(() => {
    setThemeState(readDomTheme());
    setMounted(true);
  }, []);

  // Apply theme to <html> when it changes (no-op on first paint — bootstrap did it).
  useEffect(() => {
    if (!theme) return;
    const r = document.documentElement;
    r.classList.toggle("dark", theme === "dark");
    r.style.colorScheme = theme;
    r.setAttribute("data-theme", theme);
  }, [theme]);

  // Follow OS changes only when the user hasn't explicitly chosen.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (!localStorage.getItem(THEME_KEY)) setThemeState(e.matches ? "dark" : "light");
      } catch {}
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Sync across tabs/windows: storage events fire in OTHER tabs when one writes.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      const v = e.newValue;
      if (v === "light" || v === "dark") setThemeState(v);
      else setThemeState(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = (t: Theme) => {
    try { localStorage.setItem(THEME_KEY, t); } catch {}
    setThemeState(t);
  };

  const current = theme ?? "dark";
  return (
    <ThemeCtx.Provider
      value={{
        theme,
        mounted,
        toggle: () => setTheme(current === "dark" ? "light" : "dark"),
        setTheme,
      }}
    >
      {children}
    </ThemeCtx.Provider>
  );
}

export const useTheme = () => useContext(ThemeCtx);
