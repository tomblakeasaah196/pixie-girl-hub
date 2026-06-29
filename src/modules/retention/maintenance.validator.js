/**
 * Maintenance plans (Module 6.23) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const createSchema = z
  .object({
    plan_key: z.string().min(2).max(80),
    display_name: z.string().min(1).max(160),
    description: z.string().max(1000).optional(),
    billing_cycle: z.enum(["monthly", "quarterly", "semi_annual", "annual"]),
    price_ngn: z.coerce.number().positive(),
    included_services: z.array(z.any()).optional(),
    extra_service_discount_pct: z.coerce.number().min(0).max(100).optional(),
    benefits: z.record(z.any()).optional(),
    is_active: z.boolean().optional(),
    display_order: z.coerce.number().int().optional(),
  })
  .strict();

const updateSchema = createSchema.partial().omit({ plan_key: true });

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = { validateCreate: mk(createSchema), validateUpdate: mk(updateSchema) };
