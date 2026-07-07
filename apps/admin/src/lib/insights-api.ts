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

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";
import { joinRoom, leaveRoom, rooms } from "@/lib/socket";
import { toast } from "@/stores/toast";
import { toastReport } from "@/lib/error-report";

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

/** What a manual "Run scan" returns — powers the scan-complete confirmation. */
export interface SweepResult {
  /** Findings currently flagged, per module scanned (e.g. { stock: 3 }). */
  by_module: Record<string, number>;
  /** Total open conditions found across everything scanned. */
  findings: number;
  /** How many modules the scan actually covered. */
  modules_scanned: number;
  /** Genuinely-new findings raised this run. */
  created: number;
  /** Findings auto-resolved because their condition had cleared. */
  resolved: number;
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
  sweep: () => api.post<SweepResult>("/insights/sweep"),
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

/**
 * Manual "Run scan". Invalidates the insights cache AND surfaces an unmissable
 * confirmation toast — so an empty result reads as "scanned, all clear" rather
 * than looking like the button did nothing.
 */
export function useRunSweep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => insightsApi.sweep(),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["insights"] });
      const mods = res?.modules_scanned ?? 0;
      const found = res?.findings ?? 0;
      const resolved = res?.resolved ?? 0;
      const s = (n: number) => (n === 1 ? "" : "s");
      if (mods === 0) {
        toast.info("No modules to scan", {
          description:
            "No modules are switched on. Enable one in AI Control, then run a scan.",
        });
      } else if (found === 0) {
        toast.success("Scan complete — all clear", {
          description: `Checked ${mods} module${s(mods)}. Nothing needs attention${
            resolved ? ` · ${resolved} auto-resolved` : ""
          }.`,
        });
      } else {
        toast.success(`Scan complete — ${found} open item${s(found)}`, {
          description: `Across ${mods} module${s(mods)}${
            resolved ? ` · ${resolved} auto-resolved` : ""
          }.`,
        });
      }
    },
    onError: (err) => toastReport("AI Control → Insights sweep", "Scan failed", err),
  });
}

/**
 * Live updates: join the active brand's insights room and refetch on any
 * server-pushed change (a sweep raised findings, or a lifecycle transition).
 * Safe to mount on every surface that should feel live — the room join is
 * idempotent and React Query dedupes the refetch.
 */
export function useInsightsRealtime() {
  const qc = useQueryClient();
  const biz = useBusinessStore((s) => s.activeKey);
  useEffect(() => {
    if (!biz) return;
    const room = rooms.insights(biz);
    joinRoom(room);
    const onChange = () =>
      qc.invalidateQueries({ queryKey: ["insights"] });
    window.addEventListener("pgh:insights:changed", onChange);
    return () => {
      window.removeEventListener("pgh:insights:changed", onChange);
      leaveRoom(room);
    };
  }, [biz, qc]);
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
