/**
 * NotificationsPanel — glass dropdown shown on desktop when the bell is clicked.
 * Features: grouped Today/Earlier, priority-tinted left border, inline
 * 'Mark all read', 'View all →' link to /notifications.
 */

import { useNavigate } from "react-router-dom";
import {
  Bell,
  X,
  CheckCheck,
  Package,
  DollarSign,
  AlertTriangle,
  CheckCircle,
  Info,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  useNotifFeed,
  useMarkRead,
  useMarkAllRead,
  type AppNotification,
} from "@/lib/notifications-api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();
}

function priorityBorder(p: string) {
  if (p === "urgent") return "border-l-[3px] border-l-danger";
  if (p === "high")   return "border-l-[3px] border-l-warn";
  return "";
}

function NotifIcon({ type }: { type: string }) {
  const cls = "w-4 h-4 shrink-0 mt-0.5";
  if (type.includes("approval") || type.includes("leave"))
    return <AlertTriangle className={cn(cls, "text-warn")} />;
  if (type.includes("payment") || type.includes("billing") || type.includes("order"))
    return <DollarSign className={cn(cls, "text-success")} />;
  if (type.includes("stock") || type.includes("production"))
    return <Package className={cn(cls, "text-accent-glow")} />;
  if (type.includes("complete") || type.includes("accepted"))
    return <CheckCircle className={cn(cls, "text-success")} />;
  return <Info className={cn(cls, "text-accent")} />;
}

// ── Item ──────────────────────────────────────────────────────────────────────

function NotifItem({
  n,
  onNavigate,
}: {
  n: AppNotification;
  onNavigate: (url: string | null) => void;
}) {
  const markRead = useMarkRead();
  function handleClick() {
    if (!n.is_read) markRead.mutate(n.notification_id);
    onNavigate(n.action_url);
  }
  return (
    <button
      onClick={handleClick}
      className={cn(
        "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors",
        "border-b hairline last:border-0",
        priorityBorder(n.priority),
        n.is_read
          ? "hover:bg-text-primary/[0.03]"
          : "bg-accent/[0.04] hover:bg-accent/[0.07]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-[7px] w-2 h-2 rounded-full shrink-0",
          n.is_read ? "bg-transparent" : "bg-accent",
        )}
      />
      <NotifIcon type={n.type} />
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-[12.5px] leading-snug line-clamp-2",
            n.is_read ? "text-text-muted" : "font-semibold text-text-primary",
          )}
        >
          {n.title}
        </p>
        {n.body && (
          <p className="text-[11px] text-text-faint mt-0.5 line-clamp-2 leading-relaxed">
            {n.body}
          </p>
        )}
        <p className="text-[10px] text-text-faint mt-1">{relTime(n.created_at)}</p>
      </div>
    </button>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export function NotificationsPanel({ onClose }: Props) {
  const navigate = useNavigate();
  const { data, isLoading } = useNotifFeed();
  const markAll = useMarkAllRead();

  const all = data?.data ?? [];
  const unreadCount = data?.total
    ? all.filter((n) => !n.is_read).length
    : 0;
  const today = all.filter((n) => isToday(n.created_at));
  const earlier = all.filter((n) => !isToday(n.created_at));

  function handleNavigate(url: string | null) {
    onClose();
    navigate(url ?? "/notifications");
  }

  return (
    <div
      className={cn(
        "absolute right-0 top-full mt-2 w-[380px] rounded-[18px] z-50 overflow-hidden",
        "dropglass animate-[slide-up_0.2s_ease-out]",
      )}
      role="dialog"
      aria-label="Notifications"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b hairline">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-accent" />
          <span className="text-[13.5px] font-semibold text-text-primary">
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
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-text-faint hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" /> All read
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-text-faint hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="max-h-[420px] overflow-y-auto">
        {isLoading ? (
          <div className="space-y-3 p-4">
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
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Bell className="w-8 h-8 text-text-faint/30 mb-3" />
            <p className="text-[13px] font-medium text-text-muted">You're all caught up</p>
            <p className="text-[11px] text-text-faint mt-1">No notifications right now</p>
          </div>
        ) : (
          <>
            {today.length > 0 && (
              <>
                <p className="micro px-4 pt-3 pb-1.5">Today</p>
                {today.map((n) => (
                  <NotifItem key={n.notification_id} n={n} onNavigate={handleNavigate} />
                ))}
              </>
            )}
            {earlier.length > 0 && (
              <>
                <p className="micro px-4 pt-3 pb-1.5">Earlier</p>
                {earlier.map((n) => (
                  <NotifItem key={n.notification_id} n={n} onNavigate={handleNavigate} />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t hairline px-4 py-2.5 flex items-center justify-between">
        <p className="text-[10px] text-text-faint">
          {all.length > 0 ? `Showing ${all.length} most recent` : ""}
        </p>
        <button
          onClick={() => { onClose(); navigate("/notifications"); }}
          className="flex items-center gap-1 text-[11.5px] text-accent hover:text-accent-glow transition-colors font-medium"
        >
          View all <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
