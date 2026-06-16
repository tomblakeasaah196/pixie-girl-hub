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

export const aiGovernanceApi = {
  getBrandVoice: () =>
    api.get<BrandVoiceConfig | null>("/ai-governance/brand-voice"),
  upsertBrandVoice: (input: BrandVoiceUpsert) =>
    api.put<BrandVoiceConfig>("/ai-governance/brand-voice", input),
};
