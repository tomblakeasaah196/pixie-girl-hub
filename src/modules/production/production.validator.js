/**
 * Production & Landed Cost (V2.2 §6.24) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const RUN_STATUS = [
  "planned",
  "funded",
  "in_production",
  "quality_check",
  "ready_to_ship",
  "in_transit",
  "arrived_lagos",
  "cleared_customs",
  "received",
  "completed",
  "cancelled",
];
const JOB_STATUS = [
  "pending",
  "in_progress",
  "on_hold",
  "completed",
  "rejected",
  "cancelled",
];

const runCreate = z
  .object({
    title: z.string().min(1).max(200),
    status: z.enum(RUN_STATUS).optional(),
    units_planned: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const runAdvance = z.object({ status: z.enum(RUN_STATUS) }).strict();

const costAdd = z
  .object({
    cost_type: z.string().min(1).max(40),
    amount: z.coerce.number().positive(),
    currency: z.string().length(3),
    fx_rate_used: z.coerce.number().positive().optional(),
    amount_ngn: z.coerce.number().positive().optional(),
    incurred_at: z.string().date().optional(),
  })
  .strict();

const unitAdd = z
  .object({
    variant_id: z.string().uuid().optional(),
    status: z.string().max(40).optional(),
  })
  .strict();

const receive = z
  .object({
    variant_id: z.string().uuid(),
    location_id: z.string().uuid(),
    quantity: z.coerce.number().int().positive(),
    unit_cost_ngn: z.coerce.number().nonnegative().optional(),
  })
  .strict();

const serviceJobCreate = z
  .object({
    service_type_id: z.string().uuid(),
    hair_variant_id: z.string().uuid().optional(),
    sales_order_id: z.string().uuid().optional(),
    customer_contact_id: z.string().uuid().optional(),
    assigned_staff_user_id: z.string().uuid().optional(),
    agreed_cost_ngn: z.coerce.number().nonnegative().optional(),
  })
  .strict();

const serviceJobAdvance = z
  .object({
    status: z.enum(JOB_STATUS),
    actual_cost_ngn: z.coerce.number().nonnegative().optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateRunCreate: mk(runCreate),
  validateRunAdvance: mk(runAdvance),
  validateCostAdd: mk(costAdd),
  validateUnitAdd: mk(unitAdd),
  validateReceive: mk(receive),
  validateServiceJobCreate: mk(serviceJobCreate),
  validateServiceJobAdvance: mk(serviceJobAdvance),
};
