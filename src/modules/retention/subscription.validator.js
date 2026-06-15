/**
 * Wig subscription (F-1 / PD §6.23.5) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const planCreateSchema = z
  .object({
    plan_key: z.string().min(2).max(60),
    display_name: z.string().min(1).max(160),
    description: z.string().max(1000).optional(),
    billing_cycle: z.enum(["monthly", "quarterly", "annually"]),
    units_per_cycle: z.coerce.number().int().positive().optional(),
    price_ngn: z.coerce.number().positive(),
    discount_pct_vs_retail: z.coerce.number().min(0).max(100).optional(),
    selection_mode: z
      .enum(["customer_picks", "curator_picks", "surprise_me"])
      .optional(),
    benefits: z.record(z.any()).optional(),
    is_active: z.boolean().optional(),
    display_order: z.coerce.number().int().optional(),
    // Wig-maintenance add-on (§6.23.5): optional recurring fee billed on top of
    // price_ngn for subscribers who opt in.
    maintenance_fee_ngn: z.coerce.number().min(0).optional(),
  })
  .strict();

const planUpdateSchema = planCreateSchema.partial().omit({ plan_key: true });

const enrolSchema = z
  .object({
    contact_id: z.string().uuid(),
    plan_id: z.string().uuid(),
    paystack_authorization_code: z.string().max(120).optional(),
    paystack_customer_code: z.string().max(120).optional(),
    preferences: z.record(z.any()).optional(),
    default_delivery_address_id: z.string().uuid().optional(),
    maintenance_addon: z.boolean().optional(), // opt into the wig-maintenance add-on
  })
  .strict();

const reasonSchema = z
  .object({ reason: z.string().max(500).optional() })
  .strict();
const activeSchema = z.object({ is_active: z.boolean() }).strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validatePlanCreate: mk(planCreateSchema),
  validatePlanUpdate: mk(planUpdateSchema),
  validateEnrol: mk(enrolSchema),
  validateReason: mk(reasonSchema),
  validateActive: mk(activeSchema),
  planCreateSchema,
  enrolSchema,
};
