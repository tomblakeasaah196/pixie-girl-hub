/**
 * Coupon engine (F-3 / PD §6.23.2) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const discountType = z.enum([
  "percentage",
  "fixed_amount",
  "free_shipping",
  "buy_x_get_y",
]);

const createSchema = z
  .object({
    coupon_code: z.string().min(2).max(60),
    display_name: z.string().min(1).max(160),
    description: z.string().max(1000).optional(),
    discount_type: discountType,
    // percentage: fraction (0.10 = 10%); fixed_amount: NGN; others: 0
    discount_value: z.coerce.number().nonnegative(),
    currency: z.string().length(3).optional(),
    min_order_value: z.coerce.number().nonnegative().optional(),
    max_discount_value: z.coerce.number().nonnegative().optional(),
    applies_to_products: z.array(z.string().uuid()).optional(),
    applies_to_categories: z.array(z.string().uuid()).optional(),
    customer_segment_id: z.string().uuid().optional(),
    first_time_only: z.boolean().optional(),
    valid_from: z.string().datetime().optional(),
    valid_to: z.string().datetime().optional(),
    total_usage_limit: z.coerce.number().int().positive().optional(),
    per_customer_limit: z.coerce.number().int().positive().optional(),
    is_single_use: z.boolean().optional(),
    is_active: z.boolean().optional(),
    metadata: z.record(z.any()).optional(),
  })
  .strict();

const updateSchema = createSchema.partial().omit({ coupon_code: true });

const validateSchema = z
  .object({
    code: z.string().min(2).max(60),
    contact_id: z.string().uuid().optional(),
    order_subtotal_ngn: z.coerce.number().nonnegative(),
  })
  .strict();

const activeSchema = z.object({ is_active: z.boolean() }).strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCreate: mk(createSchema),
  validateUpdate: mk(updateSchema),
  validateCheck: mk(validateSchema),
  validateActive: mk(activeSchema),
  createSchema,
  updateSchema,
  validateSchema,
};
