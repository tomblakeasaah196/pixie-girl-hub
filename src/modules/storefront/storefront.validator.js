/**
 * E-Commerce Storefront & Channel Sync (V2.2 §6.4) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const orderFormSchema = z
  .object({
    first_name: z.string().max(120).optional(),
    last_name: z.string().max(120).optional(),
    phone: z.string().min(4).max(40),
    email: z.string().email().optional(),
    billing_address: z.string().max(500).optional(),
    delivery_address: z.string().max(500).optional(),
    sales_channel: z
      .enum(["public_form", "whatsapp", "instagram", "facebook"])
      .optional(),
    // "pickup" skips delivery pricing entirely (collect in store, ₦0).
    // Defaults to "delivery" — every existing caller before this field
    // existed was a delivery order.
    fulfilment_type: z.enum(["delivery", "pickup"]).optional(),
    // The delivery-zone code the fee resolves against: an NG state
    // ("NG-AB"), a Lagos LGA ("NG-LA-AGEGE"), or an ISO-2 country code
    // for everywhere else (DHL). Required when fulfilment_type is
    // "delivery" — the server ALWAYS quotes the fee itself from this
    // zone; there is deliberately no client-supplied fee field here.
    items: z
      .array(
        z.object({
          variant_id: z.string().uuid(),
          quantity: z.coerce.number().int().positive(),
        }),
      )
      // A service-only checkout has no product lines — the object-level
      // refine below still requires at least one item OR one booking.
      .default([]),
    // Service lines from an order link: booking REQUESTS (customer's
    // preferred date/time; the business confirms from the thread).
    service_bookings: z
      .array(
        z.object({
          service_id: z.string().uuid(),
          qty: z.coerce.number().int().positive().max(20).default(1),
          price_ngn: z.union([z.string(), z.number()]).optional(),
          requested_for: z.string().datetime({ offset: true }).optional(),
          note: z.string().max(280).optional(),
        }),
      )
      .max(10)
      .optional(),
    // Inline welcome-form mirror (no-contact order links): these land in
    // the same tables the Online QR form writes.
    whatsapp_number: z.string().max(40).optional(),
    instagram_handle: z.string().max(80).optional(),
    address: z
      .object({
        line1: z.string().max(240),
        line2: z.string().max(240).optional(),
        area: z.string().max(120).optional(),
        city: z.string().max(120).optional(),
        state: z.string().max(120).optional(),
        country: z.string().max(120).optional(),
        country_code: z.string().max(3).optional(),
        landmark: z.string().max(240).optional(),
      })
      .optional(),
    // Short order-link slug (the `/o/<slug>` checkout) — marks the link used,
    // applies the staff-picked styled prices, and posts thread events.
    order_link_slug: z.string().max(64).optional(),
    utm_source: z.string().max(80).optional(),
    utm_medium: z.string().max(80).optional(),
    utm_campaign: z.string().max(120).optional(),
    // Discount surfaces — so storefront orders resolve in Sales with the same
    // campaign/coupon logic as direct/POS orders.
    coupon_code: z.string().max(60).optional(),
    sales_campaign_id: z.string().uuid().optional(),
    campaign_slug: z.string().max(120).optional(),
    redeem_points: z.coerce.number().int().positive().optional(),
    bundle_id: z.string().uuid().optional(),
    client_idempotency_key: z.string().max(80).optional(),
    // Stylist Programme referral capture (§6.26 Q17).
    referral_code: z.string().max(80).optional(),
    // Flexi Pay (PR-2): 'instalment' raises the order on the flexible plan so
    // the deposit minimum + balance reminders apply. The customer pays via the
    // pay link they receive. Defaults to 'full'.
    payment_plan: z.enum(["full", "instalment"]).optional().default("full"),
  })
  .strict()
  .refine(
    (o) =>
      (o.items && o.items.length > 0) ||
      (o.service_bookings && o.service_bookings.length > 0),
    { message: "At least one item or service booking is required" },
  );

const sessionSchema = z
  .object({
    visitor_id: z.string().min(1).max(120),
    contact_id: z.string().uuid().optional(),
    referrer: z.string().max(500).optional(),
    utm_source: z.string().max(80).optional(),
    utm_medium: z.string().max(80).optional(),
    utm_campaign: z.string().max(120).optional(),
    utm_content: z.string().max(120).optional(),
    utm_term: z.string().max(120).optional(),
    country_code: z.string().length(2).optional(),
    detected_currency: z.string().length(3).optional(),
    device_type: z
      .enum(["desktop", "mobile", "tablet", "bot", "unknown"])
      .optional(),
    os: z.string().max(60).optional(),
    browser: z.string().max(60).optional(),
    user_agent: z.string().max(500).optional(),
  })
  .strict();

const pageViewSchema = z
  .object({
    session_id: z.string().uuid(),
    page_url: z.string().max(1000),
    page_type: z.enum([
      "home",
      "category",
      "product",
      "collection",
      "content_post",
      "cart",
      "checkout",
      "order_confirm",
      "account",
      "quiz",
      "search",
      "custom",
    ]),
    product_id: z.string().uuid().optional(),
    variant_id: z.string().uuid().optional(),
    category_id: z.string().uuid().optional(),
    collection_id: z.string().uuid().optional(),
    content_post_id: z.string().uuid().optional(),
    time_on_page_seconds: z.coerce.number().int().nonnegative().optional(),
    scroll_depth_pct: z.coerce.number().int().min(0).max(100).optional(),
  })
  .strict();

const funnelSchema = z
  .object({
    session_id: z.string().uuid(),
    event_type: z.enum([
      "view_product",
      "add_to_cart",
      "remove_from_cart",
      "view_cart",
      "start_checkout",
      "submit_address",
      "select_payment",
      "submit_payment",
      "payment_succeeded",
      "payment_failed",
      "complete_order",
      "abandon_checkout",
      "add_to_wishlist",
      "quiz_started",
    ]),
  })
  .strict();

// Shop AI Search ("ask Praxis") — free-text query + the last few turns the
// client already displayed, so a follow-up can refine without a session.
const aiSearchSchema = z
  .object({
    query: z.string().trim().min(1).max(300),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(500),
        }),
      )
      .max(6)
      .optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateOrderForm: mk(orderFormSchema),
  validateSession: mk(sessionSchema),
  validatePageView: mk(pageViewSchema),
  validateFunnel: mk(funnelSchema),
  validateAiSearch: mk(aiSearchSchema),
  orderFormSchema,
  sessionSchema,
  pageViewSchema,
  funnelSchema,
  aiSearchSchema,
};
