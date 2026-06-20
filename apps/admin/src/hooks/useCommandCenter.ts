/**
 * Data hooks for the Command Center (canon §3.3).
 *
 * Endpoints used:
 *   GET /dashboards/overview        → KPIs + ops + insight counts + latest_briefing
 *   GET /insights/summary           → categorical alert counts (urgent)
 *   GET /notifications              → recent system notifications
 *   GET /notifications/unread-count → bell badge
 *   GET /audit/my-feed              → the caller's own actions in the last 24 h
 *
 * All queries are scoped to the active business via X-Brand-Context (the api
 * client attaches it automatically). Each key includes the active business key
 * so switching entity invalidates and refetches.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DashboardOverview {
  period: { from: string; to: string };
  sales: {
    paid_orders: number;
    revenue_ngn: string;
    pending_orders: number;
    outstanding_ngn: string;
  };
  operations: {
    jobs_pending: number;
    jobs_in_progress: number;
    deliveries_active: number;
    deliveries_failed: number;
  };
  insights: {
    stock: { open: number; urgent: number };
    margin: { open: number; urgent: number };
    invoice: { open: number; urgent: number };
    intercompany: { open: number; urgent: number };
    attendance: { open: number; urgent: number };
    approval: { open: number; urgent: number };
    service_match: { open: number; urgent: number };
  };
  latest_briefing: {
    briefing_id: string;
    briefing_text: string;
    insight_count: number;
    scheduled_for: string;
    read_at: string | null;
  } | null;
}

export interface InsightSummary {
  stock: { open: number; urgent: number };
  margin: { open: number; urgent: number };
  invoice: { open: number; urgent: number };
  intercompany: { open: number; urgent: number };
  attendance: { open: number; urgent: number };
  approval: { open: number; urgent: number };
  service_match: { open: number; urgent: number };
}

export interface AppNotification {
  notification_id: string;
  type: string;
  priority: "low" | "normal" | "high" | "urgent";
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
}

export interface AuditFeedEntry {
  log_id: string;
  occurred_at: string;
  module: string;
  action: string;
  table_name: string;
  record_id: string | null;
  metadata: Record<string, unknown> | null;
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Dashboard KPIs + ops + insight counts + latest AI briefing. */
export function useDashboardOverview() {
  const biz = useBusinessStore((s) => s.activeKey);
  return useQuery({
    queryKey: ["dashboard", "overview", biz],
    queryFn: () => api.get<DashboardOverview>("/dashboards/overview"),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/** Categorical AI insight counts (urgent alerts). */
export function useInsightSummary() {
  const biz = useBusinessStore((s) => s.activeKey);
  return useQuery({
    queryKey: ["insights", "summary", biz],
    queryFn: () => api.get<InsightSummary>("/insights/summary"),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/** Recent system notifications (last 10). */
export function useRecentNotifications() {
  const biz = useBusinessStore((s) => s.activeKey);
  return useQuery({
    queryKey: ["notifications", "recent", biz],
    queryFn: () =>
      api.get<{ data: AppNotification[] }>("/notifications?page_size=10"),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: 1,
  });
}

/** Unread notifications count. */
export function useUnreadCount() {
  const biz = useBusinessStore((s) => s.activeKey);
  return useQuery({
    queryKey: ["notifications", "unread-count", biz],
    queryFn: () => api.get<{ unread: number }>("/notifications/unread-count"),
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
    retry: 1,
  });
}

/** The caller's own actions in the last 24 h. */
export function useMyAuditFeed() {
  const biz = useBusinessStore((s) => s.activeKey);
  return useQuery({
    queryKey: ["audit", "my-feed", biz],
    queryFn: () =>
      api.get<{ data: AuditFeedEntry[]; window: "24h" | "all_time" }>(
        "/audit/my-feed",
      ),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    retry: 1,
  });
}

/** Mark a single notification read. */
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  const biz = useBusinessStore((s) => s.activeKey);
  return useMutation({
    mutationFn: (id: string) => api.post<unknown>(`/notifications/${id}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "recent", biz] });
      qc.invalidateQueries({
        queryKey: ["notifications", "unread-count", biz],
      });
    },
  });
}

/** Mark all notifications read. */
export function useMarkAllRead() {
  const qc = useQueryClient();
  const biz = useBusinessStore((s) => s.activeKey);
  return useMutation({
    mutationFn: () => api.post<unknown>("/notifications/read-all"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "recent", biz] });
      qc.invalidateQueries({
        queryKey: ["notifications", "unread-count", biz],
      });
    },
  });
}

/** Total urgent insight count across all categories. */
export function urgentCount(summary: InsightSummary | undefined): number {
  if (!summary) return 0;
  return Object.values(summary).reduce(
    (acc, cat) => acc + (cat?.urgent ?? 0),
    0,
  );
}

/** Total open insight count across all categories. */
export function openCount(summary: InsightSummary | undefined): number {
  if (!summary) return 0;
  return Object.values(summary).reduce((acc, cat) => acc + (cat?.open ?? 0), 0);
}
