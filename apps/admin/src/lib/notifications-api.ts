/**
 * Notifications API client + TanStack Query hooks.
 * All calls go to /api/v1/notifications; brand filtering passed via
 * ?business= so cross-brand count is possible for multi-brand users.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore, useBusinesses } from "@/stores/business";

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotifPriority = "low" | "normal" | "high" | "urgent";

export type NotifType =
  | "stock_alert"
  | "payment_due"
  | "approval_required"
  | "delivery_update"
  | "task_due"
  | "message"
  | "system"
  | "discount_approval"
  | "leave_request"
  | "production_state_change"
  | "stylist_offer"
  | "stylist_assignment_accepted"
  | "subscription_billing_failed"
  | "intercompany_reconciliation_alert"
  | "order_status_change"
  | "low_stock_warning"
  | "sale_campaign_milestone";

export interface AppNotification {
  notification_id: string;
  user_id: string;
  business: string | null;
  type: NotifType | string;
  priority: NotifPriority;
  title: string;
  body: string | null;
  reference_type: string | null;
  reference_id: string | null;
  action_url: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface NotifList {
  data: AppNotification[];
  page: number;
  page_size: number;
  total: number;
}

export interface NotifPref {
  pref_id: string;
  user_id: string;
  notification_type: string;
  in_app: boolean;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  sms_enabled: boolean;
  push_enabled: boolean;
  updated_at: string;
}

// ── Type meta (icons, labels, categories) ────────────────────────────────────

export const NOTIF_META: Record<
  string,
  { label: string; category: "approvals" | "sales" | "stock" | "ops" | "system" }
> = {
  approval_required:               { label: "Approval required",          category: "approvals" },
  discount_approval:               { label: "Discount approval",           category: "approvals" },
  leave_request:                   { label: "Leave request",               category: "approvals" },
  intercompany_reconciliation_alert:{ label: "Intercompany alert",         category: "approvals" },
  order_status_change:             { label: "Order status change",         category: "sales" },
  payment_due:                     { label: "Payment due",                 category: "sales" },
  subscription_billing_failed:     { label: "Billing failed",              category: "sales" },
  sale_campaign_milestone:         { label: "Campaign milestone",          category: "sales" },
  stock_alert:                     { label: "Stock alert",                 category: "stock" },
  low_stock_warning:               { label: "Low stock warning",           category: "stock" },
  production_state_change:         { label: "Production state change",     category: "stock" },
  delivery_update:                 { label: "Delivery update",             category: "ops" },
  task_due:                        { label: "Task due",                    category: "ops" },
  message:                         { label: "Message",                     category: "ops" },
  stylist_offer:                   { label: "Stylist offer",               category: "ops" },
  stylist_assignment_accepted:     { label: "Stylist accepted",            category: "ops" },
  system:                          { label: "System",                      category: "system" },
};

export const NOTIF_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(NOTIF_META).map(([k, v]) => [k, v.label]),
);

// ── Raw API fns ───────────────────────────────────────────────────────────────

export async function fetchNotifications(params: {
  business?: string | null;
  unread?: boolean;
  page?: number;
  page_size?: number;
}): Promise<NotifList> {
  const qs = new URLSearchParams();
  if (params.business) qs.set("business", params.business);
  if (params.unread) qs.set("unread", "true");
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  const q = qs.toString();
  return api.get<NotifList>(`/notifications${q ? `?${q}` : ""}`);
}

export async function fetchUnreadCount(business?: string | null): Promise<number> {
  const qs = business ? `?business=${business}` : "";
  const res = await api.get<{ unread: number }>(`/notifications/unread-count${qs}`);
  return res.unread;
}

export async function markReadApi(id: string): Promise<void> {
  await api.post(`/notifications/${id}/read`);
}

export async function markAllReadApi(business?: string | null): Promise<void> {
  await api.post("/notifications/read-all", business ? { business } : undefined);
}

export async function deleteNotifApi(id: string): Promise<void> {
  await api.delete(`/notifications/${id}`);
}

export async function bulkDeleteApi(ids: string[]): Promise<void> {
  // DELETE with a body — use raw fetch since api.delete() doesn't accept a body.
  const { getAccessToken } = await import("@/lib/api");
  const brand = (() => {
    try {
      const raw = localStorage.getItem("pgh-business");
      return raw ? (JSON.parse(raw) as { state?: { activeKey?: string } })?.state?.activeKey ?? null : null;
    } catch {
      return null;
    }
  })();
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (brand) headers["X-Brand-Context"] = brand;
  await fetch("/api/v1/notifications/bulk", {
    method: "DELETE",
    headers,
    credentials: "include",
    body: JSON.stringify({ ids }),
  });
}

export async function bulkMarkReadApi(ids: string[]): Promise<void> {
  await Promise.all(ids.map((id) => api.post(`/notifications/${id}/read`)));
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useActiveBrand() {
  return useBusinessStore((s) => s.activeKey);
}

/** True if the authenticated user has access to more than one business. */
function useIsMultiBrand(): boolean {
  const businesses = useBusinesses();
  return businesses.length > 1;
}

/**
 * The business key to filter notifications by.
 * Single-brand users: active brand key.
 * Multi-brand users: null (all businesses — total cross-brand count).
 */
export function useNotifBusiness(): string | null {
  const activeKey = useActiveBrand();
  const isMulti = useIsMultiBrand();
  return isMulti ? null : activeKey;
}

/** Paginated list (for the full /notifications page). */
export function useNotifications(params: { unread?: boolean; page?: number; page_size?: number } = {}) {
  const business = useNotifBusiness();
  return useQuery({
    queryKey: ["notifications", business, params],
    queryFn: () => fetchNotifications({ business, ...params }),
    staleTime: 30_000,
  });
}

/** Small feed for the bell dropdown (20 most recent). */
export function useNotifFeed() {
  const business = useNotifBusiness();
  return useQuery({
    queryKey: ["notifications:feed", business],
    queryFn: () => fetchNotifications({ business, page_size: 20 }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/** Unread badge count. */
export function useUnreadCount(): number {
  const business = useNotifBusiness();
  const { data } = useQuery({
    queryKey: ["notifications:unread", business],
    queryFn: () => fetchUnreadCount(business),
    staleTime: 20_000,
    refetchInterval: 45_000,
  });
  return data ?? 0;
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markReadApi,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllRead() {
  const business = useNotifBusiness();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllReadApi(business),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useDeleteNotif() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteNotifApi,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useBulkDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: bulkDeleteApi,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useBulkMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: bulkMarkReadApi,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

// ── Preferences hooks ─────────────────────────────────────────────────────────

export function useNotifPrefs() {
  return useQuery({
    queryKey: ["notifications:prefs"],
    queryFn: () => api.get<NotifPref[]>("/notifications/preferences"),
    staleTime: 60_000,
  });
}

export function useUpsertNotifPref() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      notification_type,
      ...body
    }: Partial<NotifPref> & { notification_type: string }) =>
      api.put(`/notifications/preferences/${notification_type}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications:prefs"] }),
  });
}
