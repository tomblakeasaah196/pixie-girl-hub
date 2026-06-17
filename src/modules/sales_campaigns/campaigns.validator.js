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

const discountTypes = [
  "percentage",
  "fixed_amount",
  "buy_x_get_y",
  "bundle",
  "free_shipping",
];
const productScopes = ["all", "specific_products", "specific_categories"];
const notifyVia = ["email", "whatsapp", "sms", "both"];

const landingBlock = z
  .object({
    type: z.string(),
    title: z.string().optional(),
    body: z.string().optional(),
    items: z.array(z.any()).optional(),
  })
  .passthrough();

const createSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug,
    description: z.string().max(2000).optional(),
    starts_at: isoDateTime,
    ends_at: isoDateTime,
    discount_type: z.enum(discountTypes),
    discount_value: z.coerce.number().positive(),
    min_order_value_ngn: moneyNgn.optional(),
    customer_segment_id: z.string().uuid().optional(),
    first_time_buyers_only: z.boolean().optional().default(false),
    product_scope: z.enum(productScopes).optional().default("all"),
    landing_hero_title: z.string().max(300).optional(),
    landing_hero_subtitle: z.string().max(500).optional(),
    landing_hero_image_url: z.string().url().optional(),
    landing_cta_text: z.string().max(80).optional(),
    landing_blocks: z.array(landingBlock).optional(),
    countdown_message: z.string().max(200).optional(),
    signup_for_notifications: z.boolean().optional(),
    ended_message: z.string().max(300).optional(),
    ended_redirect_to: z.string().max(500).optional(),
    meta_title: z.string().max(200).optional(),
    meta_description: z.string().max(500).optional(),
    og_image_url: z.string().url().optional(),
    total_usage_limit: z.coerce.number().int().positive().optional(),
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
    if (val.discount_type === "percentage" && val.discount_value > 1) {
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
    discount_type: z.enum(discountTypes).optional(),
    discount_value: z.coerce.number().positive().optional(),
    min_order_value_ngn: moneyNgn.nullable().optional(),
    customer_segment_id: z.string().uuid().nullable().optional(),
    first_time_buyers_only: z.boolean().optional(),
    product_scope: z.enum(productScopes).optional(),
    landing_hero_title: z.string().max(300).nullable().optional(),
    landing_hero_subtitle: z.string().max(500).nullable().optional(),
    landing_hero_image_url: z.string().url().nullable().optional(),
    landing_cta_text: z.string().max(80).nullable().optional(),
    landing_blocks: z.array(landingBlock).optional(),
    countdown_message: z.string().max(200).nullable().optional(),
    signup_for_notifications: z.boolean().optional(),
    ended_message: z.string().max(300).nullable().optional(),
    ended_redirect_to: z.string().max(500).nullable().optional(),
    meta_title: z.string().max(200).nullable().optional(),
    meta_description: z.string().max(500).nullable().optional(),
    og_image_url: z.string().url().nullable().optional(),
    total_usage_limit: z.coerce.number().int().positive().nullable().optional(),
  })
  .strict();

const addProductSchema = z
  .object({
    product_id: z.string().uuid().optional(),
    category_id: z.string().uuid().optional(),
    include_exclude: z.enum(["include", "exclude"]),
    campaign_price_ngn: moneyNgn.optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_featured: z.boolean().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!!val.product_id === !!val.category_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["product_id"],
        message: "exactly one of product_id or category_id is required",
      });
    }
  });

const updateProductSchema = z
  .object({
    campaign_price_ngn: moneyNgn.nullable().optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_featured: z.boolean().optional(),
    include_exclude: z.enum(["include", "exclude"]).optional(),
  })
  .strict();

const landingSchema = z
  .object({
    landing_hero_title: z.string().max(300).nullable().optional(),
    landing_hero_subtitle: z.string().max(500).nullable().optional(),
    landing_hero_image_url: z.string().url().nullable().optional(),
    landing_cta_text: z.string().max(80).nullable().optional(),
    landing_blocks: z.array(landingBlock).optional(),
    countdown_message: z.string().max(200).nullable().optional(),
    ended_message: z.string().max(300).nullable().optional(),
    ended_redirect_to: z.string().max(500).nullable().optional(),
    meta_title: z.string().max(200).nullable().optional(),
    meta_description: z.string().max(500).nullable().optional(),
    og_image_url: z.string().url().nullable().optional(),
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
    hero_image_url: z.string().url().optional(),
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
    product_id: z.string().uuid().optional(),
    variant_id: z.string().uuid().optional(),
    quantity: z.coerce.number().int().min(1).optional(),
    per_item_discount_ngn: moneyNgn.nullable().optional(),
    display_position: z.coerce.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (!val.product_id && !val.variant_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["product_id"],
        message: "product_id or variant_id is required",
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
    preorder_lead_weeks: z.coerce.number().int().min(1).max(52).nullable().optional(),
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
  .object({ question: z.string().min(1).max(1000) }).strict();

const praxisAcceptSchema = z
  .object({
    action_key: z.string().min(1).max(120),
    prompt: z.string().max(2000).optional(),
    draft: z.any(),
    accepted: z.any(),
  })
  .strict();

const vipGrantSchema = z
  .object({ top_n: z.coerce.number().int().min(1).max(100).optional() }).strict();

const vipGiftStatusSchema = z
  .object({
    gift_status: z.enum(["pending", "approved", "dispatched", "delivered", "rejected"]),
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
  // schemas
  createSchema,
  updateSchema,
  addProductSchema,
  signupSchema,
  bundleCreateSchema,
  bundleItemSchema,
  attachBundleSchema,
  tierSchema,
  upsellSchema,
  praxisDraftCopySchema,
};
