/**
 * Sales (V2.2 §6.2) — Zod validators.
 */

"use strict";

const { z } = require("zod");
const money = z.coerce.number().nonnegative();

const lineInput = z
  .object({
    // A line sells EITHER a product variant OR a service (Stylist Studio PR3).
    variant_id: z.string().uuid().optional(),
    quantity: z.coerce.number().int().positive(),
    unit_price_ngn: money.optional(), // default: variant channel / service price
    notes: z.string().max(500).optional(),
    // What this line is + provenance. Defaults to 'product' (or 'service' when
    // a service_offering_id is given) in the service layer.
    line_kind: z.enum(["product", "styled", "bundle", "service"]).optional(),
    service_offering_id: z.string().uuid().optional(),
    styled_id: z.string().uuid().optional(),
    // Snapshot overrides (e.g. a styled-product checkout line).
    product_name_snapshot: z.string().max(300).optional(),
    variant_label_snapshot: z.string().max(300).optional(),
    sku_snapshot: z.string().max(120).optional(),
  })
  .strict()
  .refine((v) => !!v.variant_id || !!v.service_offering_id, {
    message: "each line needs a variant_id or a service_offering_id",
  });

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
      "sales_campaign",
      "walk_in",
    ]),
    order_type: z
      .enum(["walk_in", "dispatch", "digital", "collection"])
      .optional(),
    is_custom_order: z.boolean().optional(),
    lines: z.array(lineInput).min(1),
    sales_campaign_id: z.string().uuid().optional(),
    campaign_slug: z.string().optional(),
    coupon_code: z.string().max(60).optional(),
    redeem_points: z.coerce.number().int().positive().optional(),
    bundle_id: z.string().uuid().optional(),
    client_idempotency_key: z.string().max(80).optional(),
    shipping_fee_ngn: money.optional(),
    // Flexi Pay (D1): the BUYER's explicit choice. Defaults to 'full' in the
    // service — nobody becomes an instalment customer by accident.
    payment_plan: z.enum(["full", "instalment"]).optional(),
    // Override the business-default deposit % for a deposit_triggered order.
    required_deposit_pct: z.coerce.number().min(0).max(100).optional(),
    utm_source: z.string().max(80).optional(),
    utm_medium: z.string().max(80).optional(),
    utm_campaign: z.string().max(120).optional(),
    // Stylist Programme referral capture (§6.26 Q17) — validated upstream
    // against shared.stylist_referral_links before it reaches the order.
    stylist_referral_code: z.string().max(80).optional(),
    // Staff attribution (Performance → Insights): the staff member credited
    // with closing this sale. Defaults to the acting user in the controller;
    // a supervisor entering an order for a colleague can override it here.
    // Left null for customer self-service (storefront / public form).
    closed_by_user_id: z.string().uuid().optional().nullable(),
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
      "subscription_recurring",
      // D13: customer paid by direct bank transfer, staff records it. Only
      // honoured when business_config.allow_staff_recorded_manual_payments
      // is on (enforced in the service) and the bank reference is supplied.
      "bank_transfer",
    ]),
    amount_ngn: z.coerce.number().positive(),
    provider: z.string().max(40),
    provider_reference: z.string().max(200).optional(),
    // Foreign-currency settlement (V2.2 §6.6 realised FX gain/loss).
    paid_currency: z.string().length(3).optional(),
    paid_amount: z.coerce.number().positive().optional(),
    fx_rate_used: z.coerce.number().positive().optional(),
    fee_ngn: money.optional(),
    payment_path: z.enum(["gateway", "staff_recorded"]),
    // Mandatory for staff_recorded (refined below): the bank's transaction
    // reference + bank name, reconciled against the statement import (§6.6).
    manual_bank_transaction_id: z.string().min(3).max(200).optional(),
    manual_bank_name: z.string().min(2).max(120).optional(),
    notes: z.string().max(1000).optional(),
    client_idempotency_key: z.string().max(120).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.payment_path === "staff_recorded") {
      if (v.method !== "bank_transfer")
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "staff_recorded payments must use method bank_transfer",
        });
      if (!v.manual_bank_transaction_id)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "manual_bank_transaction_id is required",
          path: ["manual_bank_transaction_id"],
        });
      if (!v.manual_bank_name)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "manual_bank_name is required",
          path: ["manual_bank_name"],
        });
    }
    if (v.payment_path === "gateway" && !v.provider_reference)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "provider_reference is required for gateway payments",
        path: ["provider_reference"],
      });
  });

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
    // Snapshot overrides (e.g. a styled-product quote line) — see lineInput.
    product_name_snapshot: z.string().max(300).optional(),
    variant_label_snapshot: z.string().max(300).optional(),
    sku_snapshot: z.string().max(120).optional(),
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
        "sales_campaign",
        "walk_in",
      ])
      .optional(),
  })
  .strict();
// Accept: optionally convert to an order in the same step (order-first
// fallback, for sales paid offline rather than through the quote's pay link).
// Reuses the convert schema's channel enum so the two stay in lockstep.
const quotationAccept = quotationConvert
  .extend({ convert: z.boolean().optional() })
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

const paymentLink = z
  .object({
    amount_ngn: z.coerce.number().positive().optional(),
    currency: z.string().length(3).optional(),
  })
  .strict();

const setDeliveryFee = z
  .object({ fee_ngn: z.coerce.number().nonnegative() })
  .strict();

// Manual status move from the drawer — only the fulfilment stages are settable
// here (payment + cancel states are automatic; the service rejects anything else).
const orderStatusSet = z
  .object({
    status: z.enum(["assigned", "order_ready", "dispatched", "completed"]),
  })
  .strict();

// Sales Report export — query params. from/to are inclusive 'YYYY-MM-DD' (both
// optional; omitting both exports all orders). Unknown query keys are stripped.
const reportExport = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  status: z.string().max(40).optional(),
  sales_channel: z.string().max(40).optional(),
});

// Archive restore. `confirm` is the operator's explicit "yes, bring it back as
// a pre-order" after the dry run reported lines that can no longer be re-held.
const orderRestore = z.object({
  confirm: z.boolean().optional(),
});

const mw = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

// Query validator: parse + replace req.query with the validated, stripped set.
const mwQuery = (s) => (req, _res, next) => {
  req.query = s.parse(req.query ?? {});
  next();
};

module.exports = {
  validateOrderCreate: mw(orderCreate),
  validateOrderUpdate: mw(orderUpdate),
  validatePaymentCreate: mw(paymentCreate),
  validatePaymentLink: mw(paymentLink),
  validateQuotationCreate: mw(quotationCreate),
  validateQuotationSend: mw(quotationSend),
  validateQuotationAccept: mw(quotationAccept),
  validateQuotationReject: mw(quotationReject),
  validateQuotationConvert: mw(quotationConvert),
  validateCancellationRequest: mw(cancellationRequest),
  validateCancellationReview: mw(cancellationReview),
  validateSetDeliveryFee: mw(setDeliveryFee),
  validateOrderStatusSet: mw(orderStatusSet),
  validateOrderRestore: mw(orderRestore),
  validateReportExport: mwQuery(reportExport),
  orderCreate,
  orderUpdate,
  paymentCreate,
};
