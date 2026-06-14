import { Menu, Search, Bell, Sun, Moon } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useUiStore } from "@/stores/ui";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { MODULES } from "@/lib/modules";
import { IconButton } from "@/components/ui/primitives";
import { ClockWidget } from "./ClockWidget";

/** Sticky top bar (canon §3.2): module title+desc · clock-in · ⌘K search · bell · theme. */
export function TopBar() {
  const { pathname } = useLocation();
  const { setMobileSidebarOpen, setPaletteOpen, theme, toggleTheme } = useUiStore();
  const isDesktop = useIsDesktop();

  const mod = MODULES.find((m) => pathname.startsWith(m.route));
  const title = pathname === "/" ? "Hub" : mod?.label ?? "Hub";
  const desc = pathname === "/" ? "Your command center" : mod?.description ?? "";

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3.5 p-[12px_30px] glass border-b max-md:p-[10px_16px]">
      {!isDesktop && (
        <IconButton onClick={() => setMobileSidebarOpen(true)} aria-label="Menu">
          <Menu className="w-[18px]" />
        </IconButton>
      )}
      <div className="min-w-0">
        <h1 className="font-display text-[21px] font-medium leading-tight truncate max-md:text-lg">{title}</h1>
        <div className="text-[11.5px] text-text-faint max-md:hidden">{desc}</div>
      </div>

      <div className="ml-auto flex items-center gap-2.5">
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex items-center gap-2.5 h-[38px] w-[min(300px,34vw)] px-[13px] rounded-[11px] bg-text-primary/[0.05] border border-transparent text-text-faint text-[12.5px] transition-all hover:bg-text-primary/[0.08] hover:border-accent/30 max-md:w-[38px] max-md:px-0 max-md:justify-center"
        >
          <Search className="w-[15px]" />
          <span className="max-md:hidden">Search Hub…</span>
          <kbd className="ml-auto font-mono text-[10px] border border-line rounded-md px-1.5 py-px max-md:hidden">⌘K</kbd>
        </button>
        <ClockWidget compact={!isDesktop} />
        <IconButton dot aria-label="Notifications">
          <Bell className="w-[18px]" />
        </IconButton>
        <IconButton onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? <Sun className="w-[18px]" /> : <Moon className="w-[18px]" />}
        </IconButton>
      </div>
    </header>
  );
}
