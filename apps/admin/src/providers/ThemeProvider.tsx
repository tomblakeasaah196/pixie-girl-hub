import { useEffect, type ReactNode } from "react";
import { useUiStore } from "@/stores/ui";
import { useActiveBusiness } from "@/stores/business";

/**
 * Applies the two-layer theme to the document (canon §2.3):
 *  - Layer A: data-theme / data-density on <html> (Maroon Noir tokens + presets).
 *  - Layer B: --biz-1/--biz-2/--biz-accent from the active business.
 * The mobile theme-color meta is kept in sync for PWA chrome.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUiStore((s) => s.theme);
  const density = useUiStore((s) => s.density);
  const biz = useActiveBusiness();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = density;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#0f0809" : "#fbfaf9");
  }, [theme, density]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--biz-1", biz.grad1);
    root.style.setProperty("--biz-2", biz.grad2);
    root.style.setProperty("--biz-accent", biz.accent);
  }, [biz.key, biz.grad1, biz.grad2, biz.accent]);

  return <>{children}</>;
}
