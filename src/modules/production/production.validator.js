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
// The DB's cost_components.cost_type CHECK, mirrored so a typo is a 422 with a
// readable message rather than a raw constraint violation.
const COST_TYPES = [
  "factory_unit_cost",
  "factory_overhead",
  "raw_hair",
  "freight_international",
  "customs_duty",
  "customs_clearing_fee",
  "port_storage",
  "3pl_lagos",
  "styling_intercompany",
  "packaging",
  "quality_inspection",
  "wastage",
  "samples",
  "misc",
];

/** One product on a run: what it is, how many, and what the factory charges. */
const productLine = z
  .object({
    variant_id: z.string().uuid().optional(),
    quantity: z.coerce.number().int().positive().max(10000),
    unit_cost: z.coerce.number().nonnegative().optional(),
    description: z.string().max(300).optional(),
  })
  .strict();

const runCreate = z
  .object({
    title: z.string().min(1).max(200),
    status: z.enum(RUN_STATUS).optional(),
    units_planned: z.coerce.number().int().min(0).optional(),
    supplier_id: z.string().uuid().optional(),
    po_id: z.string().uuid().optional(),
    currency: z.string().length(3).optional(),
    fx_rate_used: z.coerce.number().positive().optional(),
    lines: z.array(productLine).max(200).optional(),
    planned_start_date: z.string().date().optional(),
    expected_ready_date: z.string().date().optional(),
    expected_arrival_date: z.string().date().optional(),
    incurred_at: z.string().date().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const productsAdd = z
  .object({
    lines: z.array(productLine).min(1).max(200),
    currency: z.string().length(3).optional(),
    fx_rate_used: z.coerce.number().positive().optional(),
    incurred_at: z.string().date().optional(),
  })
  .strict();

const runAdvance = z.object({ status: z.enum(RUN_STATUS) }).strict();

const costAdd = z
  .object({
    cost_type: z.enum(COST_TYPES),
    amount: z.coerce.number().positive(),
    currency: z.string().length(3),
    fx_rate_used: z.coerce.number().positive().optional(),
    amount_ngn: z.coerce.number().positive().optional(),
    applies_to_units: z.coerce.number().int().positive().optional(),
    description: z.string().max(500).optional(),
    invoice_reference: z.string().max(120).optional(),
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

const reworkAdd = z
  .object({
    reason: z.string().min(1).max(500),
    qc_finding: z.string().max(500).optional(),
    extra_cost_ngn: z.coerce.number().nonnegative().optional(),
    delay_days: z.coerce.number().int().nonnegative().optional(),
    outcome: z.enum(["passed", "still_failing", "scrapped"]).optional(),
    rework_completed_at: z.string().datetime().optional(),
    incurred_at: z.string().date().optional(),
    notes: z.string().max(1000).optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  COST_TYPES,
  validateRunCreate: mk(runCreate),
  validateProductsAdd: mk(productsAdd),
  validateRunAdvance: mk(runAdvance),
  validateCostAdd: mk(costAdd),
  validateUnitAdd: mk(unitAdd),
  validateReceive: mk(receive),
  validateReworkAdd: mk(reworkAdd),
};
