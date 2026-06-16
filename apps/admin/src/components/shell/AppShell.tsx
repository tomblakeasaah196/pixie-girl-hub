import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/stores/ui";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BreadcrumbStrip } from "./BreadcrumbStrip";
import { AppMenuFab } from "./AppMenuFab";
import { FloatingLauncher } from "./FloatingLauncher";
import { MobileBottomNav } from "./MobileBottomNav";
import { CommandPalette } from "@/components/search/CommandPalette";
import { BusinessSwitchOverlay } from "./BusinessSwitchOverlay";
import { NotificationManager } from "@/components/notifications/NotificationManager";
import { NotificationToastContainer } from "@/components/notifications/NotificationToast";
import { ChatDock } from "@/components/messaging/ChatDock";

/** The authenticated shell (canon §3): sidebar + sticky top bar + content,
 *  plus the global floating layer (App-Menu pill, launcher, mobile nav, ⌘K). */
export function AppShell() {
  const { sidebarCollapsed, setPaletteOpen, paletteOpen } = useUiStore();
  const isDesktop = useIsDesktop();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!useUiStore.getState().paletteOpen);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  return (
    <div className="h-screen overflow-hidden">
      <Sidebar />
      <div
        className={cn(
          "h-screen overflow-y-auto transition-[margin] duration-300 ease-brand",
          isDesktop ? (sidebarCollapsed ? "ml-[var(--side-c)]" : "ml-[var(--side-w)]") : "ml-0",
        )}
      >
        <TopBar />
        <BreadcrumbStrip />
        <div className="p-[26px_34px_120px] max-md:p-[20px_16px_96px]">
          <Outlet />
        </div>
      </div>

      <AppMenuFab />
      <FloatingLauncher />
      <ChatDock />
      <MobileBottomNav />
      {paletteOpen && <CommandPalette />}
      <BusinessSwitchOverlay />

      {/* Global notification layer */}
      <NotificationManager />
      <NotificationToastContainer />
    </div>
  );
}
