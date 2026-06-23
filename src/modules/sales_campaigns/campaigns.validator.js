/**
 * Sales Campaigns & Landing Pages (V2.2 §6.22)
 * Input validators — Zod schemas wrapped in Express middleware.
 *
 * Validation failures throw ZodError → the central error handler turns
 * them into 400 VALIDATION_ERROR with a `fields` map.
 */

"use strict";

const { z } = require("zod");

const isoDateTime = z.string().datetime({ offset: true });
const slug = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case (a-z, 0-9, -)");
const moneyNgn = z.coerce.number().nonnegative();

// An http(s) URL OR a root-relative same-origin path. Uploaded media comes back
// as "/media/..." when no CDN_BASE_URL is configured, so image/redirect fields
// must accept that — requiring a full URL here is what 400'd ("Invalid input")
// every landing save that had an uploaded hero/OG image. Still blocks
// javascript:, data:, file:, and protocol-relative "//host" (cross-origin).
const safeUrl = z
  .string()
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u) || /^\/(?!\/)/.test(u), {
    message: "must be an https URL or a same-origin /path",
  });

const discountTypes = [
  "percentage",
  "fixed_amount",
  "buy_x_get_y",
  "bundle",
  "free_shipping",
];
const productScopes = ["all", "specific_products", "specific_categories"];
const notifyVia = ["email", "whatsapp", "sms", "both"];

// Landing block: bounded to keep the JSON payload small and the public
// render fast. Extra fields are allowed (`passthrough`) for forward-compat
// but the explicitly-known fields are length-limited and the items array is
// capped. The outer landing_blocks array is also bounded — see usage below.
//
// A block is identified by `key` (the builder's block-library id) and/or a
// legacy `type`. The admin builder sends `{ key, enabled }` (plus optional
// Praxis attribution), so BOTH are optional and we only require that at least
// one identifier is present. Making `type` mandatory here is what silently
// 400'd every "Save landing" from the builder.
const landingBlock = z
  .object({
    key: z.string().max(60).optional(),
    type: z.string().max(60).optional(),
    enabled: z.boolean().optional(),
    drafted_by_ai: z.boolean().optional(),
    rationale: z.string().max(600).optional(),
    title: z.string().max(300).optional(),
    body: z.string().max(4000).optional(),
    items: z.array(z.any()).max(50).optional(),
    props: z.record(z.any()).optional(),
  })
  .passthrough()
  .refine((b) => Boolean(b.key || b.type), {
    message: "each landing block needs a key or a type",
  });
const landingBlocksArray = z.array(landingBlock).max(40);

// ── Sales Campaigns v2 — campaign config fields (migration 000040) ──
// These columns live on the per-brand sales_campaigns table but were never
// added to the create/update schemas, so the strict() guard rejected every
// brief save that touched VIP / exit-intent / viewer / currency settings.
// Shared by both create and update so the two stay in lock-step.
const v2CampaignFields = {
  voice_profile_override: z.record(z.any()).nullable().optional(),
  show_viewer_count_policy: z
    .enum(["smart", "on", "off"])
    .nullable()
    .optional(),
  viewer_count_floor: z.coerce.number().int().min(0).nullable().optional(),
  vip_early_access_minutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(10080)
    .optional(),
  last_call_surge_minutes: z.coerce.number().int().min(0).max(10080).optional(),
  vip_top_n: z.coerce.number().int().min(1).max(100).optional(),
  vip_lifetime_threshold_ngn: moneyNgn.nullable().optional(),
  next_campaign_slug: slug.nullable().optional(),
  exit_intent_enabled: z.boolean().optional(),
  exit_intent_code: z.string().max(60).nullable().optional(),
  exit_intent_discount_ngn: moneyNgn.nullable().optional(),
  abandonment_recovery_enabled: z.boolean().optional(),
  allow_multi_currency_display: z.boolean().optional(),
  // ── Sales Campaigns v3 (migration 000048) — deals engine ──
  delivery_weeks: z.coerce.number().int().min(1).max(52).nullable().optional(),
  preorder_extra_weeks: z.coerce.number().int().min(0).max(52).optional(),
  position_ladder: z
    .array(
      z.object({
        position: z.coerce.number().int().min(1).max(20),
        discount_ngn: z.coerce.number().nonnegative(),
        label: z.string().max(120).optional(),
      }),
    )
    .max(20)
    .nullable()
    .optional(),
  stacking_bonus: z
    .object({
      min_distinct_bundles: z.coerce.number().int().min(2).max(10),
      discount_ngn: z.coerce.number().nonnegative(),
      label: z.string().max(200).optional(),
    })
    .nullable()
    .optional(),
  bulk_tiers: z
    .array(
      z.object({
        min_qty: z.coerce.number().int().min(2),
        discount_per_item_ngn: z.coerce.number().nonnegative(),
        label: z.string().max(200).optional(),
      }),
    )
    .max(10)
    .nullable()
    .optional(),
  // ── Static FX rate for the landing currency toggle (migration 000051) ──
  // Customer-facing display only. Order settlement uses the live rate.
  ngn_per_usd_rate: z.coerce.number().positive().nullable().optional(),
};

const createSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug,
    description: z.string().max(2000).optional(),
    starts_at: isoDateTime,
    ends_at: isoDateTime,
    discount_type: z.enum(discountTypes).nullable().optional(),
    discount_value: z.coerce.number().positive().nullable().optional(),
    min_order_value_ngn: moneyNgn.optional(),
    customer_segment_id: z.string().uuid().optional(),
    first_time_buyers_only: z.boolean().optional().default(false),
    product_scope: z.enum(productScopes).optional().default("all"),
    landing_hero_title: z.string().max(300).optional(),
    landing_hero_subtitle: z.string().max(500).optional(),
    landing_hero_image_url: safeUrl.optional(),
    landing_cta_text: z.string().max(80).optional(),
    landing_blocks: landingBlocksArray.optional(),
    countdown_message: z.string().max(200).optional(),
    signup_for_notifications: z.boolean().optional(),
    ended_message: z.string().max(300).optional(),
    ended_redirect_to: safeUrl.optional(),
    meta_title: z.string().max(200).optional(),
    meta_description: z.string().max(500).optional(),
    og_image_url: safeUrl.optional(),
    total_usage_limit: z.coerce.number().int().positive().optional(),
    ...v2CampaignFields,
  })
  .strict()
  .superRefine((val, ctx) => {
    if (new Date(val.ends_at) <= new Date(val.starts_at)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ends_at"],
        message: "ends_at must be after starts_at",
      });
    }
    if (
      val.discount_type === "percentage" &&
      val.discount_value !== null &&
      val.discount_value !== undefined &&
      val.discount_value > 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discount_value"],
        message:
          "percentage discount_value must be a fraction (e.g. 0.20 for 20%)",
      });
    }
  });

// Update: same fields, all optional; status changes go through transitions.
const updateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    slug: slug.optional(),
    description: z.string().max(2000).nullable().optional(),
    starts_at: isoDateTime.optional(),
    ends_at: isoDateTime.optional(),
    discount_type: z.enum(discountTypes).nullable().optional(),
    discount_value: z.coerce.number().positive().nullable().optional(),
    min_order_value_ngn: moneyNgn.nullable().optional(),
    customer_segment_id: z.string().uuid().nullable().optional(),
    first_time_buyers_only: z.boolean().optional(),
    product_scope: z.enum(productScopes).optional(),
    landing_hero_title: z.string().max(300).nullable().optional(),
    landing_hero_subtitle: z.string().max(500).nullable().optional(),
    landing_hero_image_url: safeUrl.nullable().optional(),
    landing_cta_text: z.string().max(80).nullable().optional(),
    landing_blocks: landingBlocksArray.optional(),
    countdown_message: z.string().max(200).nullable().optional(),
    signup_for_notifications: z.boolean().optional(),
    ended_message: z.string().max(300).nullable().optional(),
    ended_redirect_to: safeUrl.nullable().optional(),
    meta_title: z.string().max(200).nullable().optional(),
    meta_description: z.string().max(500).nullable().optional(),
    og_image_url: safeUrl.nullable().optional(),
    total_usage_limit: z.coerce.number().int().positive().nullable().optional(),
    ...v2CampaignFields,
  })
  .strict();

const addProductSchema = z
  .object({
    product_id: z.string().uuid().nullable().optional(),
    category_id: z.string().uuid().nullable().optional(),
    styled_id: z.string().uuid().nullable().optional(),
    include_exclude: z.enum(["include", "exclude"]),
    // Money + display fields are denormalised onto the link (snapshot on add).
    // They MUST accept null: the picker sends `null` for an absent image/price
    // — making these `.optional()` only (so null is rejected) is exactly what
    // silently 400'd every "Add products" from the campaign builder.
    campaign_price_ngn: moneyNgn.nullable().optional(),
    campaign_price_usd: moneyNgn.nullable().optional(),
    image_url: z.string().max(2048).nullable().optional(),
    regular_price_ngn: moneyNgn.nullable().optional(),
    regular_price_usd: moneyNgn.nullable().optional(),
    short_description: z.string().max(4000).nullable().optional(),
    long_description: z.string().max(40000).nullable().optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_featured: z.boolean().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.styled_id && !val.product_id && !val.category_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["product_id"],
        message: "styled_id, product_id, or category_id is required",
      });
    }
  });

const updateProductSchema = z
  .object({
    campaign_price_ngn: moneyNgn.nullable().optional(),
    campaign_price_usd: moneyNgn.nullable().optional(),
    regular_price_ngn: moneyNgn.nullable().optional(),
    regular_price_usd: moneyNgn.nullable().optional(),
    image_url: z.string().max(2048).nullable().optional(),
    short_description: z.string().max(4000).nullable().optional(),
    long_description: z.string().max(40000).nullable().optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_featured: z.boolean().optional(),
    include_exclude: z.enum(["include", "exclude"]).optional(),
  })
  .strict();

const landingSchema = z
  .object({
    landing_hero_title: z.string().max(300).nullable().optional(),
    landing_hero_subtitle: z.string().max(500).nullable().optional(),
    landing_hero_image_url: safeUrl.nullable().optional(),
    landing_cta_text: z.string().max(80).nullable().optional(),
    landing_blocks: landingBlocksArray.optional(),
    countdown_message: z.string().max(200).nullable().optional(),
    ended_message: z.string().max(300).nullable().optional(),
    ended_redirect_to: safeUrl.nullable().optional(),
    meta_title: z.string().max(200).nullable().optional(),
    meta_description: z.string().max(500).nullable().optional(),
    og_image_url: safeUrl.nullable().optional(),
  })
  .strict();

// Public — pre-launch notification signup.
const signupSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().min(7).max(20).optional(),
    notify_via: z.enum(notifyVia).optional().default("email"),
    source: z.string().max(60).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.email && !val.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "email or phone is required",
      });
    }
  });

const transitionSchema = z
  .object({ notes: z.string().max(1000).optional() })
  .strict();

const duplicateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    slug: slug.optional(),
  })
  .strict();

// ── Sales Campaigns v2 — Bundles, tiers, upsells, ambassadors ──

const bundleCreateSchema = z
  .object({
    slug,
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    hero_image_url: safeUrl.optional(),
    category_id: z.string().uuid().optional(),
    is_fixed_composition: z.boolean().optional(),
    default_per_item_discount_ngn: moneyNgn.optional(),
    default_preorder_loss_pct: z.coerce.number().min(0).max(1).optional(),
    status: z.enum(["active", "archived", "draft"]).optional(),
    display_order: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const bundleUpdateSchema = bundleCreateSchema.partial().strict();

const bundleItemSchema = z
  .object({
    product_id: z.string().uuid().nullable().optional(),
    variant_id: z.string().uuid().nullable().optional(),
    styled_id: z.string().uuid().nullable().optional(),
    quantity: z.coerce.number().int().min(1).optional(),
    per_item_discount_ngn: moneyNgn.nullable().optional(),
    display_position: z.coerce.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.styled_id && !val.product_id && !val.variant_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["product_id"],
        message: "styled_id, product_id, or variant_id is required",
      });
    }
  });

const attachBundleSchema = z
  .object({
    bundle_id: z.string().uuid(),
    per_item_discount_ngn: moneyNgn.nullable().optional(),
    campaign_bundle_price_ngn: moneyNgn.nullable().optional(),
    preorder_enabled: z.boolean().optional(),
    preorder_loss_pct: z.coerce.number().min(0).max(1).nullable().optional(),
    preorder_lead_weeks: z.coerce
      .number()
      .int()
      .min(1)
      .max(52)
      .nullable()
      .optional(),
    starting_stock: z.coerce.number().int().min(0).nullable().optional(),
    is_featured: z.boolean().optional(),
    display_order: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const tierSchema = z
  .object({
    min_quantity: z.coerce.number().int().min(2),
    fixed_discount_ngn: moneyNgn,
    label: z.string().max(120).optional(),
    scope_bundle_ids: z.array(z.string().uuid()).optional(),
    scope_product_ids: z.array(z.string().uuid()).optional(),
    display_order: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const upsellSchema = z
  .object({
    rung: z.coerce.number().int().min(1).max(20),
    trigger_type: z.enum(["cart_qty", "cart_value", "specific_bundle"]),
    min_cart_qty: z.coerce.number().int().min(1).nullable().optional(),
    min_cart_value_ngn: moneyNgn.nullable().optional(),
    trigger_bundle_id: z.string().uuid().nullable().optional(),
    offer_label: z.string().min(1).max(200),
    offer_subline: z.string().max(300).optional(),
    reward_type: z.enum(["fixed_amount", "percentage", "suggest_bundle"]),
    reward_value: z.coerce.number().nullable().optional(),
    reward_bundle_id: z.string().uuid().nullable().optional(),
    display_order: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const attachAmbassadorSchema = z
  .object({
    contact_id: z.string().uuid(),
    utm_source: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-z0-9_-]+$/, "utm_source must be lowercase alphanumeric / -_"),
    commission_pct: z.coerce.number().min(0).max(1).nullable().optional(),
  })
  .strict();

// ── Praxis assist schemas ───────────────────────────────────
const praxisDraftCopySchema = z
  .object({
    section: z.enum(["hero", "faq", "blast", "product_blurbs"]),
    brief: z.string().max(2000).optional(),
    campaign_theme: z.string().max(200).optional(),
    product_focus: z.string().max(200).optional(),
    topics: z.array(z.string().max(80)).max(10).optional(),
    tone_override: z.string().max(60).optional(),
  })
  .strict();

const praxisSuggestLayoutSchema = z
  .object({
    campaign_type: z.string().max(60).optional(),
    duration_hours: z.coerce.number().int().min(1).max(720).optional(),
    product_focus: z.string().max(200).optional(),
  })
  .strict();

const praxisSuggestPricingSchema = z
  .object({
    target_margin_pct: z.coerce.number().min(0).max(0.95),
    include_charm_rounding: z.boolean().optional(),
    inputs: z
      .array(
        z
          .object({
            label: z.string().max(120).optional(),
            product_id: z.string().uuid().optional(),
            bundle_id: z.string().uuid().optional(),
            cost_ngn: z.coerce.number().nonnegative(),
            freight_ngn: z.coerce.number().nonnegative().optional(),
            discount_loss_pct: z.coerce.number().min(0).max(1).optional(),
            gateway_fee_pct: z.coerce.number().min(0).max(1).optional(),
            gateway_fee_fixed: z.coerce.number().nonnegative().optional(),
            floor_ngn: z.coerce.number().nonnegative().optional(),
            charm_strategy: z
              .enum(["thousand_up", "k_minus_one", "nine_ninety", "round_50"])
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

const praxisDryRunSchema = z
  .object({
    question: z.string().min(1).max(1000),
    proposed_price_ngn: z.coerce.number().nonnegative().optional(),
    floor_ngn: z.coerce.number().nonnegative().optional(),
    product_id: z.string().uuid().nullable().optional(),
  })
  .strict();

const praxisQnaSchema = z
  .object({ question: z.string().min(1).max(1000) })
  .strict();

const praxisAcceptSchema = z
  .object({
    action_key: z.string().min(1).max(120),
    prompt: z.string().max(2000).optional(),
    draft: z.any(),
    accepted: z.any(),
  })
  .strict();

const vipGrantSchema = z
  .object({ top_n: z.coerce.number().int().min(1).max(100).optional() })
  .strict();

const vipGiftStatusSchema = z
  .object({
    gift_status: z.enum([
      "pending",
      "approved",
      "dispatched",
      "delivered",
      "rejected",
    ]),
  })
  .strict();

// Checkout input. Deliberately LENIENT so a buyer is never blocked by form
// strictness (the API re-prices and re-validates everything that matters):
//   • last_name is optional (single-name buyers are real)
//   • email/phone are trimmed; phone accepts human formatting
//   • consent opt-ins are optional and default to false — but "I accept the
//     Terms" stays mandatory (legal requirement)
//   • unit_price_ngn is optional (the server is the price source of truth)
//   • payment_gateway is optional (currency picks the rail)
//   • unknown extra fields are stripped, not rejected (no .strict()), so one
//     stray field from the frontend can't 400 every checkout
const checkoutEmail = z
  .string()
  .trim()
  .email()
  .max(160)
  .transform((s) => s.toLowerCase());
const checkoutPhone = z.string().trim().min(7).max(30);

const checkoutSchema = z.object({
  slug: z.string().min(1).max(200),
  contact: z.object({
    first_name: z.string().trim().min(1).max(120),
    last_name: z.string().trim().max(120).optional(),
    email: checkoutEmail,
    phone: checkoutPhone,
    instagram_handle: z.string().max(60).optional(),
    notes: z.string().max(2000).optional(),
    gift: z
      .object({
        recipient_name: z.string().min(1).max(200),
        recipient_phone: z.string().max(30).optional(),
        message: z.string().max(500).optional(),
        ship_to_recipient: z.boolean().optional(),
        recipient_address: z
          .object({
            line1: z.string().min(1).max(400),
            line2: z.string().max(400).optional(),
            city: z.string().min(1).max(120),
            state: z.string().max(120).optional(),
            country: z.string().max(80).optional(),
          })
          .optional(),
      })
      .refine((g) => !g.ship_to_recipient || g.recipient_address, {
        message: "recipient_address is required when ship_to_recipient is true",
      })
      .optional(),
    address: z.object({
      line1: z.string().trim().min(1).max(400),
      line2: z.string().max(400).optional(),
      city: z.string().trim().min(1).max(120),
      state: z.string().max(120).optional(),
      country: z.string().max(80).optional(),
    }),
    consent: z.object({
      whatsapp_opt_in: z.boolean().optional().default(false),
      marketing_opt_in: z.boolean().optional().default(false),
      // Non-negotiable: the buyer must accept the Terms to check out.
      terms_accepted: z.literal(true),
    }),
  }),
  cart: z
    .array(
      z.object({
        bundle_id: z.string().uuid().optional(),
        product_id: z.string().uuid().optional(),
        // A styled product/colour/size SKU. When present the server prices the
        // line from the styled tables (styled_product_variants), not the base
        // product_variants — see campaigns.public.service checkout().
        styled_variant_id: z.string().uuid().optional(),
        quantity: z.coerce.number().int().min(1).max(50),
        // Optional — the server re-prices; never trusted from the client.
        unit_price_ngn: z.coerce.number().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(30),
  utm: z.record(z.string()).optional(),
  // Optional — currency picks the rail; an explicit hint is honoured for NGN.
  payment_gateway: z.enum(["paystack", "nomba"]).optional(),
  // Buyer-chosen display currency from the landing-page toggle. Drives
  // gateway routing: USD → Nomba only (the USD rail), NGN → Nomba primary
  // then Paystack. The order is still stored in NGN base; this only picks
  // the rail and stamps display_currency / fx_rate_used at payment.
  display_currency: z.enum(["NGN", "USD"]).optional().default("NGN"),
  client_idempotency_key: z.string().min(1).max(120),
  coupon_code: z.string().max(60).optional(),
});

// ── Batch / clone / duplicate (migration 000048) ─────────
const batchAddProductsSchema = z
  .object({
    items: z.array(addProductSchema).min(1).max(200),
  })
  .strict();

const cloneBundlesSchema = z
  .object({
    campaign_slug: z.string().max(120).optional(),
  })
  .strict();

const importCatalogueBundleSchema = z
  .object({
    source_bundle_offer_id: z.string().uuid(),
    campaign_slug: z.string().max(120).optional(),
  })
  .strict();

const duplicateBundleSchema = z
  .object({
    campaign_id: z.string().uuid().optional(),
  })
  .strict();

function mw(schema) {
  return function validate(req, _res, next) {
    req.body = schema.parse(req.body ?? {});
    next();
  };
}

module.exports = {
  validateCreate: mw(createSchema),
  validateUpdate: mw(updateSchema),
  validateAddProduct: mw(addProductSchema),
  validateUpdateProduct: mw(updateProductSchema),
  validateLanding: mw(landingSchema),
  validateSignup: mw(signupSchema),
  validateTransition: mw(transitionSchema),
  validateDuplicate: mw(duplicateSchema),
  // v2
  validateBundleCreate: mw(bundleCreateSchema),
  validateBundleUpdate: mw(bundleUpdateSchema),
  validateBundleItem: mw(bundleItemSchema),
  validateAttachBundle: mw(attachBundleSchema),
  validateTier: mw(tierSchema),
  validateUpsell: mw(upsellSchema),
  validateAttachAmbassador: mw(attachAmbassadorSchema),
  validatePraxisDraftCopy: mw(praxisDraftCopySchema),
  validatePraxisSuggestLayout: mw(praxisSuggestLayoutSchema),
  validatePraxisSuggestPricing: mw(praxisSuggestPricingSchema),
  validatePraxisDryRun: mw(praxisDryRunSchema),
  validatePraxisQna: mw(praxisQnaSchema),
  validatePraxisAccept: mw(praxisAcceptSchema),
  validateVipGrant: mw(vipGrantSchema),
  validateVipGiftStatus: mw(vipGiftStatusSchema),
  validateCheckout: mw(checkoutSchema),
  // v3 (migration 000048)
  validateBatchAddProducts: mw(batchAddProductsSchema),
  validateCloneBundles: mw(cloneBundlesSchema),
  validateImportCatalogueBundle: mw(importCatalogueBundleSchema),
  validateDuplicateBundle: mw(duplicateBundleSchema),
  // schemas
  createSchema,
  updateSchema,
  addProductSchema,
  signupSchema,
  checkoutSchema,
  bundleCreateSchema,
  bundleItemSchema,
  attachBundleSchema,
  tierSchema,
  upsellSchema,
  praxisDraftCopySchema,
};
