/**
 * Sales (V2.2 §6.2) — Zod validators.
 */

"use strict";

const { z } = require("zod");
const money = z.coerce.number().nonnegative();

const lineInput = z
  .object({
    variant_id: z.string().uuid(),
    quantity: z.coerce.number().int().positive(),
    unit_price_ngn: money.optional(), // default: variant channel price
    notes: z.string().max(500).optional(),
  })
  .strict();

const orderCreate = z
  .object({
    contact_id: z.string().uuid(),
    sales_channel: z.enum([
      "storefront",
      "pos",
      "woocommerce",
      "instagram",
      "whatsapp",
      "wholesale",
      "partner",
      "stylist_routed",
      "subscription",
      "phone",
      "event",
      "public_form",
      "facebook",
      "tiktok",
      "intercompany",
    ]),
    order_type: z
      .enum(["walk_in", "dispatch", "digital", "collection"])
      .optional(),
    is_custom_order: z.boolean().optional(),
    lines: z.array(lineInput).min(1),
    sales_campaign_id: z.string().uuid().optional(),
    campaign_slug: z.string().optional(),
    shipping_fee_ngn: money.optional(),
    // Override the business-default deposit % for a deposit_triggered order.
    required_deposit_pct: z.coerce.number().min(0).max(100).optional(),
    utm_source: z.string().max(80).optional(),
    utm_medium: z.string().max(80).optional(),
    utm_campaign: z.string().max(120).optional(),
  })
  .strict();

const paymentCreate = z
  .object({
    method: z.enum([
      "paystack_card",
      "paystack_transfer",
      "paystack_ussd",
      "opay",
      "nomba_terminal",
      "bank_transfer",
      "cash",
      "pos_card",
      "pay_on_delivery",
      "wallet",
      "points",
      "subscription_recurring",
    ]),
    amount_ngn: z.coerce.number().positive(),
    provider: z.string().max(40).optional(),
    provider_reference: z.string().max(200).optional(),
    // Foreign-currency settlement (V2.2 §6.6 realised FX gain/loss).
    paid_currency: z.string().length(3).optional(),
    paid_amount: z.coerce.number().positive().optional(),
    fx_rate_used: z.coerce.number().positive().optional(),
    fee_ngn: money.optional(),
    payment_path: z
      .enum([
        "tokenized_link",
        "customer_account",
        "staff_recorded",
        "pos",
        "intercompany",
        "subscription_charge",
      ])
      .optional(),
    client_idempotency_key: z.string().max(120).optional(),
  })
  .strict();

const orderUpdate = z
  .object({
    order_type: z
      .enum(["walk_in", "dispatch", "digital", "collection"])
      .optional(),
    shipping_fee_ngn: money.optional(),
    utm_source: z.string().max(80).optional(),
    utm_medium: z.string().max(80).optional(),
    utm_campaign: z.string().max(120).optional(),
  })
  .strict();

const quoteLine = z
  .object({
    variant_id: z.string().uuid(),
    quantity: z.coerce.number().int().positive(),
    unit_price_ngn: money.optional(),
    line_discount_ngn: money.optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();
const quotationCreate = z
  .object({
    contact_id: z.string().uuid(),
    deal_id: z.string().uuid().optional(),
    lines: z.array(quoteLine).min(1),
    valid_until: z.string().date().optional(),
    payment_terms: z.string().max(300).optional(),
    notes: z.string().max(2000).optional(),
    internal_notes: z.string().max(2000).optional(),
    delivery_type: z
      .enum(["walk_in", "dispatch", "digital", "collection"])
      .optional(),
    coupon_code: z.string().max(60).optional(),
    shipping_fee_ngn: money.optional(),
  })
  .strict();
const quotationSend = z
  .object({
    sent_via: z
      .enum(["whatsapp", "email", "instagram_dm", "pdf_print", "sms"])
      .optional(),
  })
  .strict();
const quotationReject = z
  .object({ reason: z.string().max(500).optional() })
  .strict();
const quotationConvert = z
  .object({
    sales_channel: z
      .enum([
        "storefront",
        "pos",
        "woocommerce",
        "instagram",
        "whatsapp",
        "wholesale",
        "partner",
        "stylist_routed",
        "subscription",
        "phone",
        "event",
        "public_form",
        "facebook",
        "tiktok",
        "intercompany",
      ])
      .optional(),
  })
  .strict();

const cancellationRequest = z
  .object({
    reason: z.string().min(1).max(500),
    reason_category: z
      .enum(["changed_mind", "wrong_item", "delay", "price", "other"])
      .optional(),
    requested_by_contact_id: z.string().uuid().optional(),
  })
  .strict();
const cancellationReview = z
  .object({ notes: z.string().max(1000).optional() })
  .strict();

const mw = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

module.exports = {
  validateOrderCreate: mw(orderCreate),
  validateOrderUpdate: mw(orderUpdate),
  validatePaymentCreate: mw(paymentCreate),
  validateQuotationCreate: mw(quotationCreate),
  validateQuotationSend: mw(quotationSend),
  validateQuotationReject: mw(quotationReject),
  validateQuotationConvert: mw(quotationConvert),
  validateCancellationRequest: mw(cancellationRequest),
  validateCancellationReview: mw(cancellationReview),
  orderCreate,
  orderUpdate,
  paymentCreate,
};
