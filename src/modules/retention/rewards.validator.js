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

const updateSchema = createSchema.partial().omit({ reward_key: true });

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
