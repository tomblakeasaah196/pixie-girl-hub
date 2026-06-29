/**
 * Referral programme admin (Module 6.23) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const settingsSchema = z
  .object({
    is_active: z.boolean().optional(),
    reward_on: z.enum(["order_placed", "full_settlement"]).optional(),
    friend_discount_type: z.enum(["percentage", "fixed_amount"]).nullable().optional(),
    friend_discount_value: z.coerce.number().nonnegative().nullable().optional(),
    friend_min_order_value: z.coerce.number().nonnegative().nullable().optional(),
    default_referrer_points: z.coerce.number().int().nonnegative().optional(),
    default_referrer_credit_ngn: z.coerce.number().nonnegative().optional(),
    min_qualifying_order_ngn: z.coerce.number().nonnegative().optional(),
    anti_fraud: z.record(z.any()).optional(),
  })
  .strict();

const tierSchema = z
  .object({
    display_name: z.string().max(80).optional(),
    min_successful_referrals: z.coerce.number().int().min(1),
    referrer_points: z.coerce.number().int().nonnegative().optional(),
    referrer_credit_ngn: z.coerce.number().nonnegative().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const tierUpdateSchema = tierSchema.partial();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateSettings: mk(settingsSchema),
  validateTier: mk(tierSchema),
  validateTierUpdate: mk(tierUpdateSchema),
};
