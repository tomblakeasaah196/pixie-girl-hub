/**
 * NotificationBell — the bell icon button in the TopBar with live badge.
 * On desktop: opens/closes a glass dropdown panel.
 * On mobile: opens a bottom sheet.
 */

import { useRef, useEffect } from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/cn";
import { useNotifStore } from "@/stores/notifications";
import { useUnreadCount } from "@/lib/notifications-api";
import { NotificationsPanel } from "./NotificationsPanel";
import { NotificationBottomSheet } from "./NotificationBottomSheet";
import { useIsDesktop } from "@/hooks/useMediaQuery";

export function NotificationBell() {
  const { panelOpen, setPanelOpen, togglePanel } = useNotifStore();
  const unread = useUnreadCount();
  const isDesktop = useIsDesktop();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click (desktop panel only).
  useEffect(() => {
    if (!panelOpen || !isDesktop) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [panelOpen, isDesktop, setPanelOpen]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={togglePanel}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
        aria-expanded={panelOpen}
        className={cn(
          "relative grid place-items-center w-[38px] h-[38px] rounded-[11px]",
          "bg-text-primary/[0.05] text-text-muted transition-all duration-300",
          "hover:bg-text-primary/10 hover:text-text-primary",
          panelOpen && "bg-accent/10 text-accent",
        )}
      >
        <Bell className="w-[18px]" />
        {unread > 0 && (
          <span
            aria-hidden
            className={cn(
              "absolute top-[7px] right-[7px] min-w-[16px] h-[16px] rounded-full",
              "flex items-center justify-center",
              "bg-accent text-[#F4E9D9] text-[9px] font-bold leading-none px-[3px]",
              "shadow-[0_0_0_2px_rgb(var(--bg))]",
              "transition-transform",
              unread > 0 && "animate-[scale-in_0.2s_ease-out]",
            )}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {panelOpen && isDesktop && (
        <NotificationsPanel onClose={() => setPanelOpen(false)} />
      )}
      {panelOpen && !isDesktop && (
        <NotificationBottomSheet onClose={() => setPanelOpen(false)} />
      )}
    </div>
  );
}
