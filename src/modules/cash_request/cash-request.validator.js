/**
 * Cash Request & Disbursement (V2.2 §6.32) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const money = z.coerce.number().positive();

const createSchema = z
  .object({
    category_key: z.string().min(1).max(80),
    category_display: z.string().min(1).max(160),
    purpose: z.string().min(1).max(2000),
    needed_by_date: z.string().date().optional(),
    urgency: z.enum(["normal", "urgent", "critical"]).optional(),
    amount_requested_ngn: money,
    currency_code: z.string().length(3).optional(),
    fx_rate_used: z.coerce.number().positive().optional(),
    display_amount: z.coerce.number().positive().optional(),
    recipient_type: z.enum([
      "self_bank",
      "self_cash",
      "third_party_bank",
      "petty_cash",
      "supplier_direct",
    ]),
    recipient_name: z.string().max(200).optional(),
    recipient_bank_name: z.string().max(200).optional(),
    recipient_account_number: z.string().max(40).optional(),
    recipient_account_name: z.string().max(200).optional(),
    requires_settlement: z.boolean().optional(),
    settlement_required_by: z.string().date().optional(),
  })
  .strict();

const decisionSchema = z
  .object({
    decision: z.enum(["approve", "reject", "send_back"]),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const disburseSchema = z
  .object({
    bank_transaction_id: z.string().min(1).max(120),
    bank_transaction_date: z.string().date().optional(),
    bank_name: z.string().max(200).optional(),
    amount_disbursed_ngn: money.optional(),
    disbursement_notes: z.string().max(2000).optional(),
  })
  .strict();

const settleSchema = z
  .object({
    settled_total_receipts_ngn: z.coerce.number().nonnegative(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const cancelSchema = z
  .object({ reason: z.string().max(2000).optional() })
  .strict();

const documentSchema = z.object({
  document_id: z.string().uuid(),
  document_role: z.enum([
    "quote", "pro_forma_invoice", "screenshot", "authorisation",
    "bank_transfer_receipt", "settlement_receipt", "other",
  ]).optional(),
  notes: z.string().max(500).optional(),
}).strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCreate: mk(createSchema),
  validateDecision: mk(decisionSchema),
  validateDisburse: mk(disburseSchema),
  validateSettle: mk(settleSchema),
  validateCancel: mk(cancelSchema),
  validateDocument: mk(documentSchema),
  createSchema,
  decisionSchema,
  disburseSchema,
  settleSchema,
  cancelSchema,
  documentSchema,
};
