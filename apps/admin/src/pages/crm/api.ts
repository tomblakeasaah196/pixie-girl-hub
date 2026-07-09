import { api } from "@/lib/api";
import * as contactsApi from "@/pages/contacts/api";
import type {
  AiDealSummary,
  AiNextActionsResult,
  AiActivityDraft,
  AiChurnExplainer,
  CrmClient,
  ClientChip,
  ClientSort,
  TodayBuckets,
  LtvRow,
  CohortCell,
  WinLossReport,
  VelocityReport,
  ForecastReport,
  PaginatedResponse,
  CrmActivity,
} from "./types";
import type { PipelineStage, Deal } from "@/pages/contacts/types";

// Re-export the contacts API for convenience
export * from "@/pages/contacts/api";

const AI = "/ai/crm";

// ── CRM KPI aggregation ───────────────────────────────────────────────────

export interface CrmKpiRaw {
  open_deals: number;
  total_pipeline_value_ngn: number;
  deals_won_this_month: number;
  revenue_this_month_ngn: number;
  win_rate_pct: number;
  avg_deal_value_ngn: number;
  avg_days_to_close: number | null;
}

interface CrmKpiServer {
  open_deals: number;
  open_pipeline_ngn: string | number;
  won_this_month: number;
  won_value_this_month_ngn: string | number;
  win_rate: number | null;
}

export interface MonthYearParams {
  month?: number;
  year?: number;
}

// The /crm/kpis endpoint returns a different field set than the dashboard
// reads; map it (and derive the two values the backend doesn't send).
export const getCrmKpis = async (
  params: MonthYearParams = {},
): Promise<CrmKpiRaw> => {
  const r = await api.get<CrmKpiServer>(`/crm/kpis${qs(params)}`);
  const won = Number(r.won_this_month) || 0;
  const wonValue = Number(r.won_value_this_month_ngn) || 0;
  return {
    open_deals: Number(r.open_deals) || 0,
    total_pipeline_value_ngn: Number(r.open_pipeline_ngn) || 0,
    deals_won_this_month: won,
    revenue_this_month_ngn: wonValue,
    win_rate_pct: r.win_rate != null ? Number(r.win_rate) * 100 : 0,
    avg_deal_value_ngn: won > 0 ? wonValue / won : 0,
    avg_days_to_close: null,
  };
};

function qs(params: object) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

// ── Today buckets (server-computed — GET /crm/today) ──────────────────────

export const getCrmToday = (params: MonthYearParams = {}) =>
  api.get<TodayBuckets>(`/crm/today${qs(params)}`);

// ── Clients (contacts + commercial roll-up — GET /crm/clients) ────────────

export interface CrmClientsParams {
  q?: string;
  chip?: ClientChip;
  sort?: ClientSort;
  page?: number;
  page_size?: number;
}

export const listCrmClients = (params: CrmClientsParams = {}) =>
  api.get<PaginatedResponse<CrmClient>>(`/crm/clients${qs(params)}`);

// ── Contact-level activity log + one-click win-back ───────────────────────

export const listContactCrmActivities = (contactId: string) =>
  api.get<CrmActivity[]>(`/crm/customers/${contactId}/activities`);

export const addContactCrmActivity = (
  contactId: string,
  input: {
    activity_type: string;
    direction?: string;
    subject?: string;
    body?: string;
    outcome?: string;
    duration_minutes?: number;
  },
) => api.post<CrmActivity>(`/crm/customers/${contactId}/activities`, input);

export const triggerWinBack = (contactId: string) =>
  api.post<{ enrolled: number }>(`/crm/customers/${contactId}/win-back`, {});

// ── Reports (GET /crm/reports/*) ──────────────────────────────────────────

export const getReportLtv = (params: { page?: number; page_size?: number } = {}) =>
  api.get<PaginatedResponse<LtvRow>>(`/crm/reports/ltv${qs(params)}`);

export const getReportCohorts = (months = 12) =>
  api.get<CohortCell[]>(`/crm/reports/cohorts${qs({ months })}`);

export const getReportWinLoss = (months = 12) =>
  api.get<WinLossReport>(`/crm/reports/win-loss${qs({ months })}`);

export const getReportVelocity = () =>
  api.get<VelocityReport>("/crm/reports/velocity");

export const getReportForecast = () =>
  api.get<ForecastReport>("/crm/reports/forecast");

// ── Deal management (thin wrappers for explicit CRM context) ──────────────

export const getDeal = (id: string) => contactsApi.getDeal(id);

export const getDealActivities = (dealId: string) =>
  contactsApi.listActivities(dealId);

export const addDealActivity = (
  dealId: string,
  input: Parameters<typeof contactsApi.addActivity>[1],
) => contactsApi.addActivity(dealId, input);

export const getDealNotes = (dealId: string) => contactsApi.listNotes(dealId);

export const addDealNote = (
  dealId: string,
  body: string,
  visibility?: string,
) => contactsApi.addNote(dealId, body, visibility);

export const setPipelineBoard = (stages: PipelineStage[], deals: Deal[]) => {
  const grouped = new Map<string, Deal[]>();
  for (const s of stages) grouped.set(s.stage_id, []);
  for (const d of deals) {
    const arr = grouped.get(d.current_stage_id);
    if (arr) arr.push(d);
    else grouped.set(d.current_stage_id, [d]);
  }
  return stages.map((stage) => ({
    stage,
    deals: grouped.get(stage.stage_id) ?? [],
    total_value_ngn: (grouped.get(stage.stage_id) ?? []).reduce(
      (sum, d) => sum + parseFloat(d.expected_value_ngn ?? "0"),
      0,
    ),
  }));
};

// ── AI endpoints ──────────────────────────────────────────────────────────

export const getAiDealSummary = (dealId: string) =>
  api.post<AiDealSummary>(`${AI}/deal-summary`, { deal_id: dealId });

export const getAiNextActions = (dealId: string) =>
  api.post<AiNextActionsResult>(`${AI}/next-actions`, { deal_id: dealId });

export const draftActivityBody = (input: {
  deal_id?: string;
  contact_id?: string;
  activity_type: string;
  direction?: string;
}) => api.post<AiActivityDraft>(`${AI}/draft-activity`, input);

export const getAiChurnExplainer = (contactId: string, churnScoreId?: string) =>
  api.post<AiChurnExplainer>(`${AI}/churn-explain`, {
    contact_id: contactId,
    churn_score_id: churnScoreId,
  });

export const getAiWinBackPrompt = (contactId: string) =>
  api.post<{ message: string }>(`${AI}/win-back`, { contact_id: contactId });
