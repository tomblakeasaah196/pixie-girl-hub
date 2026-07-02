/**
 * Dashboards & Reports (§6.20) — typed hooks over /api/v1/dashboards.
 *
 * The backend registry is the contract: /domains hands back the tabs + tile
 * manifests this user may see (matrix OR org-chart rights; finance/hr gated;
 * cost tiles pre-stripped), and every domain payload carries its own KPI /
 * chart / table structure — the page renders data-driven, nothing hardcoded.
 *
 * Freshness: dashboards poll every 60s and refetch on focus (the header shows
 * "Updated Xs ago"). Entity scope rides on X-Brand-Context via lib/api and on
 * every query key.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";

const POLL_MS = 60_000;

// ── Contract types (mirror dashboards.domains.js / metrics service) ──

export type TileFormat =
  | "money"
  | "int"
  | "num"
  | "pct"
  | "hours"
  | "date"
  | "datetime"
  | "bool"
  | "text";

export interface TileMeta {
  key: string;
  label: string;
  format?: TileFormat;
  type?: string;
}

export interface DomainMeta {
  key: string;
  label: string;
  description: string;
  kpis: TileMeta[];
  charts: TileMeta[];
  tables: TileMeta[];
  details: { key: string; label: string }[];
}

export interface DashboardCapabilities {
  can_export: boolean;
  can_finance: boolean;
  can_hr: boolean;
  can_cost: boolean;
  all_entities: boolean;
}

export interface DomainsResponse {
  domains: DomainMeta[];
  capabilities: DashboardCapabilities;
  hidden_tiles: string[];
}

export interface Kpi {
  key: string;
  label: string;
  format: TileFormat;
  value: string | number | null;
  previous: string | number | null;
  delta_pct: number | null;
}

export interface ChartPoint {
  x: string;
  y: number;
}
export interface ChartSeries {
  key: string;
  label: string;
  points: ChartPoint[];
}
export interface ChartSlice {
  label: string;
  value: number;
  [extra: string]: unknown;
}
export interface DomainChart {
  key: string;
  label: string;
  type: "line" | "bar" | "bar_line" | "donut" | "funnel";
  series?: ChartSeries[];
  slices?: ChartSlice[];
  steps?: { label: string; value: number }[];
}

export interface TableColumn {
  key: string;
  label: string;
  format: TileFormat;
}
export interface DomainTable {
  key: string;
  label: string;
  detail_key: string | null;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
}

export interface Period {
  from: string;
  to: string;
  granularity?: "day" | "week" | "month";
}

export interface DomainPayload {
  domain: string;
  label: string;
  period: Period;
  previous_period: { from: string; to: string };
  kpis: Kpi[];
  charts: DomainChart[];
  tables: DomainTable[];
}

export interface DetailResponse {
  data: Record<string, unknown>[];
  columns: TableColumn[];
  label: string;
  period: { from: string; to: string };
  meta: { page: number; page_size: number; total: number; has_more: boolean };
}

export interface GlobalBusinessRollup {
  brand: string;
  display_name: string;
  revenue: string;
  revenue_delta_pct: number | null;
  orders: number;
  orders_delta_pct: number | null;
  aov: string;
  cash_collected: string;
  new_customers: number;
  new_customers_delta_pct: number | null;
}

export interface GlobalPayload {
  period: Period;
  previous_period: { from: string; to: string };
  combined: {
    revenue: string;
    revenue_delta_pct: number | null;
    orders: number;
    orders_delta_pct: number | null;
    aov: string;
    cash_collected: string;
    new_customers: number;
  };
  businesses: GlobalBusinessRollup[];
  revenue_trend: { series: ChartSeries[] };
}

export interface ReportRun {
  run_id: string;
  run_number: string;
  template_name: string | null;
  status:
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "needs_confirmation"
    | "confirmed"
    | "sent"
    | "cancelled";
  period_start: string | null;
  period_end: string | null;
  created_at: string;
  confirmed_at: string | null;
  confirmation_notes: string | null;
}

export interface ReportTemplate {
  template_id: string;
  template_key: string;
  display_name: string;
  description: string | null;
  cadence: string;
  scheduled_day_of_week: number | null;
  scheduled_hour: number | null;
  is_active: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}

// lib/api's request() unwraps the backend's { data } envelope itself —
// endpoints returning { data, meta, ... } siblings come through intact.
interface PagedEnvelope<T> {
  data: T[];
  meta: { page: number; page_size: number; total: number; has_more: boolean };
}

export interface PeriodParams {
  from?: string;
  to?: string;
}

function periodQs({ from, to }: PeriodParams): string {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

function useBiz() {
  return useBusinessStore((s) => s.activeKey);
}

// ── Queries ────────────────────────────────────────────────

export function useDashboardDomains() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["dashboards", biz, "domains"],
    queryFn: () => api.get<DomainsResponse>("/dashboards/domains"),
    staleTime: 5 * 60_000,
  });
}

export function useDomainDashboard(key: string | null, period: PeriodParams) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["dashboards", biz, "domain", key, period],
    queryFn: () =>
      api.get<DomainPayload>(`/dashboards/domains/${key}${periodQs(period)}`),
    enabled: !!key,
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
}

export interface DetailParams extends PeriodParams {
  page?: number;
  page_size?: number;
  status?: string;
  sales_channel?: string;
}

export function useDomainDetail(
  domain: string | null,
  table: string | null,
  params: DetailParams,
) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["dashboards", biz, "detail", domain, table, params],
    queryFn: async () => {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
      }
      const s = qs.toString();
      return api.get<DetailResponse>(
        `/dashboards/domains/${domain}/detail/${table}${s ? `?${s}` : ""}`,
      );
    },
    enabled: !!domain && !!table,
    placeholderData: keepPreviousData,
  });
}

export function useGlobalDashboard(period: PeriodParams, enabled: boolean) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["dashboards", biz, "global", period],
    queryFn: () =>
      api.get<GlobalPayload>(`/dashboards/global${periodQs(period)}`),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
}

// ── Tile visibility preferences ────────────────────────────

export function useHiddenTiles() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["dashboards", biz, "preferences"],
    queryFn: async () =>
      (await api.get<{ hidden_tiles: string[] }>("/dashboards/preferences"))
        .hidden_tiles,
  });
}

export function useSaveHiddenTiles() {
  const biz = useBiz();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (hidden_tiles: string[]) =>
      (
        await api.put<{ hidden_tiles: string[] }>("/dashboards/preferences", {
          hidden_tiles,
        })
      ).hidden_tiles,
    onSuccess: (hidden) => {
      qc.setQueryData(["dashboards", biz, "preferences"], hidden);
      qc.invalidateQueries({ queryKey: ["dashboards", biz, "domains"] });
    },
  });
}

export const tileKey = (
  domain: string,
  kind: "kpi" | "chart" | "table",
  key: string,
) => `${domain}:${kind}:${key}`;

// ── Reports (weekly auto-reports + history) ────────────────

export function useReportRuns(params: { status?: string; page?: number }) {
  const biz = useBiz();
  return useQuery({
    queryKey: ["dashboards", biz, "report-runs", params],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (params.status) qs.set("status", params.status);
      if (params.page) qs.set("page", String(params.page));
      const s = qs.toString();
      return api.get<PagedEnvelope<ReportRun>>(
        `/dashboards/report-runs${s ? `?${s}` : ""}`,
      );
    },
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
  });
}

export function useReportTemplates() {
  const biz = useBiz();
  return useQuery({
    queryKey: ["dashboards", biz, "report-templates"],
    queryFn: () =>
      api.get<ReportTemplate[]>("/dashboards/report-templates"),
  });
}

export function useConfirmReportRun() {
  const biz = useBiz();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      api.post<ReportRun>(
        `/dashboards/report-runs/${id}/confirm`,
        notes ? { notes } : {},
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["dashboards", biz, "report-runs"] }),
  });
}

export function useQueueReportPdf() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ queued: boolean }>(`/dashboards/report-runs/${id}/pdf`),
  });
}

// ── Downloads (styled .xlsx from the backend) ──────────────

export function downloadDomainExcel(domain: string, period: PeriodParams) {
  return api.download(
    `/dashboards/domains/${domain}/export${periodQs(period)}`,
    `${domain}-dashboard.xlsx`,
  );
}

export function downloadReportRunExcel(id: string, runNumber: string) {
  return api.download(
    `/dashboards/report-runs/${id}/excel`,
    `${runNumber || "report"}.xlsx`,
  );
}
