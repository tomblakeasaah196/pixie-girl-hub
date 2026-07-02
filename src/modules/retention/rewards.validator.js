/**
 * Loyalty rewards catalogue (Module 6.23) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const createSchema = z
  .object({
    reward_key: z.string().min(2).max(80),
    display_name: z.string().min(1).max(160),
    description: z.string().max(1000).optional(),
    reward_type: z.enum(["order_discount", "free_shipping", "free_product", "gift"]),
    points_cost: z.coerce.number().int().positive(),
    discount_type: z.enum(["percentage", "fixed_amount"]).optional(),
    discount_value: z.coerce.number().nonnegative().optional(),
    max_discount_value: z.coerce.number().nonnegative().optional(),
    free_product_id: z.string().uuid().optional(),
    free_variant_id: z.string().uuid().optional(),
    gift_description: z.string().max(400).optional(),
    min_tier_id: z.string().uuid().optional(),
    max_redemptions_per_customer: z.coerce.number().int().positive().optional(),
    total_redemption_limit: z.coerce.number().int().positive().optional(),
    valid_from: z.string().optional(),
    valid_to: z.string().optional(),
    is_active: z.boolean().optional(),
    display_order: z.coerce.number().int().optional(),
    metadata: z.record(z.any()).optional(),
  })
  .strict();

// The admin drawers edit an existing row and submit the whole object back,
// so the update payload carries server-owned/read-only keys (reward_id,
// total_redeemed, …) and null-valued optionals for the reward types that
// don't use them. `.strip()` drops the unknown keys instead of 400-ing, and
// nullish() tolerates the nulls that the list rows carry.
const updateSchema = createSchema
  .omit({ reward_key: true })
  .extend({
    description: z.string().max(1000).nullish(),
    discount_type: z.enum(["percentage", "fixed_amount"]).nullish(),
    discount_value: z.coerce.number().nonnegative().nullish(),
    max_discount_value: z.coerce.number().nonnegative().nullish(),
  })
  .partial()
  .strip();

const redeemSchema = z
  .object({
    contact_id: z.string().uuid(),
    reward_id: z.string().uuid(),
    reference_type: z.string().max(40).optional(),
    reference_id: z.string().uuid().optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCreate: mk(createSchema),
  validateUpdate: mk(updateSchema),
  validateRedeem: mk(redeemSchema),
};
