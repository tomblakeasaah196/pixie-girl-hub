/**
 * NotificationBottomSheet — mobile variant of the bell dropdown.
 * Full-width sheet that slides up from the bottom, glass background,
 * swipe-down or tap-backdrop to close.
 */

import { useEffect, useRef } from "react";
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
  onClose: () => void;
}

export function NotificationBottomSheet({ onClose }: Props) {
  const navigate = useNavigate();
  const { data, isLoading } = useNotifFeed();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const sheetRef = useRef<HTMLDivElement>(null);

  const all = data?.data ?? [];
  const unreadCount = all.filter((n) => !n.is_read).length;

  // Close on Escape.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  function handleClick(n: AppNotification) {
    if (!n.is_read) markRead.mutate(n.notification_id);
    onClose();
    navigate(n.action_url ?? "/notifications");
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm animate-[fade-in_0.18s_ease-out]"
        onClick={onClose}
        aria-hidden
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-label="Notifications"
        className={cn(
          "fixed bottom-0 left-0 right-0 z-[91]",
          "dropglass rounded-t-[22px] max-h-[82vh] flex flex-col",
          "animate-[slide-up_0.25s_ease-out]",
          "safe-area-bottom",
        )}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-text-primary/20" />
        </div>

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

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
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
    </>
  );
}
