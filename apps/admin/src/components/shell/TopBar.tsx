import { Menu, Search, Sun, Moon } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useUiStore } from "@/stores/ui";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { MODULES } from "@/lib/modules";
import { ClockWidget } from "./ClockWidget";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useState } from "react";
import { useAuthStore } from "@/stores/auth";
import { initials } from "@/lib/format";
import { ProfileDrawer } from "@/components/profile/ProfileDrawer";

/** Sticky top bar (canon §3.2): module title+desc · clock-in · ⌘K search · bell · theme. */
export function TopBar() {
  const { pathname } = useLocation();
  const { setMobileSidebarOpen, setPaletteOpen, theme, toggleTheme } = useUiStore();
  const isDesktop = useIsDesktop();
  const user = useAuthStore((s) => s.user);
  const [profileOpen, setProfileOpen] = useState(false);

  const mod = MODULES.find((m) => pathname.startsWith(m.route));
  const title = pathname === "/" ? "Hub" : mod?.label ?? "Hub";
  const desc = pathname === "/" ? "Your command center" : mod?.description ?? "";

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3.5 p-[12px_30px] glass border-b max-md:p-[10px_16px]">
        {!isDesktop && (
          <button
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Menu"
            className="grid place-items-center w-[38px] h-[38px] rounded-[11px] bg-text-primary/[0.05] text-text-muted hover:bg-text-primary/10 hover:text-text-primary transition-all"
          >
            <Menu className="w-[18px]" />
          </button>
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
          <NotificationBell />
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="grid place-items-center w-[38px] h-[38px] rounded-[11px] bg-text-primary/[0.05] text-text-muted hover:bg-text-primary/10 hover:text-text-primary transition-all"
          >
            {theme === "dark" ? <Sun className="w-[18px]" /> : <Moon className="w-[18px]" />}
          </button>
          {!isDesktop && user && (
            <button
              aria-label="Account"
              onClick={() => setProfileOpen(true)}
              className="w-[38px] h-[38px] rounded-full grid place-items-center font-display font-semibold text-[13px] text-white bg-[linear-gradient(140deg,var(--biz-1),var(--biz-2))] shrink-0"
            >
              {initials(user.name)}
            </button>
          )}
        </div>
      </header>
      <ProfileDrawer open={profileOpen} onClose={() => setProfileOpen(false)} />
    </>
  );
}
