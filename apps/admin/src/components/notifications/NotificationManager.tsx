/**
 * NotificationManager — invisible component mounted once in AppShell.
 *
 * Responsibilities:
 * - Joins the user's socket.io notification room on mount
 * - Listens for pgh:notification:new window events
 * - Triggers toasts (unless DND active)
 * - Plays priority-aware sounds (unless DND active)
 * - Updates the browser tab title + favicon badge
 * - Registers the service worker for push notifications
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSocket } from "@/lib/socket";
import { rooms } from "@/lib/socket";
import { useAuthStore } from "@/stores/auth";
import { useNotifStore } from "@/stores/notifications";
import { useNotifBusiness } from "@/lib/notifications-api";
import { playOnce } from "@/lib/notif-sound";
import { registerServiceWorker, ensurePushSubscription } from "@/lib/push";
import { applyTabBadge } from "@/lib/tab-badge";
import { useUnreadCount } from "@/lib/notifications-api";
import { useToastStore } from "./NotificationToast";
import type { AppNotification } from "@/lib/notifications-api";

export function NotificationManager() {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const { isDndActive } = useNotifStore();
  const business = useNotifBusiness();
  const addToast = useToastStore((s) => s.add);
  const unread = useUnreadCount();

  // Update tab badge whenever unread count changes.
  useEffect(() => {
    applyTabBadge(unread);
  }, [unread]);

  // Register service worker and ensure push subscription on mount.
  useEffect(() => {
    registerServiceWorker().then(() => {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        ensurePushSubscription();
      }
    });
  }, []);

  // Join the user's notification socket room and handle incoming events.
  useEffect(() => {
    if (!userId) return;
    const socket = getSocket();
    const room = rooms.notifications(userId);
    socket.emit("join", room);

    const handler = (e: Event) => {
      const notif = (e as CustomEvent<AppNotification>).detail;
      if (!notif) return;

      // Refresh notification feed + unread count.
      qc.invalidateQueries({ queryKey: ["notifications"] });

      // Skip sounds/toasts during DND.
      if (isDndActive()) return;

      // Priority-aware sound (socket payload uses `id`; DB rows use `notification_id`).
      const soundId = (notif as { id?: string }).id ?? notif.notification_id ?? String(Date.now());
      playOnce(notif.priority ?? "normal", soundId);

      // Normalise socket payload to AppNotification shape for the toast.
      const socketPayload = notif as { id?: string; notification_id?: string } & typeof notif;
      const toastNotif = {
        ...notif,
        notification_id: socketPayload.notification_id ?? socketPayload.id ?? String(Date.now()),
      };
      addToast(toastNotif);
    };

    window.addEventListener("pgh:notification:new", handler);
    return () => {
      window.removeEventListener("pgh:notification:new", handler);
      socket.emit("leave", room);
    };
  }, [userId, qc, isDndActive, addToast, business]);

  return null;
}
