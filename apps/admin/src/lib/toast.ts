/**
 * Thin convenience wrapper over the glass toast stack
 * (components/notifications/NotificationToast). Saves every call site from
 * hand-building the full AppNotification shape just to flash a success/error.
 *
 *   const toast = useToast();
 *   toast.success("Payout marked paid");
 *   toast.error("Couldn't save", err.message);
 */

import { useToastStore } from "@/components/notifications/NotificationToast";
import type { AppNotification } from "@/lib/notifications-api";

type Priority = AppNotification["priority"];

function fire(
  add: (n: AppNotification) => void,
  priority: Priority,
  type: string,
  title: string,
  body?: string,
) {
  add({
    notification_id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : String(Date.now()),
    user_id: "",
    business: null,
    type,
    priority,
    title,
    body: body ?? null,
    reference_type: null,
    reference_id: null,
    action_url: null,
    is_read: false,
    read_at: null,
    created_at: new Date().toISOString(),
  });
}

export function useToast() {
  const add = useToastStore((s) => s.add);
  return {
    success: (title: string, body?: string) =>
      fire(add, "normal", "success", title, body),
    error: (title: string, body?: string) =>
      fire(add, "high", "error", title, body),
    info: (title: string, body?: string) =>
      fire(add, "low", "info", title, body),
  };
}
