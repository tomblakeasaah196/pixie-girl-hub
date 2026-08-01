/**
 * Crowns 👑 — unified loyalty + streak economy (Module 6.23). Zod validators.
 */

"use strict";

const { z } = require("zod");
const { mkPatch } = require("./patch-body");

const adjustSchema = z
  .object({
    crowns: z.coerce.number().int(),
    note: z.string().max(500).optional(),
  })
  .strict();

const submitActionSchema = z
  .object({
    rule_key: z.string().min(1).max(80),
    social_handle: z.string().max(120).optional(),
    proof_url: z.string().url().max(500).optional(),
    media_asset_id: z.string().uuid().optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

const reviewSubmissionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    review_note: z.string().max(500).optional(),
  })
  .strict();

// Admin edit drawers round-trip the whole row back; partial().strip() + the
// cleanPatch helper (mkPatch) drop server-owned + null fields safely.
const tierUpdateSchema = z
  .object({
    tier_name: z.string().min(1).max(80),
    description: z.string().max(1000),
    min_crowns: z.coerce.number().int().nonnegative(),
    display_order: z.coerce.number().int().nonnegative(),
    next_purchase_discount_pct: z.coerce.number().min(0).max(100),
    grants_free_shipping_next: z.boolean(),
    lifetime_discount_pct: z.coerce.number().min(0).max(100),
    earning_multiplier: z.coerce.number().min(0).max(99),
    benefits: z.record(z.any()),
    badge_colour_hex: z.string().max(9),
    badge_image_url: z.string().max(500),
    is_active: z.boolean(),
  })
  .partial()
  .strip();

const ruleUpdateSchema = z
  .object({
    display_name: z.string().min(1).max(120),
    description: z.string().max(1000),
    crowns_mode: z.enum(["flat", "per_currency"]),
    crown_value: z.coerce.number().int().positive(),
    unit_currency_per_crown: z.coerce.number().positive(),
    verification_mode: z.enum(["auto", "honor", "manual"]),
    social_platform: z
      .enum(["instagram", "tiktok", "x", "facebook", "youtube"])
      .nullable(),
    min_order_value: z.coerce.number().nonnegative(),
    max_awards_per_customer_lifetime: z.coerce.number().int().positive(),
    max_awards_per_customer_per_month: z.coerce.number().int().positive(),
    max_awards_per_customer_per_year: z.coerce.number().int().positive(),
    required_minimum_tier_key: z.string().max(40),
    eligibility_criteria: z.record(z.any()),
    apply_tier_multiplier: z.boolean(),
    is_active: z.boolean(),
    display_order: z.coerce.number().int().nonnegative(),
  })
  .partial()
  .strip();

const ACTION_TYPES = [
  "create_account",
  "complete_purchase",
  "money_spent",
  "refer_friend_purchase",
  "newsletter_subscribe",
  "add_birthday",
  "leave_review",
  "social_follow",
  "social_tag",
  "ugc_upload",
  "hair_quiz_complete",
  "order_milestone",
  "manual",
];

const tierCreateSchema = z
  .object({
    tier_key: z.string().min(2).max(40),
    tier_name: z.string().min(1).max(80),
    description: z.string().max(1000).optional(),
    min_crowns: z.coerce.number().int().nonnegative(),
    display_order: z.coerce.number().int().nonnegative(),
    next_purchase_discount_pct: z.coerce.number().min(0).max(100).optional(),
    grants_free_shipping_next: z.boolean().optional(),
    lifetime_discount_pct: z.coerce.number().min(0).max(100).optional(),
    earning_multiplier: z.coerce.number().min(0).max(99).optional(),
    benefits: z.record(z.any()).optional(),
    badge_colour_hex: z.string().max(9).optional(),
    badge_image_url: z.string().max(500).optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const ruleCreateSchema = z
  .object({
    rule_key: z.string().min(2).max(80),
    display_name: z.string().min(1).max(120),
    description: z.string().max(1000).optional(),
    action_type: z.enum(ACTION_TYPES),
    crowns_mode: z.enum(["flat", "per_currency"]),
    crown_value: z.coerce.number().int().positive().optional(),
    unit_currency_per_crown: z.coerce.number().positive().optional(),
    verification_mode: z.enum(["auto", "honor", "manual"]).optional(),
    social_platform: z
      .enum(["instagram", "tiktok", "x", "facebook", "youtube"])
      .nullable()
      .optional(),
    min_order_value: z.coerce.number().nonnegative().optional(),
    max_awards_per_customer_lifetime: z.coerce.number().int().positive().optional(),
    max_awards_per_customer_per_month: z.coerce.number().int().positive().optional(),
    max_awards_per_customer_per_year: z.coerce.number().int().positive().optional(),
    required_minimum_tier_key: z.string().max(40).optional(),
    eligibility_criteria: z.record(z.any()).optional(),
    apply_tier_multiplier: z.boolean().optional(),
    is_active: z.boolean().optional(),
    display_order: z.coerce.number().int().nonnegative().optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateAdjust: mk(adjustSchema),
  validateSubmitAction: mk(submitActionSchema),
  validateReviewSubmission: mk(reviewSubmissionSchema),
  validateTierCreate: mk(tierCreateSchema),
  validateTierUpdate: mkPatch(tierUpdateSchema),
  validateRuleCreate: mk(ruleCreateSchema),
  validateRuleUpdate: mkPatch(ruleUpdateSchema),
  // exported for tests
  adjustSchema,
  submitActionSchema,
  reviewSubmissionSchema,
  tierCreateSchema,
  ruleCreateSchema,
};
