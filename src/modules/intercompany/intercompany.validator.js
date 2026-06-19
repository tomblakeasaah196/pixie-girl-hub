/**
 * Inter-Company Transactions (V2.2 §5.1) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const recordSchema = z
  .object({
    flow_type: z.enum([
      "styling",
      "wholesale",
      "expense_recharge",
      "asset_transfer",
    ]),
    seller_brand: z.string().min(1).max(63),
    buyer_brand: z.string().min(1).max(63),
    currency: z.string().length(3).optional(),
    amount: z.coerce.number().positive(),
    amount_ngn: z.coerce.number().positive().optional(),
    fx_rate_used: z.coerce.number().positive().optional(),
    min_margin_floor_pct: z.coerce.number().min(0).max(100),
    seller_doc_type: z.string().max(40).optional(),
    seller_doc_id: z.string().uuid(),
    seller_doc_number: z.string().min(1).max(60),
    reference_type: z.string().max(60).optional(),
    reference_id: z.string().uuid().optional(),
    description: z.string().min(1).max(2000),
  })
  .strict();

const rejectSchema = z
  .object({
    reason: z.string().max(2000).optional(),
  })
  .strict();

const reconciliationSchema = z
  .object({
    discrepancy_type: z.enum([
      "amount_mismatch",
      "currency_mismatch",
      "status_mismatch",
      "missing_buyer_doc",
      "missing_seller_doc",
      "duplicate_match",
    ]),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateRecord: mk(recordSchema),
  validateReject: mk(rejectSchema),
  validateReconciliation: mk(reconciliationSchema),
};
