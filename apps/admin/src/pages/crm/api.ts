import { api } from "@/lib/api";
import * as contactsApi from "@/pages/contacts/api";
import type {
  AiDealSummary,
  AiNextActionsResult,
  AiActivityDraft,
  AiChurnExplainer,
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

// The /crm/kpis endpoint returns a different field set than the dashboard
// reads; map it (and derive the two values the backend doesn't send).
export const getCrmKpis = async (): Promise<CrmKpiRaw> => {
  const r = await api.get<CrmKpiServer>("/crm/kpis");
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

// ── Today feed aggregation ────────────────────────────────────────────────
// Composed on the frontend from multiple fast endpoints.

export const getTodayNewContacts = (days = 7) =>
  contactsApi.listContacts({ page_size: 20, page: 1 }).then((r) =>
    r.data.filter((c) => {
      const created = new Date(c.created_at).getTime();
      const cutoff = Date.now() - days * 86_400_000;
      return created >= cutoff;
    }),
  );

export const getTodayStaleDeals = (staleDays = 14) =>
  contactsApi.listDeals({ status: "open", page_size: 100 }).then((r) =>
    r.data
      .filter((d) => {
        if (!d.last_activity_at) return true;
        const last = new Date(d.last_activity_at).getTime();
        return Date.now() - last > staleDays * 86_400_000;
      })
      .slice(0, 20),
  );

export const getTodayLapsedContacts = () =>
  contactsApi
    .listContacts({ priority_level: "vip", page_size: 50 })
    .then((r) =>
      r.data
        .filter(
          (c) =>
            (c as unknown as { churn_risk_band?: string }).churn_risk_band ===
            "high",
        )
        .slice(0, 20),
    );

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
