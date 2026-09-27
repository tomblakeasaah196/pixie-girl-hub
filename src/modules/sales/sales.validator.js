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
    // Specific Instructions (Q1=A order-level, Q3=A checkbox-gated free text)
    specific_instructions: z.string().max(2000).optional(),
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
    specific_instructions: z.string().max(2000).optional().nullable(),
  })
  .strict();

const specificInstructionsUpdate = z
  .object({
    specific_instructions: z.string().max(2000).nullable(),
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

// Quick Sale "≈ $ total" preview: the draft cart's lines + Naira totals,
// priced in dollars by the USD engine exactly as the pay link will lock them.
const usdQuote = z
  .object({
    lines: z
      .array(
        z
          .object({
            variant_id: z.string().uuid().optional(),
            styled_id: z.string().uuid().optional(),
            service_offering_id: z.string().uuid().optional(),
            line_kind: z.string().max(20).optional(),
            unit_price_ngn: z.coerce.number().nonnegative(),
            quantity: z.coerce.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    total_ngn: z.coerce.number().nonnegative(),
    shipping_fee_ngn: z.coerce.number().nonnegative().optional(),
  })
  .strict();

const setDeliveryFee = z
  .object({ fee_ngn: z.coerce.number().nonnegative() })
  .strict();

// ── Delivery-fee review (PR 3, Care & Accessories) ─────────────────────
// Every one of these is `.strict()`: an unexpected key is a 400, not a
// silently-ignored field. That matters because the fee is money — a caller must
// not be able to smuggle `status`, `agreed_fee_ngn` or `needs_delivery_review`
// past the service's lifecycle by adding a key. Only an authenticated,
// permission-checked staff member reaches these at all (no customer-facing or
// anonymous route), and the fee itself is always human-entered.
const deliveryReviewOpen = z
  .object({ calculation_basis: z.string().max(1000).optional() })
  .strict();

const deliveryReviewFee = z
  .object({
    proposed_fee_ngn: z.coerce.number().nonnegative(),
    // Mandatory: a human calculated this number and must say how, so the
    // decision is reviewable later. Free text — no rate-card or weight input is
    // accepted, because none may be implied.
    calculation_basis: z.string().trim().min(3).max(1000),
  })
  .strict();

const deliveryReviewConsent = z
  .object({
    accepted: z.boolean(),
    // Where the customer said yes/no, and the message or ticket that proves it.
    // A website notice is not consent, so both are required.
    channel: z.string().trim().min(1).max(60),
    reference: z.string().trim().min(1).max(200),
    note: z.string().max(500).optional(),
  })
  .strict();

const deliveryReviewTopUp = z
  .object({ payment_id: z.string().uuid() })
  .strict();

const deliveryReviewRefund = z
  .object({
    credit_note_id: z.string().uuid().optional(),
    refund_payment_id: z.string().uuid().optional(),
    note: z.string().max(500).optional(),
  })
  .strict()
  .refine((v) => v.credit_note_id || v.refund_payment_id, {
    message: "a credit_note_id or a refund_payment_id is required",
  });

const deliveryReviewConfirm = z
  .object({ calculation_basis: z.string().max(1000).optional() })
  .strict();

const deliveryReviewDeclineRoute = z
  .object({ note: z.string().max(500).optional() })
  .strict();

const deliveryReviewQueueQuery = z
  .object({
    status: z
      .enum([
        "all",
        "pending_review",
        "awaiting_customer",
        "accepted",
        "declined",
        "credited",
        "confirmed",
        "cancelled",
      ])
      .optional(),
    page: z.coerce.number().int().positive().max(100000).optional(),
    page_size: z.coerce.number().int().positive().max(100).optional(),
  })
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

// Manual cancel. `reason` is why the operator is cancelling — a stable code
// from the Orders screen's picker (customer_changed_mind, wrong_item, …) or
// free text they typed under "Other". Optional at the API so the auto-cancel
// sweeps and older clients still work; the admin UI asks for one every time,
// because a cancelled order that can't say why it died is what sent staff
// digging through the stock ledger in the first place.
const orderCancel = z
  .object({ reason: z.string().min(1).max(500).optional() })
  .strict();

// Archive restore. `confirm` is the operator's explicit "yes, bring it back as
// a pre-order" after the dry run reported lines that can no longer be re-held.
const orderRestore = z.object({
  confirm: z.boolean().optional(),
});

// ── Change Order (§6.2 amendments) ──────────────────────────
// A line here is the same shape as an order line, plus `line_id`: present =
// "keep this existing line (possibly re-quantified)", absent = "this is new".
// The payload is DECLARATIVE — it is the order's complete new line set, so an
// existing line simply left out is the instruction to remove it. That is what
// lets the Change Order modal work like the Quick Sale cart.
const amendLine = z
  .object({
    // Present = an existing line the operator kept; absent = a new line.
    line_id: z.string().uuid().optional(),
    variant_id: z.string().uuid().optional(),
    quantity: z.coerce.number().int().positive(),
    unit_price_ngn: money.optional(),
    notes: z.string().max(500).optional(),
    line_kind: z.enum(["product", "styled", "bundle", "service"]).optional(),
    service_offering_id: z.string().uuid().optional(),
    styled_id: z.string().uuid().optional(),
    product_name_snapshot: z.string().max(300).optional(),
    variant_label_snapshot: z.string().max(300).optional(),
    sku_snapshot: z.string().max(120).optional(),
  })
  .strict()
  .refine((v) => !!v.line_id || !!v.variant_id || !!v.service_offering_id, {
    message:
      "each line needs a line_id (keeping an existing line) or a variant_id / service_offering_id (adding a new one)",
  });

const deliveryAddressPatch = z
  .object({
    line1: z.string().max(300).optional(),
    line2: z.string().max(300).optional().nullable(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    country: z.string().max(120).optional(),
    country_code: z.string().max(4).optional(),
    zone_code: z.string().max(40).optional(),
    recipient_name: z.string().max(200).optional(),
    recipient_phone: z.string().max(40).optional(),
  })
  .strict();

const orderAmend = z
  .object({
    lines: z.array(amendLine).min(1),
    shipping_fee_ngn: money.optional(),
    order_type: z
      .enum(["walk_in", "dispatch", "digital", "collection"])
      .optional(),
    delivery_address: deliveryAddressPatch.optional(),
    customer_notes: z.string().max(2000).optional(),
    specific_instructions: z.string().max(2000).optional().nullable(),
    // Mandatory on commit: an amendment moves money on an order the customer
    // has already paid, so "why" has to be answerable months later. The
    // preview doesn't need it (nothing is written), hence the separate schema.
    reason: z.string().min(3).max(500),
    reason_category: z
      .enum([
        "wrong_item",
        "customer_change",
        "price_correction",
        "delivery_change",
        "stock_substitution",
        "other",
      ])
      .optional(),
    // The operator's "yes, I've read the consequences" after the dry run.
    acknowledge_warnings: z.boolean().optional(),
    // Default true — the customer is told her order changed unless staff
    // deliberately suppress it (e.g. they are already on the phone with her).
    notify_customer: z.boolean().optional(),
  })
  .strict();

// Preview is read-only, so the mandatory reason (and the commit-only flags)
// are dropped rather than making the modal invent a reason on every keystroke.
const orderAmendPreview = z
  .object({
    lines: z.array(amendLine).min(1),
    shipping_fee_ngn: money.optional(),
    order_type: z
      .enum(["walk_in", "dispatch", "digital", "collection"])
      .optional(),
    delivery_address: deliveryAddressPatch.optional(),
    customer_notes: z.string().max(2000).optional(),
    specific_instructions: z.string().max(2000).optional().nullable(),
  })
  .strict();

// Applying a coupon to an order that was already placed (order-coupon.service).
// The code is upper-cased in the service, not here, so the raw entry survives
// into the "that code doesn't exist" message staff read back.
const orderCouponPreview = z
  .object({
    coupon_code: z.string().min(2).max(60),
  })
  .strict();

const orderCouponApply = z
  .object({
    coupon_code: z.string().min(2).max(60),
    // Free text for the discount row's audit note — "eligible for the loyalty
    // voucher, missed at checkout". Optional: the code and the operator are
    // already stamped, a sentence is a courtesy to whoever reads it later.
    reason: z.string().max(500).optional(),
  })
  .strict();

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
  validateUsdQuote: mw(usdQuote),
  validateQuotationCreate: mw(quotationCreate),
  validateQuotationSend: mw(quotationSend),
  validateQuotationAccept: mw(quotationAccept),
  validateQuotationReject: mw(quotationReject),
  validateQuotationConvert: mw(quotationConvert),
  validateCancellationRequest: mw(cancellationRequest),
  validateCancellationReview: mw(cancellationReview),
  validateSetDeliveryFee: mw(setDeliveryFee),
  validateDeliveryReviewOpen: mw(deliveryReviewOpen),
  validateDeliveryReviewFee: mw(deliveryReviewFee),
  validateDeliveryReviewConsent: mw(deliveryReviewConsent),
  validateDeliveryReviewTopUp: mw(deliveryReviewTopUp),
  validateDeliveryReviewRefund: mw(deliveryReviewRefund),
  validateDeliveryReviewConfirm: mw(deliveryReviewConfirm),
  validateDeliveryReviewDeclineRoute: mw(deliveryReviewDeclineRoute),
  validateDeliveryReviewQueue: mwQuery(deliveryReviewQueueQuery),
  validateOrderStatusSet: mw(orderStatusSet),
  validateOrderCancel: mw(orderCancel),
  validateOrderRestore: mw(orderRestore),
  validateOrderAmend: mw(orderAmend),
  validateOrderAmendPreview: mw(orderAmendPreview),
  validateSpecificInstructions: mw(specificInstructionsUpdate),
  validateOrderCouponPreview: mw(orderCouponPreview),
  validateOrderCouponApply: mw(orderCouponApply),
  validateReportExport: mwQuery(reportExport),
  orderCreate,
  orderUpdate,
  specificInstructionsUpdate,
  paymentCreate,
  orderAmend,
  orderAmendPreview,
  orderCouponPreview,
  orderCouponApply,
};
