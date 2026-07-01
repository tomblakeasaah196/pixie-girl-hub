import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/lib/theme";

/**
 * Accessible theme toggle. Both icons are always present; CSS (.dark) shows the
 * correct one so the button is hydration-safe even before JS state initialises.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, mounted, toggle } = useTheme();
  const isDark = mounted ? theme === "dark" : undefined;
  const label =
    isDark === undefined
      ? "Toggle colour theme"
      : isDark
        ? "Switch to light mode"
        : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      aria-pressed={isDark ?? false}
      suppressHydrationWarning
      className={`group relative inline-flex h-11 w-11 -m-2 items-center justify-center rounded-full text-taupe hover:text-cream transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/70 focus-visible:ring-offset-2 focus-visible:ring-offset-ink ${className}`}
    >
      <Sun
        size={16}
        strokeWidth={1.6}
        aria-hidden="true"
        className="absolute hidden dark:block transition-transform duration-300 ease-out group-hover:rotate-12"
      />
      <Moon
        size={16}
        strokeWidth={1.6}
        aria-hidden="true"
        className="absolute dark:hidden transition-transform duration-300 ease-out group-hover:-rotate-12"
      />
    </button>
  );
}
