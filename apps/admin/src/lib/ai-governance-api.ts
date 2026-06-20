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
}

export interface SpendMeter {
  current_period: {
    period_start: string;
    period_end: string;
    soft_cap_ngn: string;
    hard_cap_ngn: string;
    actual_spend_ngn: string;
    actual_calls_count: number;
    soft_cap_breached: boolean;
    hard_cap_breached: boolean;
  } | null;
  daily: Array<{
    bucket_date: string;
    feature_key: string;
    vendor: string;
    calls: number;
    tokens: number;
    cost_ngn: string;
  }>;
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

  spendMeter: (params: { from?: string; to?: string } = {}) => {
    const u = new URLSearchParams();
    if (params.from) u.set("from", params.from);
    if (params.to) u.set("to", params.to);
    const qs = u.toString();
    return api.get<SpendMeter>(
      `/ai-governance/usage/meter${qs ? `?${qs}` : ""}`,
    );
  },
};
