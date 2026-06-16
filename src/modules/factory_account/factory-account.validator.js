"use strict";

const { z } = require("zod");

const PAYMENT_METHODS = ["paypal", "alipay", "bank_transfer", "wechat", "alibaba", "cash", "other"];
const ENTRY_TYPES = ["order_charge", "payment", "shipping_fee", "customs_duty", "discount", "bank_charge", "misc_charge", "misc_credit", "adjustment"];
const SHIPMENT_STATUSES = ["dispatched", "in_transit", "arrived_lagos", "cleared_customs", "received", "cancelled"];

// ── Accounts ─────────────────────────────────────────────
const accountCreate = z.object({
  supplier_id: z.string().uuid(),
  account_name: z.string().min(1).max(200),
  base_currency: z.string().length(3).default("CNY"),
  credit_alert_threshold: z.coerce.number().positive().optional(),
  notes: z.string().max(2000).optional(),
}).strict();

const accountUpdate = z.object({
  account_name: z.string().min(1).max(200).optional(),
  credit_alert_threshold: z.coerce.number().positive().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  is_active: z.boolean().optional(),
}).strict();

// ── Ledger entries ────────────────────────────────────────
const ledgerEntry = z.object({
  entry_type: z.enum(ENTRY_TYPES),
  direction: z.enum(["DR", "CR"]),
  amount_original: z.coerce.number().positive(),
  original_currency: z.string().length(3).default("CNY"),
  fx_rate_to_base: z.coerce.number().positive().default(1),
  reference_type: z.string().max(50).optional(),
  reference_id: z.string().uuid().optional(),
  description: z.string().max(500).optional(),
  entry_date: z.string().date().optional(),
  payment_method: z.enum(PAYMENT_METHODS).optional(),
  paid_by: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
}).strict();

const ledgerReconcile = z.object({
  entry_ids: z.array(z.string().uuid()).min(1),
}).strict();

// ── Shipments ─────────────────────────────────────────────
const shipmentCreate = z.object({
  account_id: z.string().uuid(),
  supplier_id: z.string().uuid(),
  courier: z.string().min(1).max(100),
  tracking_number: z.string().max(200).optional(),
  courier_fee_original: z.coerce.number().nonnegative().optional(),
  courier_fee_currency: z.string().length(3).default("CNY"),
  shipped_at: z.string().date().optional(),
  estimated_arrival: z.string().date().optional(),
  notes: z.string().max(2000).optional(),
  items: z.array(z.object({
    po_line_id: z.string().uuid().optional(),
    sku_description: z.string().max(500).optional(),
    quantity_shipped: z.coerce.number().int().positive(),
    unit_price_base: z.coerce.number().nonnegative().optional(),
  })).min(1),
}).strict();

const shipmentAdvance = z.object({
  status: z.enum(SHIPMENT_STATUSES),
  arrived_at: z.string().date().optional(),
  notes: z.string().max(2000).optional(),
}).strict();

const shipmentUpdate = z.object({
  courier: z.string().min(1).max(100).optional(),
  tracking_number: z.string().max(200).nullable().optional(),
  courier_fee_original: z.coerce.number().nonnegative().nullable().optional(),
  courier_fee_currency: z.string().length(3).optional(),
  shipped_at: z.string().date().nullable().optional(),
  estimated_arrival: z.string().date().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).strict();

const makeValidator = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    return res.status(422).json({
      error: "Validation failed",
      details: result.error.flatten().fieldErrors,
    });
  }
  req.body = result.data;
  next();
};

module.exports = {
  validateAccountCreate: makeValidator(accountCreate),
  validateAccountUpdate: makeValidator(accountUpdate),
  validateLedgerEntry: makeValidator(ledgerEntry),
  validateLedgerReconcile: makeValidator(ledgerReconcile),
  validateShipmentCreate: makeValidator(shipmentCreate),
  validateShipmentAdvance: makeValidator(shipmentAdvance),
  validateShipmentUpdate: makeValidator(shipmentUpdate),
};
