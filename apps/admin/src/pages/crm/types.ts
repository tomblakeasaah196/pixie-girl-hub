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

// ── Client segment filter ─────────────────────────────────────────────────

export type ClientSegment = "all" | "vip" | "new" | "regular" | "high_risk";

export interface DealFilter {
  pipeline_id?: string;
  stage_id?: string;
  status?: string;
  assigned_to?: string;
  search?: string;
}
