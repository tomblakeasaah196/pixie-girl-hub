/**
 * NotificationToast — glass toast stack (bottom-right).
 *
 * Urgent: stays until dismissed, red left-border.
 * High: 6 s auto-dismiss, amber border.
 * Normal: 4 s auto-dismiss, accent border.
 * Low: 3 s auto-dismiss, no border.
 *
 * Stacks up to 3. Clicking navigates to action_url.
 */

import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { X, AlertTriangle, Bell, Package, DollarSign, CheckCircle } from "lucide-react";
import { create } from "zustand";
import { cn } from "@/lib/cn";
import type { AppNotification } from "@/lib/notifications-api";

// ── Store ─────────────────────────────────────────────────────────────────────

interface ToastItem {
  id: string;
  notif: AppNotification;
}

interface ToastStore {
  items: ToastItem[];
  add: (notif: AppNotification) => void;
  remove: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  items: [],
  add: (notif) =>
    set((s) => {
      const id = notif.notification_id ?? String(Date.now());
      if (s.items.some((t) => t.id === id)) return s;
      const items = [{ id, notif }, ...s.items].slice(0, 3);
      return { items };
    }),
  remove: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function priorityBorder(p: string) {
  if (p === "urgent") return "border-l-[3px] border-l-danger";
  if (p === "high")   return "border-l-[3px] border-l-warn";
  if (p === "normal") return "border-l-[3px] border-l-accent";
  return "";
}

function NotifIcon({ type }: { type: string }) {
  const cls = "w-4 h-4 shrink-0";
  if (type.includes("approval") || type.includes("leave"))
    return <AlertTriangle className={cn(cls, "text-warn")} />;
  if (type.includes("payment") || type.includes("billing") || type.includes("order"))
    return <DollarSign className={cn(cls, "text-success")} />;
  if (type.includes("stock") || type.includes("production"))
    return <Package className={cn(cls, "text-accent-glow")} />;
  if (type.includes("complete") || type.includes("accepted"))
    return <CheckCircle className={cn(cls, "text-success")} />;
  return <Bell className={cn(cls, "text-accent")} />;
}

// ── Single toast ──────────────────────────────────────────────────────────────

function Toast({ item }: { item: ToastItem }) {
  const navigate = useNavigate();
  const remove = useToastStore((s) => s.remove);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { notif } = item;
  const p = notif.priority ?? "normal";
  const autoMs = p === "urgent" ? 0 : p === "high" ? 6000 : p === "low" ? 3000 : 4000;

  useEffect(() => {
    if (!autoMs) return;
    timer.current = setTimeout(() => remove(item.id), autoMs);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [autoMs, item.id, remove]);

  function handleClick() {
    remove(item.id);
    if (notif.action_url) navigate(notif.action_url);
    else navigate("/notifications");
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 w-[340px] max-sm:w-[calc(100vw-32px)]",
        "glass rounded-[14px] shadow-glass p-[13px_14px]",
        "animate-[slide-in-right_0.22s_ease-out]",
        priorityBorder(p),
      )}
    >
      <button
        onClick={handleClick}
        className="flex items-start gap-3 flex-1 min-w-0 text-left"
      >
        <span className="mt-0.5">
          <NotifIcon type={notif.type} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-text-primary leading-snug line-clamp-2">
            {notif.title}
          </p>
          {notif.body && (
            <p className="text-[11.5px] text-text-muted mt-0.5 line-clamp-2 leading-relaxed">
              {notif.body}
            </p>
          )}
        </div>
      </button>
      <button
        onClick={() => remove(item.id)}
        aria-label="Dismiss"
        className="shrink-0 p-1 -m-1 rounded-lg text-text-faint hover:text-text-primary transition-colors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Toast container ───────────────────────────────────────────────────────────

export function NotificationToastContainer() {
  const items = useToastStore((s) => s.items);
  if (!items.length) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2.5 max-sm:right-4 max-sm:bottom-20"
    >
      {items.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </div>
  );
}
