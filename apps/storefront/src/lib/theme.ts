import { useEffect, useState } from "react";

/**
 * Dark-first theme. `<html>` gets `.dark` by default (set by the SSR boot script
 * in __root). Toggling flips `.dark`/`.light` and persists to `sf_theme`.
 */
export function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setTheme(
      document.documentElement.classList.contains("light") ? "light" : "dark",
    );
  }, []);

  const toggle = () => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      const d = document.documentElement;
      d.classList.toggle("dark", next === "dark");
      d.classList.toggle("light", next === "light");
      try {
        localStorage.setItem("sf_theme", next);
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return { theme, mounted, toggle };
}
