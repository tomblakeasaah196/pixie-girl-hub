/**
 * Retail Partners (V2.2 §6.29) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const MOVEMENT_TYPE = [
  "dispatch_to_partner",
  "partner_sale",
  "partner_return",
  "partner_damage",
  "partner_count_adjustment",
  "recall_to_warehouse",
];

const partnerCreate = z
  .object({
    contact_id: z.string().uuid(),
    display_name: z.string().min(1).max(160),
    margin_share_pct: z.coerce.number().min(0).max(100).optional(),
    payment_terms_days: z.coerce.number().int().nonnegative().optional(),
    credit_limit_ngn: z.coerce.number().nonnegative().optional(),
    settlement_frequency: z
      .enum(["weekly", "fortnightly", "monthly", "quarterly"])
      .optional(),
    onboarded_at: z.string().date().optional(),
    contract_document_id: z.string().uuid().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const partnerUpdate = z
  .object({
    display_name: z.string().min(1).max(160).optional(),
    margin_share_pct: z.coerce.number().min(0).max(100).optional(),
    payment_terms_days: z.coerce.number().int().nonnegative().optional(),
    credit_limit_ngn: z.coerce.number().nonnegative().optional(),
    settlement_frequency: z
      .enum(["weekly", "fortnightly", "monthly", "quarterly"])
      .optional(),
    contract_document_id: z.string().uuid().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const statusChange = z
  .object({
    status: z.enum(["pending_approval", "active", "suspended", "terminated"]),
    reason: z.string().max(1000).optional(),
  })
  .strict();

const locationCreate = z
  .object({
    stock_location_id: z.string().uuid(),
    display_name: z.string().min(1).max(160),
    address: z.string().max(500).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    manager_name: z.string().max(160).optional(),
    manager_phone: z.string().max(40).optional(),
  })
  .strict();

const movementRecord = z
  .object({
    consignment_location_id: z.string().uuid(),
    variant_id: z.string().uuid(),
    movement_type: z.enum(MOVEMENT_TYPE),
    units: z.coerce.number().int().positive(),
    unit_retail_price_ngn: z.coerce.number().nonnegative().optional(),
    reported_sale_at: z.string().date().optional(),
    reported_customer_name: z.string().max(200).optional(),
    warehouse_location_id: z.string().uuid().optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

const settlementGenerate = z
  .object({
    partner_id: z.string().uuid(),
    period_start: z.string().date(),
    period_end: z.string().date(),
  })
  .strict();

const settlementPaid = z
  .object({ payment_reference: z.string().max(160).optional() })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validatePartnerCreate: mk(partnerCreate),
  validatePartnerUpdate: mk(partnerUpdate),
  validateStatusChange: mk(statusChange),
  validateLocationCreate: mk(locationCreate),
  validateMovementRecord: mk(movementRecord),
  validateSettlementGenerate: mk(settlementGenerate),
  validateSettlementPaid: mk(settlementPaid),
};
