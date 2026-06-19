/**
 * AI Governance (V2.2 §6.31) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const VENDOR = ["deepseek", "groq", "openai", "gemini", "self_hosted", "other"];

const flagUpsert = z
  .object({
    feature_key: z.string().min(1).max(80),
    display_name: z.string().min(1).max(160),
    description: z.string().max(2000).optional(),
    is_enabled: z.boolean().optional(),
    default_provider: z.enum(VENDOR).optional(),
    default_model: z.string().max(120).optional(),
    est_cost_per_call_ngn: z.coerce.number().nonnegative().optional(),
  })
  .strict();

const flagToggle = z.object({ is_enabled: z.boolean() }).strict();

const grantCreate = z
  .object({
    user_id: z.string().uuid(),
    feature_key: z.string().min(1).max(80),
    monthly_cap_ngn: z.coerce.number().nonnegative().optional(),
  })
  .strict();

const reasonBody = z
  .object({ reason: z.string().max(1000).optional() })
  .strict();

const vendorUpsert = z
  .object({
    vendor: z.enum(VENDOR),
    display_name: z.string().min(1).max(160),
    api_key: z.string().min(1).max(500).optional(),
    org_id: z.string().max(200).optional(),
    endpoint_url: z.string().url().max(500).optional(),
    default_model: z.string().max(120).optional(),
    current_model: z.string().max(120).nullable().optional(),
    cost_per_1k_input_tokens: z.coerce.number().nonnegative().optional(),
    cost_per_1k_output_tokens: z.coerce.number().nonnegative().optional(),
    cost_per_audio_minute: z.coerce.number().nonnegative().optional(),
    cost_native_currency: z.string().length(3).optional(),
    per_vendor_monthly_cap_ngn: z.coerce.number().nonnegative().optional(),
  })
  .strict();

const modelUpsert = z
  .object({
    model_id: z.string().min(1).max(120),
    vendor: z.enum(VENDOR),
    display_name: z.string().min(1).max(160),
    family: z.string().max(60).nullable().optional(),
    capability: z
      .enum(["chat", "embedding", "audio", "vision"])
      .default("chat"),
    context_window: z.coerce.number().int().positive().nullable().optional(),
    supports_tools: z.boolean().optional(),
    supports_streaming: z.boolean().optional(),
    input_cost_per_1m_ngn: z.coerce.number().nonnegative().optional(),
    output_cost_per_1m_ngn: z.coerce.number().nonnegative().optional(),
    cost_per_audio_minute_ngn: z.coerce.number().nonnegative().optional(),
    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

const vendorRotate = z.object({ api_key: z.string().min(1).max(500) }).strict();
const vendorActive = z.object({ is_active: z.boolean() }).strict();

const budgetOpen = z
  .object({
    period_start: z.string().date(),
    period_end: z.string().date(),
    soft_cap_ngn: z.coerce.number().nonnegative(),
    hard_cap_ngn: z.coerce.number().nonnegative(),
  })
  .strict();

const budgetCaps = z
  .object({
    soft_cap_ngn: z.coerce.number().nonnegative().optional(),
    hard_cap_ngn: z.coerce.number().nonnegative().optional(),
  })
  .strict();

const actionUpsert = z
  .object({
    action_key: z.string().min(1).max(120),
    title: z.string().min(1).max(160),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    route: z.string().min(1).max(300),
    description: z.string().min(1).max(2000),
    module: z.string().min(1).max(60),
    category: z.enum(["read", "write", "draft", "navigate"]),
    is_write: z.boolean().optional(),
    entity_scope: z.enum(["pxg", "flh", "both", "any"]).optional(),
    payload_schema: z.record(z.any()).optional(),
    required_permission: z.string().min(1).max(80),
    ai_enabled: z.boolean().optional(),
    min_confidence: z.coerce.number().min(0).max(1).optional(),
    requires_confirmation: z.boolean().optional(),
    examples: z.array(z.any()).optional(),
  })
  .strict();

const actionToggle = z.object({ ai_enabled: z.boolean() }).strict();

const brandVoiceUpsert = z
  .object({
    tone: z.string().max(160).nullable().optional(),
    voice_summary: z.string().max(4000).nullable().optional(),
    signature_html: z.string().max(4000).nullable().optional(),
    do_donts: z
      .object({
        do: z.array(z.string().max(500)).max(50).optional(),
        dont: z.array(z.string().max(500)).max(50).optional(),
      })
      .optional(),
    faq_markdown: z.string().max(20000).nullable().optional(),
    sample_transcripts: z
      .array(
        z
          .object({
            label: z.string().max(120).optional(),
            customer: z.string().max(2000).optional(),
            staff: z.string().max(2000).optional(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    primary_emojis: z.array(z.string().max(8)).max(20).optional(),
    classify_inbound: z.boolean().optional(),
    draft_on_tap: z.boolean().optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateFlagUpsert: mk(flagUpsert),
  validateFlagToggle: mk(flagToggle),
  validateGrantCreate: mk(grantCreate),
  validateReason: mk(reasonBody),
  validateVendorUpsert: mk(vendorUpsert),
  validateVendorRotate: mk(vendorRotate),
  validateVendorActive: mk(vendorActive),
  validateBudgetOpen: mk(budgetOpen),
  validateBudgetCaps: mk(budgetCaps),
  validateActionUpsert: mk(actionUpsert),
  validateActionToggle: mk(actionToggle),
  validateBrandVoiceUpsert: mk(brandVoiceUpsert),
  validateModelUpsert: mk(modelUpsert),
};
