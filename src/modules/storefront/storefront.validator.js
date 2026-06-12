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
    shipping_fee_ngn: z.coerce.number().nonnegative().optional(),
    items: z
      .array(
        z.object({
          variant_id: z.string().uuid(),
          quantity: z.coerce.number().int().positive(),
        }),
      )
      .min(1),
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
  })
  .strict();

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

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateOrderForm: mk(orderFormSchema),
  validateSession: mk(sessionSchema),
  validatePageView: mk(pageViewSchema),
  validateFunnel: mk(funnelSchema),
  orderFormSchema,
  sessionSchema,
  pageViewSchema,
  funnelSchema,
};
