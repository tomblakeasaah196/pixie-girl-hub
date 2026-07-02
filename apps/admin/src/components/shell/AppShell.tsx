import { useEffect, useCallback } from "react";
import { Outlet } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { useUiStore } from "@/stores/ui";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BreadcrumbStrip } from "./BreadcrumbStrip";
import { PageTransition } from "./PageTransition";
import { PullToRefresh } from "./PullToRefresh";
import { AppMenuFab } from "./AppMenuFab";
import { FloatingLauncher } from "./FloatingLauncher";
import { MobileBottomNav } from "./MobileBottomNav";
import { CommandPalette } from "@/components/search/CommandPalette";
import { BusinessSwitchOverlay } from "./BusinessSwitchOverlay";
import { NotificationManager } from "@/components/notifications/NotificationManager";
import { NotificationToastContainer } from "@/components/notifications/NotificationToast";
import { ChatDock } from "@/components/messaging/ChatDock";
import { PraxisDrawer } from "@/components/praxis/PraxisDrawer";
import { IosInstallHint } from "./IosInstallHint";
import { PwaInstallBanner } from "./PwaInstallBanner";
import { OfflineIndicator } from "./OfflineIndicator";

/** The authenticated shell (canon §3): sidebar + sticky top bar + content,
 *  plus the global floating layer (App-Menu pill, launcher, mobile nav, ⌘K). */
export function AppShell() {
  const { sidebarCollapsed, setPaletteOpen, paletteOpen } = useUiStore();
  const isDesktop = useIsDesktop();
  const queryClient = useQueryClient();

  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries();
  }, [queryClient]);

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
      <PullToRefresh
        onRefresh={handleRefresh}
        className={cn(
          "h-screen overflow-y-auto transition-[margin] duration-300 ease-brand",
          isDesktop
            ? sidebarCollapsed
              ? "ml-[var(--side-c)]"
              : "ml-[var(--side-w)]"
            : "ml-0",
        )}
      >
        <TopBar />
        <OfflineIndicator />
        <PwaInstallBanner />
        <IosInstallHint />
        <BreadcrumbStrip />
        {/* Centered content column on desktop (canon §3): caps at --content-max
            and gains side gutters on wide monitors instead of stretching
            edge-to-edge. The cap is wider than any phone/tablet, so this is a
            no-op below the desktop tier. */}
        <div className="mx-auto w-full max-w-[var(--content-max)] p-[26px_34px_120px] max-md:p-[20px_16px_96px]">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </div>
      </PullToRefresh>

      <AppMenuFab />
      <FloatingLauncher />
      <ChatDock />
      <PraxisDrawer />
      <MobileBottomNav />
      {paletteOpen && <CommandPalette />}
      <BusinessSwitchOverlay />

      {/* Global notification layer */}
      <NotificationManager />
      <NotificationToastContainer />
    </div>
  );
}
