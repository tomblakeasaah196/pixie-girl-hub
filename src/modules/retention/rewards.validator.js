/**
 * Loyalty rewards catalogue (Module 6.23) — Zod validators.
 */

"use strict";

const { z } = require("zod");
const { mkPatch } = require("./patch-body");

const createSchema = z
  .object({
    reward_key: z.string().min(2).max(80),
    display_name: z.string().min(1).max(160),
    description: z.string().max(1000).optional(),
    reward_type: z.enum(["order_discount", "free_shipping", "free_product", "gift"]),
    points_cost: z.coerce.number().int().positive(),
    discount_type: z.enum(["percentage", "fixed_amount"]).optional(),
    // percentage: fraction (0.10 = 10%); fixed_amount: NGN
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
    // P1-6: default 90; NULL falls back to the same default at redeem
    // time so a legacy reward keeps working.
    voucher_expiry_days: z.coerce.number().int().min(1).max(3650).optional(),
  })
  .strict()
  // P1-1: same rule as coupon.validator — percentage rewards store as a
  // fraction. The Rewards admin UI used to save `10` for "10% off" so the
  // resulting voucher computed 10× the subtotal. The RewardsTab now divides
  // by 100 on save (matching BundlesTab); this is the server backstop.
  .superRefine((v, ctx) => {
    if (
      v.discount_type === "percentage" &&
      v.discount_value !== undefined &&
      !(v.discount_value > 0 && v.discount_value <= 1)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discount_value"],
        message:
          "Percentage reward must be a fraction between 0 and 1 (e.g. 0.10 for 10%).",
      });
    }
  });

// The admin drawers edit an existing row and submit the whole object back, so
// the update payload carries server-owned keys (reward_id, total_redeemed, …)
// and null-valued optionals for the reward types that don't use them (e.g.
// free_product_id / valid_to on an order_discount). cleanPatch() (in mkPatch)
// drops null/""/undefined first so those never trip the uuid/string/positive
// checks, and strip() removes the remaining unknown keys.
// createSchema is a ZodEffects wrapper (superRefine); reach into the inner
// shape for the update variant and re-attach the percentage guard.
const updateSchema = createSchema._def.schema
  .omit({ reward_key: true })
  .partial()
  .strip()
  .superRefine((v, ctx) => {
    if (
      v.discount_type === "percentage" &&
      v.discount_value !== undefined &&
      !(v.discount_value > 0 && v.discount_value <= 1)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discount_value"],
        message:
          "Percentage reward must be a fraction between 0 and 1 (e.g. 0.10 for 10%).",
      });
    }
  });

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
