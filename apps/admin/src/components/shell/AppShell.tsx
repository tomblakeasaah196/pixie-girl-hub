import { lazy, Suspense, useCallback, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/cn";
import { moduleForPath, moduleIsPermitted } from "@/lib/modules";
import { useAuthStore } from "@/stores/auth";
import { DeniedState } from "@/components/ui/controls";
import { useUiStore } from "@/stores/ui";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BreadcrumbStrip } from "./BreadcrumbStrip";
import { PageTransition } from "./PageTransition";
import { RouteErrorBoundary } from "@/components/common/ErrorBoundary";
import { RouteFallback } from "@/components/common/RouteFallback";
import { PullToRefresh } from "./PullToRefresh";
import { AppMenuFab } from "./AppMenuFab";
import { FloatingLauncher } from "./FloatingLauncher";
import { MobileBottomNav } from "./MobileBottomNav";
import { BusinessSwitchOverlay } from "./BusinessSwitchOverlay";
import { NotificationManager } from "@/components/notifications/NotificationManager";
import { NotificationToastContainer } from "@/components/notifications/NotificationToast";
import { Toaster } from "@/components/feedback/Toaster";
import { IosInstallHint } from "./IosInstallHint";
import { PwaInstallBanner } from "./PwaInstallBanner";
import { PwaUpdateBanner } from "./PwaUpdateBanner";
import { OfflineIndicator } from "./OfflineIndicator";
import { EmailActivationBanner } from "./EmailActivationBanner";

// Global overlays that are mounted on every screen but closed at startup.
// Lazy so their (heavy) dependency trees — the tiptap editor behind the chat
// dock, WebRTC call UI, the Praxis drawer, ⌘K palette — download after first
// paint instead of inside the startup bundle. They render nothing while
// closed, so a null Suspense fallback is invisible.
const ChatDock = lazy(() =>
  import("@/components/messaging/ChatDock").then((m) => ({
    default: m.ChatDock,
  })),
);
const CallLayer = lazy(() =>
  import("@/components/calls/CallLayer").then((m) => ({
    default: m.CallLayer,
  })),
);
const PraxisDrawer = lazy(() =>
  import("@/components/praxis/PraxisDrawer").then((m) => ({
    default: m.PraxisDrawer,
  })),
);
const CommandPalette = lazy(() =>
  import("@/components/search/CommandPalette").then((m) => ({
    default: m.CommandPalette,
  })),
);

/**
 * Route-level RBAC guard: resolves the module owning the current path and
 * blocks it if the user lacks that module's permission. Defense-in-depth for
 * direct URL access (nav already hides the entry points); the API enforces
 * data access regardless. Waits for grants to resolve so it never flashes
 * "denied" during the post-login load window, and never gates un-permissioned
 * personal routes (Command Center, Workspace, Notifications).
 */
function GuardedOutlet() {
  const { pathname } = useLocation();
  const can = useAuthStore((s) => s.can);
  const isCeo = useAuthStore((s) => s.user?.isCeo);
  const permissionsLoaded = useAuthStore((s) => s.permissionsLoaded);
  const mod = moduleForPath(pathname);

  const blocked =
    !isCeo &&
    permissionsLoaded &&
    mod !== undefined &&
    !moduleIsPermitted(mod, can);

  if (blocked) {
    return (
      <DeniedState
        message={`You don't have access to ${mod!.label}. Ask an administrator to grant it in Org & Workflow → Permissions.`}
      />
    );
  }
  return <Outlet />;
}

/** The authenticated shell (canon §3): sidebar + sticky top bar + content,
 *  plus the global floating layer (App-Menu pill, launcher, mobile nav, ⌘K). */
export function AppShell() {
  const { sidebarCollapsed, setPaletteOpen, paletteOpen, immersive } =
    useUiStore();
  const isDesktop = useIsDesktop();
  const queryClient = useQueryClient();

  // Live-refresh Sales / Stock / Service-Jobs boards from backend realtime
  // signals (joins the active brand's rooms; invalidates on change).
  useRealtimeInvalidation();

  // Pull-to-refresh does a *soft* refresh: re-fetch the data currently on
  // screen (active queries) instead of reloading the whole document. An
  // accidental pull now costs a quick refetch, not a full reboot + 2s splash
  // + cache wipe. The deliberate hard refresh (cache clear + reload) still
  // lives on the top-bar button (desktop) and account menu (mobile).
  const softRefresh = useCallback(async () => {
    const started = Date.now();
    await queryClient.invalidateQueries();
    // Keep the sparkle visible for a beat even if the refetch resolves
    // instantly, so the gesture always feels acknowledged.
    const elapsed = Date.now() - started;
    if (elapsed < 450) {
      await new Promise((resolve) => setTimeout(resolve, 450 - elapsed));
    }
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
    <div className="h-screen supports-[height:100dvh]:h-dvh overflow-hidden">
      <Sidebar />
      <PullToRefresh
        onRefresh={softRefresh}
        className={cn(
          "h-screen supports-[height:100dvh]:h-dvh overflow-y-auto overflow-x-hidden transition-[margin] duration-300 ease-brand",
          isDesktop
            ? sidebarCollapsed
              ? "ml-[var(--side-c)]"
              : "ml-[var(--side-w)]"
            : "ml-0",
        )}
      >
        {/* Immersive mode (canon-adjacent: a route asked to take over the
            whole viewport, e.g. an open conversation on mobile Messaging) —
            the shell steps out entirely instead of just visually covering
            its chrome, so hidden controls don't linger in the tab order. */}
        {!immersive && (
          <>
            <TopBar />
            <OfflineIndicator />
            <PwaInstallBanner />
            <IosInstallHint />
            <EmailActivationBanner />
            <BreadcrumbStrip />
          </>
        )}
        {/* Centered content column on desktop (canon §3): caps at --content-max
            and gains side gutters on wide monitors instead of stretching
            edge-to-edge. The cap is wider than any phone/tablet, so this is a
            no-op below the desktop tier. Immersive routes opt out of the cap
            and padding — they manage their own full-bleed layout. */}
        <div
          className={
            immersive
              ? "h-full"
              : "mx-auto w-full min-w-0 max-w-[var(--content-max)] p-[26px_34px_120px] max-md:p-[20px_16px_96px]"
          }
        >
          <PageTransition>
            {/* One screen crashing must not take down the shell — the sidebar
                and top bar stay usable and the boundary resets on nav. */}
            <RouteErrorBoundary>
              {/* Single Suspense boundary for every lazy in-shell page: the
                  chunk downloads while the skeleton shows, keeping the shell
                  (sidebar/topbar) interactive throughout. */}
              <Suspense fallback={<RouteFallback />}>
                <GuardedOutlet />
              </Suspense>
            </RouteErrorBoundary>
          </PageTransition>
        </div>
      </PullToRefresh>

      {!immersive && (
        <>
          <AppMenuFab />
          <FloatingLauncher />
          <MobileBottomNav />
        </>
      )}
      <Suspense fallback={null}>
        <ChatDock />
        {/* WhatsApp calls ring globally — an agent shouldn't miss a customer
            because they were on the Sales board instead of Messaging. */}
        <CallLayer />
        <PraxisDrawer />
        {paletteOpen && <CommandPalette />}
      </Suspense>
      <BusinessSwitchOverlay />

      {/* Global notification layer */}
      <NotificationManager />
      <NotificationToastContainer />

      {/* App-wide save/publish feedback + JBS Praxis error reporting */}
      <Toaster />

      {/* In-app PWA update prompt (shows when a new build is waiting) */}
      <PwaUpdateBanner />
    </div>
  );
}
