/**
 * Point of Sale (V2.2 §6.3) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const money = z.coerce.number();
const posMethod = z.enum([
  "cash",
  "paystack_card",
  "paystack_transfer",
  "opay",
  "nomba_terminal",
  "bank_transfer",
  "points",
  "wallet",
  "voucher",
]);

// ── Terminals ────────────────────────────────────────────
const terminalCreate = z
  .object({
    terminal_code: z.string().min(1).max(40),
    display_name: z.string().min(1).max(160),
    location_id: z.string().uuid(),
    default_sell_location_id: z.string().uuid().optional(),
    device_fingerprint: z.string().max(200).optional(),
    printer_endpoint: z.string().max(200).optional(),
    nomba_terminal_id: z.string().max(80).optional(),
    paystack_terminal_id: z.string().max(80).optional(),
    is_offline_capable: z.boolean().optional(),
    opening_cash_float_ngn: money.nonnegative().optional(),
  })
  .strict();
const terminalUpdate = terminalCreate
  .omit({ terminal_code: true })
  .partial()
  .extend({ is_active: z.boolean().optional() })
  .strict();

// ── PINs ─────────────────────────────────────────────────
const pinSet = z
  .object({
    user_id: z.string().uuid(),
    pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4–6 digits"),
    must_change_pin: z.boolean().optional(),
  })
  .strict();
const pinVerify = z
  .object({ user_id: z.string().uuid(), pin: z.string().regex(/^\d{4,6}$/) })
  .strict();

// ── Sessions ─────────────────────────────────────────────
const sessionOpen = z
  .object({
    terminal_id: z.string().uuid(),
    opening_cash_ngn: money.nonnegative().optional(),
  })
  .strict();
const sessionClose = z
  .object({
    closing_cash_declared: money.nonnegative().optional(),
    variance_explanation: z.string().max(1000).optional(),
  })
  .strict();
const sessionReconcile = z
  .object({ variance_explanation: z.string().max(1000).optional() })
  .strict();

// ── Cash drops ───────────────────────────────────────────
const cashDrop = z
  .object({
    session_id: z.string().uuid(),
    amount_ngn: z.coerce.number().positive(),
    reason: z.string().max(120).optional(),
    witnessed_by: z.string().uuid().optional(),
    destination: z.string().max(80).optional(),
    bank_deposit_reference: z.string().max(120).optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

// ── Checkout ─────────────────────────────────────────────
const checkoutLine = z
  .object({
    variant_id: z.string().uuid(),
    quantity: z.coerce.number().int().positive(),
    unit_price_ngn: money.optional(),
    notes: z.string().max(300).optional(),
  })
  .strict();
const checkoutPayment = z
  .object({
    method: posMethod,
    amount_ngn: z.coerce.number().positive(),
    provider: z.string().max(40).optional(),
    provider_reference: z.string().max(120).optional(),
    approval_code: z.string().max(60).optional(),
    card_last4: z.string().length(4).optional(),
    cash_tendered_ngn: money.optional(),
    cash_returned_ngn: money.optional(),
  })
  .strict();
const checkout = z
  .object({
    session_id: z.string().uuid(),
    lines: z.array(checkoutLine).min(1),
    payments: z.array(checkoutPayment).min(1),
    customer_contact_id: z.string().uuid().optional(),
    is_walk_in: z.boolean().optional(),
    sales_campaign_id: z.string().uuid().optional(),
    campaign_slug: z.string().max(120).optional(),
    client_idempotency_key: z.string().max(80).optional(),
    was_offline: z.boolean().optional(),
    receipt_emailed_to: z.string().email().optional(),
    receipt_whatsapp_to: z.string().max(40).optional(),
  })
  .strict();

// ── Void ─────────────────────────────────────────────────
const voidTxn = z
  .object({
    void_type: z.enum(["line_void", "full_void", "refund"]).optional(),
    voided_line_id: z.string().uuid().optional(),
    amount_ngn: money.optional(),
    reason: z.string().min(1).max(500),
  })
  .strict();

const mw = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body ?? {});
  next();
};

module.exports = {
  validateTerminalCreate: mw(terminalCreate),
  validateTerminalUpdate: mw(terminalUpdate),
  validatePinSet: mw(pinSet),
  validatePinVerify: mw(pinVerify),
  validateSessionOpen: mw(sessionOpen),
  validateSessionClose: mw(sessionClose),
  validateSessionReconcile: mw(sessionReconcile),
  validateCashDrop: mw(cashDrop),
  validateCheckout: mw(checkout),
  validateVoid: mw(voidTxn),
};
