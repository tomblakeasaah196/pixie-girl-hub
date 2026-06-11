/**
 * AI Governance (V2.2 §6.31) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const VENDOR = ["deepseek", "groq", "openai", "self_hosted", "other"];

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
    cost_per_1k_input_tokens: z.coerce.number().nonnegative().optional(),
    cost_per_1k_output_tokens: z.coerce.number().nonnegative().optional(),
    cost_per_audio_minute: z.coerce.number().nonnegative().optional(),
    cost_native_currency: z.string().length(3).optional(),
    per_vendor_monthly_cap_ngn: z.coerce.number().nonnegative().optional(),
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
};
