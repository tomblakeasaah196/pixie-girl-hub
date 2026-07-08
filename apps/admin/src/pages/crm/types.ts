// Re-export all contact/CRM domain types for use within the CRM module
export type {
  Contact,
  Deal,
  DealStatus,
  DealChannel,
  Pipeline,
  PipelineStage,
  CrmActivity,
  ActivityType,
  ActivityOutcome,
  CrmNote,
  CustomerPreferences,
  CustomerMeasurement,
  ChurnScore,
  ContactSummary,
  TimelineEvent,
  PaginatedResponse,
  DealCreateInput,
  Milestone,
} from "@/pages/contacts/types";

// ── Today feed ────────────────────────────────────────────────────────────

export interface TodaySection<T> {
  items: T[];
  count: number;
}

export interface TodayNewContact {
  contact_id: string;
  display_name: string;
  priority_level: "vip" | "regular" | "new";
  primary_phone: string | null;
  whatsapp_number: string | null;
  email: string | null;
  source: string | null;
  created_at: string;
}

export interface TodayStaleContact {
  contact_id: string;
  display_name: string;
  priority_level: "vip" | "regular" | "new";
  primary_phone: string | null;
  whatsapp_number: string | null;
  last_order_at: string | null;
  total_orders: number;
  lifetime_value_ngn: string;
  days_since_order: number;
}

export interface TodayStaleDeal {
  deal_id: string;
  deal_number: string;
  title: string;
  contact_id: string;
  contact_name?: string;
  current_stage_name?: string;
  expected_value_ngn: string | null;
  last_activity_at: string | null;
  days_since_activity: number;
}

// ── CRM KPIs ──────────────────────────────────────────────────────────────

export interface CrmKpi {
  open_deals: number;
  total_pipeline_value_ngn: number;
  deals_won_this_month: number;
  revenue_this_month_ngn: number;
  win_rate_pct: number;
  avg_deal_value_ngn: number;
  avg_days_to_close: number | null;
}

// ── Kanban view ───────────────────────────────────────────────────────────

export interface KanbanColumn {
  stage: import("@/pages/contacts/types").PipelineStage;
  deals: import("@/pages/contacts/types").Deal[];
  total_value_ngn: number;
}

// ── AI integration ────────────────────────────────────────────────────────

export interface AiDealSummary {
  summary: string;
  key_risks: string[];
  recommended_next_step: string;
  win_probability_estimate: number | null;
  confidence: "high" | "medium" | "low";
  generated_at: string;
}

export interface AiNextAction {
  action_type: string;
  description: string;
  urgency: "high" | "medium" | "low";
  suggested_message?: string;
}

export interface AiNextActionsResult {
  actions: AiNextAction[];
  reasoning: string;
}

export interface AiActivityDraft {
  subject: string;
  body: string;
}

export interface AiChurnExplainer {
  headline: string;
  explanation: string;
  recommendations: string[];
  win_back_prompt?: string;
}

// ── Clients (contacts + commercial roll-up, GET /crm/clients) ─────────────

export type ClientChip =
  | "vip"
  | "big_spender"
  | "new"
  | "win_back"
  | "birthdays_soon";

export type ClientSort = "recent" | "top_spend" | "newest" | "oldest" | "name";

export interface CrmClient {
  contact_id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  primary_phone: string | null;
  date_of_birth: string | null;
  source: string | null;
  priority_level: "vip" | "regular" | "new";
  created_at: string;
  orders_count: number;
  lifetime_spend_ngn: string;
  last_order_at: string | null;
  loyalty_points: number;
  churn_risk_score: number | null;
  churn_risk_band: "low" | "medium" | "high" | "critical" | null;
}

// ── Today buckets (GET /crm/today) ────────────────────────────────────────

export interface TodayBucket<T> {
  total: number;
  items: T[];
}

export interface TodayCelebrateItem {
  contact_id: string;
  display_name: string | null;
  first_name: string | null;
  date_of_birth: string;
}

export interface TodayWelcomeItem {
  contact_id: string;
  display_name: string | null;
  first_name: string | null;
  source: string | null;
  created_at: string;
}

export interface TodayWinBackItem {
  contact_id: string;
  display_name: string | null;
  first_name: string | null;
  risk_score: number;
  risk_band: "high" | "critical";
  days_since_last_order: number | null;
  lifetime_value_ngn: string | null;
}

export interface TodayTopItem {
  contact_id: string;
  display_name: string | null;
  first_name: string | null;
  spend_this_month_ngn: string;
  orders_this_month: number;
}

export interface TodayFollowUpItem {
  deal_id: string;
  deal_number: string;
  title: string;
  contact_id: string;
  display_name: string | null;
  expected_value_ngn: string | null;
  quiet_since: string;
}

export interface TodayBuckets {
  to_celebrate: TodayBucket<TodayCelebrateItem>;
  to_welcome: TodayBucket<TodayWelcomeItem>;
  to_win_back: TodayBucket<TodayWinBackItem>;
  top_this_month: TodayBucket<TodayTopItem>;
  follow_ups: TodayBucket<TodayFollowUpItem>;
}

// ── Reports (GET /crm/reports/*) ──────────────────────────────────────────

export interface LtvRow {
  contact_id: string;
  display_name: string | null;
  first_name: string | null;
  email: string | null;
  primary_phone: string | null;
  orders_count: number;
  lifetime_spend_ngn: string;
  avg_order_value_ngn: string;
  first_order_at: string;
  last_order_at: string;
}

export interface CohortCell {
  cohort_month: string;
  month_offset: number;
  active_customers: number;
}

export interface WinLossReport {
  monthly: {
    month: string;
    won: number;
    lost: number;
    won_value_ngn: string;
    lost_value_ngn: string;
  }[];
  lost_reasons: { reason: string; deals: number; value_ngn: string }[];
  by_pipeline: {
    pipeline_id: string;
    display_name: string;
    won: number;
    lost: number;
  }[];
}

export interface VelocityReport {
  stages: {
    stage_id: string;
    stage_key: string;
    display_name: string;
    display_order: number;
    pipeline_id: string;
    pipeline_name: string;
    moves: number;
    avg_days_in_stage: string | null;
    median_days_in_stage: string | null;
  }[];
  close: { won_deals: number; avg_days_to_win: string | null };
}

export interface ForecastReport {
  open_by_month: {
    month: string | null;
    deals: number;
    pipeline_value_ngn: string;
    weighted_value_ngn: string;
  }[];
  won_by_month: { month: string; deals: number; won_value_ngn: string }[];
}

// ── Client segment filter ─────────────────────────────────────────────────

export type ClientSegment = "all" | "vip" | "new" | "regular" | "high_risk";

export interface DealFilter {
  pipeline_id?: string;
  stage_id?: string;
  status?: string;
  assigned_to?: string;
  search?: string;
}
