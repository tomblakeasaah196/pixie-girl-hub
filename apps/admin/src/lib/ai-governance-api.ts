/**
 * AI Governance — small typed client wrappers. Mirrors the routes in
 * `src/modules/ai_governance/governance.routes.js`. Only the surfaces
 * we touch in PR 3 are typed here; the full surface (flags / grants /
 * vendors / budgets / actions) will be filled in when those screens
 * land.
 */

import { api } from "@/lib/api";

export interface BrandVoiceConfig {
  business: string;
  tone?: string | null;
  voice_summary?: string | null;
  signature_html?: string | null;
  do_donts?: { do?: string[]; dont?: string[] };
  faq_markdown?: string | null;
  sample_transcripts?: Array<{
    label?: string;
    customer?: string;
    staff?: string;
  }>;
  primary_emojis?: string[];
  classify_inbound: boolean;
  draft_on_tap: boolean;
  updated_at?: string;
}

export interface BrandVoiceUpsert {
  tone?: string | null;
  voice_summary?: string | null;
  signature_html?: string | null;
  do_donts?: { do?: string[]; dont?: string[] };
  faq_markdown?: string | null;
  sample_transcripts?: Array<{
    label?: string;
    customer?: string;
    staff?: string;
  }>;
  primary_emojis?: string[];
  classify_inbound?: boolean;
  draft_on_tap?: boolean;
}

export type AiVendor =
  | "deepseek"
  | "groq"
  | "openai"
  | "gemini"
  | "self_hosted"
  | "other";
export type AiCapability = "chat" | "embedding" | "audio" | "vision";

export interface AiModel {
  model_id: string;
  vendor: AiVendor;
  display_name: string;
  family?: string | null;
  capability: AiCapability;
  context_window?: number | null;
  supports_tools: boolean;
  supports_streaming: boolean;
  input_cost_per_1m_ngn: string | number;
  output_cost_per_1m_ngn: string | number;
  cost_per_audio_minute_ngn: string | number;
  is_default: boolean;
  is_active: boolean;
  notes?: string | null;
  updated_at: string;
}

export interface AiVendorRow {
  credential_id: string;
  vendor: AiVendor;
  display_name: string;
  default_model?: string | null;
  current_model?: string | null;
  endpoint_url?: string | null;
  cost_per_1k_input_tokens?: string | number;
  cost_per_1k_output_tokens?: string | number;
  cost_native_currency?: string | null;
  is_active: boolean;
  last_rotated_at?: string | null;
  has_api_key: boolean;
  // Health + test outcome columns (000309). All optional so older API
  // versions render gracefully during a rolling deploy.
  last_health_status?: "green" | "red" | "unknown" | null;
  last_health_at?: string | null;
  last_health_latency_ms?: number | null;
  last_health_error?: string | null;
  last_test_ok_at?: string | null;
  last_test_latency_ms?: number | null;
  last_test_error?: string | null;
}

export interface VendorTestResult {
  ok: boolean;
  latency_ms: number | null;
  http_status?: number | null;
  error_code?: string | null;
  error_message?: string | null;
}

export interface VendorHealthPing {
  ping_id: string;
  vendor: string;
  source: "boot" | "cron" | "manual" | "live_call";
  ok: boolean;
  latency_ms: number | null;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  checked_at: string;
}

export interface AiIncident {
  incident_id: string;
  incident_type: "failover_engaged" | "vendor_red" | "vendor_recovered" | "failure_spike";
  vendor: string;
  fallback_vendor: string | null;
  feature_key: string | null;
  business: string | null;
  severity: "info" | "warning" | "critical";
  summary: string;
  details: Record<string, unknown>;
  alert_sent_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface VendorSuccessRate {
  vendor: string;
  total_calls: number;
  successes: number;
  failures: number;
  success_rate_pct: number;
  avg_latency_ms: number | null;
}

export interface AiUsageError {
  usage_id: string;
  vendor: string;
  model: string;
  feature_key: string;
  business: string | null;
  error_code: string | null;
  error_message: string | null;
  latency_ms: number | null;
  occurred_at: string;
}

// Q7 tiered caps: internal features gate on the classic hard_cap_ngn,
// storefront features gate on their SEPARATE storefront cap (nullable
// == uncapped; revenue-features-die-last stance). The API returns both
// sides split so the Spend page can render two independent meters.
export interface SpendMeterSide {
  soft_cap_ngn: string | number | null;
  hard_cap_ngn: string | number | null;
  actual_spend_ngn: string | number;
  actual_calls_count: number;
  soft_cap_breached: boolean;
  hard_cap_breached: boolean;
}
export interface SpendMeter {
  current_period:
    | ({
        period_id: string;
        period_start: string;
        period_end: string;
        internal: SpendMeterSide;
        storefront: SpendMeterSide;
        // Retained for legacy callers (= internal + storefront).
        soft_cap_ngn: string;
        hard_cap_ngn: string;
        actual_spend_ngn: string;
        actual_calls_count: number;
        soft_cap_breached: boolean;
        hard_cap_breached: boolean;
      })
    | null;
  daily: Array<{
    metric_date: string;
    feature_key: string;
    vendor: string;
    calls: number;
    tokens: number;
    cost_ngn: string;
    failed: number;
  }>;
}

// Q8: full feature flag row (Feature Flags & Access page).
export interface AiFeatureFlag {
  flag_id: string;
  feature_key: string;
  display_name: string;
  description: string | null;
  is_enabled: boolean;
  default_provider: string | null;
  default_model: string | null;
  est_cost_per_call_ngn: string | number | null;
  feature_scope: "internal" | "storefront";
  enabled_for_pxg: boolean;
  enabled_for_flh: boolean;
  daily_user_cap: number | null;
  resting_message: string | null;
  last_changed_by: string | null;
  last_changed_at: string | null;
  updated_at: string;
}

export interface AiFlagAuditRow {
  audit_id: string;
  occurred_at: string;
  user_id: string | null;
  user_name: string | null;
  action_key: string;
  flag_id: string | null;
  after_state: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
}

export interface BudgetPeriod {
  period_id: string;
  period_start: string;
  period_end: string;
  is_active: boolean;
  soft_cap_ngn: string | number;
  hard_cap_ngn: string | number;
  actual_spend_ngn: string | number;
  actual_calls_count: number;
  soft_cap_breached_at: string | null;
  hard_cap_breached_at: string | null;
  storefront_soft_cap_ngn: string | number | null;
  storefront_hard_cap_ngn: string | number | null;
  storefront_actual_spend_ngn: string | number;
  storefront_actual_calls_count: number;
  storefront_soft_cap_breached_at: string | null;
  storefront_hard_cap_breached_at: string | null;
  created_at: string;
  updated_at: string;
}

export const aiGovernanceApi = {
  getBrandVoice: () =>
    api.get<BrandVoiceConfig | null>("/ai-governance/brand-voice"),
  upsertBrandVoice: (input: BrandVoiceUpsert) =>
    api.put<BrandVoiceConfig>("/ai-governance/brand-voice", input),

  listModels: (
    params: { vendor?: AiVendor; capability?: AiCapability } = {},
  ) => {
    const u = new URLSearchParams();
    if (params.vendor) u.set("vendor", params.vendor);
    if (params.capability) u.set("capability", params.capability);
    const qs = u.toString();
    return api.get<AiModel[]>(`/ai-governance/models${qs ? `?${qs}` : ""}`);
  },
  upsertModel: (
    input: Partial<AiModel> & {
      model_id: string;
      vendor: AiVendor;
      display_name: string;
      capability: AiCapability;
    },
  ) => api.post<AiModel>("/ai-governance/models", input),

  listVendors: () => api.get<AiVendorRow[]>("/ai-governance/vendors"),
  upsertVendor: (input: {
    vendor: AiVendor;
    display_name: string;
    api_key?: string;
    endpoint_url?: string;
    default_model?: string;
    current_model?: string | null;
    cost_per_1k_input_tokens?: number;
    cost_per_1k_output_tokens?: number;
    cost_native_currency?: string;
  }) => api.post<AiVendorRow>("/ai-governance/vendors", input),
  rotateVendorKey: (vendor: AiVendor, api_key: string) =>
    api.post<{ credential_id: string; vendor: AiVendor }>(
      `/ai-governance/vendors/${vendor}/rotate`,
      { api_key },
    ),
  setVendorActive: (vendor: AiVendor, is_active: boolean) =>
    api.post<{ credential_id: string; vendor: AiVendor; is_active: boolean }>(
      `/ai-governance/vendors/${vendor}/active`,
      { is_active },
    ),
  // Live "Test connection" — pass overrides to test a not-yet-saved key.
  testVendor: (
    vendor: AiVendor,
    overrides?: { api_key?: string; endpoint_url?: string; model?: string },
  ) =>
    api.post<VendorTestResult>(
      `/ai-governance/vendors/${vendor}/test`,
      overrides ?? {},
    ),

  // Health + observability (AI Health & Logs page)
  listVendorHealth: () =>
    api.get<AiVendorRow[]>("/ai-governance/health/vendors"),
  listHealthPings: (params: { vendor?: string; limit?: number } = {}) => {
    const u = new URLSearchParams();
    if (params.vendor) u.set("vendor", params.vendor);
    if (params.limit) u.set("limit", String(params.limit));
    const qs = u.toString();
    return api.get<VendorHealthPing[]>(
      `/ai-governance/health/pings${qs ? `?${qs}` : ""}`,
    );
  },
  listIncidents: (params: { vendor?: string; limit?: number } = {}) => {
    const u = new URLSearchParams();
    if (params.vendor) u.set("vendor", params.vendor);
    if (params.limit) u.set("limit", String(params.limit));
    const qs = u.toString();
    return api.get<AiIncident[]>(
      `/ai-governance/health/incidents${qs ? `?${qs}` : ""}`,
    );
  },
  pingVendorNow: (vendor: AiVendor) =>
    api.post<VendorTestResult>(
      `/ai-governance/health/vendors/${vendor}/ping`,
      {},
    ),
  vendorSuccessRate: (params: { hours?: number } = {}) => {
    const u = new URLSearchParams();
    if (params.hours) u.set("hours", String(params.hours));
    const qs = u.toString();
    return api.get<VendorSuccessRate[]>(
      `/ai-governance/logs/success-rate${qs ? `?${qs}` : ""}`,
    );
  },
  recentErrors: (params: { vendor?: string; limit?: number } = {}) => {
    const u = new URLSearchParams();
    if (params.vendor) u.set("vendor", params.vendor);
    if (params.limit) u.set("limit", String(params.limit));
    const qs = u.toString();
    return api.get<AiUsageError[]>(
      `/ai-governance/logs/recent${qs ? `?${qs}` : ""}`,
    );
  },

  spendMeter: (params: { from?: string; to?: string } = {}) => {
    const u = new URLSearchParams();
    if (params.from) u.set("from", params.from);
    if (params.to) u.set("to", params.to);
    const qs = u.toString();
    return api.get<SpendMeter>(
      `/ai-governance/usage/meter${qs ? `?${qs}` : ""}`,
    );
  },

  // Q7 — Spend & Budget page
  listPeriods: () => api.get<BudgetPeriod[]>("/ai-governance/budget"),
  activePeriod: () =>
    api.get<BudgetPeriod | null>("/ai-governance/budget/active"),
  openPeriod: (input: {
    period_start: string;
    period_end: string;
    soft_cap_ngn: number;
    hard_cap_ngn: number;
  }) => api.post<BudgetPeriod>("/ai-governance/budget", input),
  setBudgetCaps: (
    period_id: string,
    input: {
      soft_cap_ngn?: number;
      hard_cap_ngn?: number;
      // null → uncapped, undefined → leave the current value alone.
      storefront_soft_cap_ngn?: number | null;
      storefront_hard_cap_ngn?: number | null;
    },
  ) =>
    api.post<BudgetPeriod>(`/ai-governance/budget/${period_id}/caps`, input),

  // Q8 — Feature Flags & Access page
  listFlags: () => api.get<AiFeatureFlag[]>("/ai-governance/flags"),
  recentFlagAudit: (params: { limit?: number } = {}) => {
    const u = new URLSearchParams();
    if (params.limit) u.set("limit", String(params.limit));
    const qs = u.toString();
    return api.get<AiFlagAuditRow[]>(
      `/ai-governance/flags/audit${qs ? `?${qs}` : ""}`,
    );
  },
  toggleFlag: (feature_key: string, is_enabled: boolean) =>
    api.post<AiFeatureFlag>(`/ai-governance/flags/${feature_key}/toggle`, {
      is_enabled,
    }),
  setFlagBrandScope: (
    feature_key: string,
    input: { enabled_for_pxg?: boolean; enabled_for_flh?: boolean },
  ) =>
    api.post<AiFeatureFlag>(
      `/ai-governance/flags/${feature_key}/brand-scope`,
      input,
    ),
  setFlagUserCap: (feature_key: string, daily_user_cap: number | null) =>
    api.post<AiFeatureFlag>(
      `/ai-governance/flags/${feature_key}/user-cap`,
      { daily_user_cap },
    ),
  setFlagRestingMessage: (
    feature_key: string,
    resting_message: string | null,
  ) =>
    api.post<AiFeatureFlag>(
      `/ai-governance/flags/${feature_key}/resting-message`,
      { resting_message },
    ),
};
