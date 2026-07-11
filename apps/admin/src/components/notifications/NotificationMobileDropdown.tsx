/**
 * NotificationMobileDropdown — mobile variant of the bell dropdown.
 *
 * Drops DOWN from directly beneath the bell, as a near-full-width glass card
 * (a right-aligned 400px card from the tablet tier up).
 *
 * Why portal to <body>: the bell lives inside the sticky TopBar `<header>`,
 * which carries a `.glass` `backdrop-filter`. A `backdrop-filter` ancestor
 * becomes the containing block for `position: fixed` descendants, so a fixed
 * panel rendered in place would be trapped inside the ~58px-tall header box
 * (only its footer peeking out — the "just the View all button" bug). Portaling
 * to <body> escapes that containing block so `fixed` resolves against the
 * viewport. Same fix documented in `components/ui/Drawer.tsx`.
 */

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  X,
  CheckCheck,
  ArrowRight,
  AlertTriangle,
  DollarSign,
  Package,
  CheckCircle,
  Info,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  useNotifFeed,
  useMarkRead,
  useMarkAllRead,
  type AppNotification,
} from "@/lib/notifications-api";

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function NotifIcon({ type }: { type: string }) {
  const cls = "w-4 h-4 shrink-0 mt-0.5";
  if (type.includes("approval") || type.includes("leave"))
    return <AlertTriangle className={cn(cls, "text-warn")} />;
  if (
    type.includes("payment") ||
    type.includes("billing") ||
    type.includes("order")
  )
    return <DollarSign className={cn(cls, "text-success")} />;
  if (type.includes("stock") || type.includes("production"))
    return <Package className={cn(cls, "text-accent-glow")} />;
  if (type.includes("complete") || type.includes("accepted"))
    return <CheckCircle className={cn(cls, "text-success")} />;
  return <Info className={cn(cls, "text-accent")} />;
}

interface Props {
  /** The bell's wrapper — the dropdown drops down from just below it. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function NotificationMobileDropdown({ anchorRef, onClose }: Props) {
  const navigate = useNavigate();
  const { data, isLoading } = useNotifFeed();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  // Anchor the panel just beneath the bell. Measured from the live rect so it
  // tracks the TopBar's real height (no hardcoded offset) and stays correct
  // across orientation / resize.
  const [top, setTop] = useState(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    return (r?.bottom ?? 56) + 8;
  });
  useLayoutEffect(() => {
    const measure = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (r) setTop(r.bottom + 8);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchorRef]);

  // Close on Escape.
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const all = data?.data ?? [];
  const unreadCount = all.filter((n) => !n.is_read).length;

  function handleClick(n: AppNotification) {
    if (!n.is_read) markRead.mutate(n.notification_id);
    onClose();
    navigate(n.action_url ?? "/notifications");
  }

  return createPortal(
    <>
      {/* Transparent scrim — tap anywhere outside to dismiss. Kept clear (no
          dark backdrop) so this reads as a dropdown, not a modal sheet. */}
      <div
        className="fixed inset-0 z-[90]"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel — full-width with side gutters on phone; a right-aligned 400px
          card from the tablet tier (sm) up. */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-label="Notifications"
        style={{ top }}
        className={cn(
          "fixed left-3 right-3 sm:left-auto sm:w-[400px] z-[91]",
          "max-h-[72vh] flex flex-col overflow-hidden",
          "dropglass rounded-[18px]",
          "animate-[slide-up_0.2s_ease-out]",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b hairline shrink-0">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-accent" />
            <span className="text-[14px] font-semibold text-text-primary">
              Notifications
            </span>
            {unreadCount > 0 && (
              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold text-accent">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                onClick={() => markAll.mutate()}
                disabled={markAll.isPending}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-text-faint hover:text-text-primary transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" /> All read
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg text-text-faint hover:text-text-primary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body — `min-h-0` lets this flex child shrink below its content so
            `overflow-y-auto` scrolls instead of pushing the footer off. */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-3 p-5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="w-8 h-8 rounded-full bg-text-primary/[0.08] shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-text-primary/[0.08] rounded w-3/4" />
                    <div className="h-2 bg-text-primary/[0.06] rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : all.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <Bell className="w-10 h-10 text-text-faint/30 mb-3" />
              <p className="text-[14px] font-medium text-text-muted">
                You're all caught up
              </p>
              <p className="text-[12px] text-text-faint mt-1">
                No notifications right now
              </p>
            </div>
          ) : (
            all.map((n) => (
              <button
                key={n.notification_id}
                onClick={() => handleClick(n)}
                className={cn(
                  "w-full flex items-start gap-3 px-5 py-4 text-left transition-colors border-b hairline last:border-0",
                  !n.is_read && "bg-accent/[0.04]",
                )}
              >
                <span
                  className={cn(
                    "mt-[7px] w-2 h-2 rounded-full shrink-0",
                    n.is_read ? "bg-transparent" : "bg-accent",
                  )}
                />
                <NotifIcon type={n.type} />
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-[13px] leading-snug line-clamp-2",
                      n.is_read
                        ? "text-text-muted"
                        : "font-semibold text-text-primary",
                    )}
                  >
                    {n.title}
                  </p>
                  {n.body && (
                    <p className="text-[11.5px] text-text-faint mt-0.5 line-clamp-2 leading-relaxed">
                      {n.body}
                    </p>
                  )}
                  <p className="text-[11px] text-text-faint mt-1">
                    {relTime(n.created_at)}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t hairline px-5 py-3 shrink-0">
          <button
            onClick={() => {
              onClose();
              navigate("/notifications");
            }}
            className="w-full flex items-center justify-center gap-1.5 h-11 rounded-xl bg-accent/10 text-accent text-[13px] font-semibold hover:bg-accent/20 transition-colors"
          >
            View all notifications <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
