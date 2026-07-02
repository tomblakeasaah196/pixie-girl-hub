/**
 * Loyalty earn-rules (Module 6.23) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const createSchema = z
  .object({
    rule_key: z.string().min(2).max(80),
    display_name: z.string().min(1).max(160),
    description: z.string().max(1000).optional(),
    action_type: z.enum([
      "earned_purchase",
      "earned_review",
      "earned_referral",
      "earned_milestone",
      "earned_social_share",
      "earned_bonus",
    ]),
    points_mode: z.enum(["flat", "per_currency"]),
    points_value: z.coerce.number().int().nonnegative().optional(),
    currency_per_point: z.coerce.number().positive().optional(),
    apply_tier_multiplier: z.boolean().optional(),
    min_order_value: z.coerce.number().nonnegative().optional(),
    max_awards_per_customer_lifetime: z.coerce.number().int().positive().optional(),
    rate_limit_days: z.coerce.number().int().positive().optional(),
    max_per_window: z.coerce.number().int().positive().optional(),
    points_expire_days: z.coerce.number().int().positive().optional(),
    eligibility_criteria: z.record(z.any()).optional(),
    is_active: z.boolean().optional(),
    display_order: z.coerce.number().int().optional(),
  })
  .strict();

// The admin drawer submits the whole existing row back on edit, so the payload
// carries read-only keys (rule_id, …) and null-valued optionals. `.strip()`
// drops unknown keys and nullish() tolerates the nulls.
const updateSchema = createSchema
  .omit({ rule_key: true })
  .extend({
    description: z.string().max(1000).nullish(),
    points_value: z.coerce.number().int().nonnegative().nullish(),
    currency_per_point: z.coerce.number().positive().nullish(),
    points_expire_days: z.coerce.number().int().positive().nullish(),
  })
  .partial()
  .strip();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = { validateCreate: mk(createSchema), validateUpdate: mk(updateSchema) };
