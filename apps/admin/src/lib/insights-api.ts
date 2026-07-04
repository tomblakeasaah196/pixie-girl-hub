/**
 * AI Insights — typed client + TanStack Query hooks (V2.2 §6.30 / §6.31).
 *
 * Mirrors `src/modules/ai_insights/insights.routes.js` (unified store):
 *   GET   /insights/summary               → per-module open/urgent counts
 *   GET   /insights?module=&status=&…     → the finding list
 *   GET   /insights/:id                   → one finding
 *   POST  /insights/:id/{acknowledge|resolve|dismiss}
 *   GET   /insights/modules               → the AI Control matrix
 *   PATCH /insights/modules/:module       → toggle insights/narration/frequency
 *   POST  /insights/sweep                 → manual detector run
 *
 * Brand context rides on X-Brand-Context automatically (api client). Query keys
 * carry the active business so switching entity refetches. The module matrix is
 * system-level (not brand-scoped), so its key omits the business.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";

export type InsightSeverity = "low" | "medium" | "high" | "critical";
export type InsightStatus =
  | "open"
  | "acknowledged"
  | "investigating"
  | "resolved"
  | "dismissed";
export type InsightFrequency = "realtime" | "daily" | "weekly" | "off";

export interface Insight {
  insight_id: string;
  module: string;
  detector: string;
  business: string | null;
  severity: InsightSeverity;
  status: InsightStatus;
  title: string;
  body: string | null;
  context: Record<string, unknown>;
  amount_ngn: string | null;
  source_table: string | null;
  source_id: string | null;
  drill_route: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  detected_at: string;
  updated_at: string;
}

export interface InsightCount {
  open: number;
  urgent: number;
}
/** Keyed by module (e.g. { stock: {open, urgent}, invoicing: {…} }). */
export type InsightSummary = Record<string, InsightCount>;

export interface InsightModule {
  module: string;
  display_name: string;
  permission_module: string;
  insights_enabled: boolean;
  narration_enabled: boolean;
  frequency: InsightFrequency;
  sort_order: number;
  updated_at: string;
}

export interface InsightModuleUpdate {
  insights_enabled?: boolean;
  narration_enabled?: boolean;
  frequency?: InsightFrequency;
}

export interface InsightListParams {
  module?: string;
  status?: InsightStatus;
  severity?: InsightSeverity;
  page?: number;
  page_size?: number;
}

function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

export const insightsApi = {
  summary: () => api.get<InsightSummary>("/insights/summary"),
  list: (p: InsightListParams = {}) =>
    api.get<Insight[]>(
      `/insights${qs({
        module: p.module,
        status: p.status ?? "open",
        severity: p.severity,
        page: p.page,
        page_size: p.page_size,
      })}`,
    ),
  get: (id: string) => api.get<Insight>(`/insights/${id}`),
  acknowledge: (id: string) => api.post<Insight>(`/insights/${id}/acknowledge`),
  resolve: (id: string, reason?: string) =>
    api.post<Insight>(`/insights/${id}/resolve`, { reason }),
  dismiss: (id: string) => api.post<Insight>(`/insights/${id}/dismiss`),
  listModules: () => api.get<InsightModule[]>("/insights/modules"),
  updateModule: (module: string, fields: InsightModuleUpdate) =>
    api.patch<InsightModule>(`/insights/modules/${module}`, fields),
  sweep: () => api.post<InsightSummary>("/insights/sweep"),
};

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useInsightsSummary() {
  const biz = useBusinessStore((s) => s.activeKey);
  return useQuery({
    queryKey: ["insights", "summary", biz],
    queryFn: () => insightsApi.summary(),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

export function useInsightsList(
  params: InsightListParams,
  opts: { enabled?: boolean } = {},
) {
  const biz = useBusinessStore((s) => s.activeKey);
  return useQuery({
    queryKey: [
      "insights",
      "list",
      biz,
      params.module ?? "all",
      params.status ?? "open",
      params.severity ?? "any",
      params.page ?? 1,
    ],
    queryFn: () => insightsApi.list(params),
    staleTime: 60 * 1000,
    retry: 1,
    enabled: opts.enabled ?? true,
  });
}

export function useInsightModules() {
  return useQuery({
    queryKey: ["insights", "modules"],
    queryFn: () => insightsApi.listModules(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

/** Ack / resolve / dismiss — invalidates every insights query on success. */
export function useInsightAction() {
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["insights"] });
  return {
    acknowledge: useMutation({
      mutationFn: (id: string) => insightsApi.acknowledge(id),
      onSuccess: invalidate,
    }),
    resolve: useMutation({
      mutationFn: (v: { id: string; reason?: string }) =>
        insightsApi.resolve(v.id, v.reason),
      onSuccess: invalidate,
    }),
    dismiss: useMutation({
      mutationFn: (id: string) => insightsApi.dismiss(id),
      onSuccess: invalidate,
    }),
  };
}

export function useUpdateInsightModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { module: string; fields: InsightModuleUpdate }) =>
      insightsApi.updateModule(v.module, v.fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["insights", "modules"] }),
  });
}

export function useRunSweep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => insightsApi.sweep(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["insights"] }),
  });
}

/** Total open / urgent across all modules (badge helpers). */
export function totalOpen(s: InsightSummary | undefined): number {
  if (!s) return 0;
  return Object.values(s).reduce((a, c) => a + (c?.open ?? 0), 0);
}
export function totalUrgent(s: InsightSummary | undefined): number {
  if (!s) return 0;
  return Object.values(s).reduce((a, c) => a + (c?.urgent ?? 0), 0);
}
