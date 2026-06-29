/**
 * Bundle offers (F-2 / PD §6.23.4) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const pricingModel = z.enum([
  "fixed_bundle_price",
  "pct_off",
  "amount_off",
  "buy_x_get_y",
  "tiered_qty",
]);

const componentSchema = z
  .object({
    // Styled product is the preferred (and default-allowed) bundle target.
    styled_id: z.string().uuid().optional(),
    // Base product / variant — only accepted when the catalogue config flag
    // allow_base_in_collections_bundles is on (enforced in the service).
    product_id: z.string().uuid().optional(),
    variant_id: z.string().uuid().optional(),
    quantity: z.coerce.number().int().positive().optional(),
    role: z.enum(["core", "free", "discounted", "optional"]).optional(),
    display_order: z.coerce.number().int().optional(),
  })
  .strict()
  .refine((c) => c.styled_id || c.product_id || c.variant_id, {
    message: "component needs a styled_id (or product_id/variant_id base target)",
  });

const createSchema = z
  .object({
    bundle_code: z.string().min(2).max(60),
    display_name: z.string().min(1).max(160),
    description: z.string().max(1000).optional(),
    pricing_model: pricingModel,
    bundle_price_ngn: z.coerce.number().nonnegative().optional(),
    bundle_price_usd: z.coerce.number().nonnegative().nullable().optional(),
    discount_value: z.coerce.number().nonnegative().optional(),
    buy_quantity: z.coerce.number().int().positive().optional(),
    get_quantity: z.coerce.number().int().positive().optional(),
    get_discount_pct: z.coerce.number().min(0).max(100).optional(),
    qty_tiers: z
      .array(z.object({ qty: z.number().int(), discount: z.number() }))
      .optional(),
    valid_from: z.string().optional(),
    valid_to: z.string().optional(),
    requires_all_components_in_stock: z.boolean().optional(),
    total_usage_limit: z.coerce.number().int().positive().optional(),
    per_customer_limit: z.coerce.number().int().positive().optional(),
    is_visible_storefront: z.boolean().optional(),
    hero_image_url: z.string().max(2000).nullable().optional(),
    display_order: z.coerce.number().int().optional(),
    is_active: z.boolean().optional(),
    components: z.array(componentSchema).min(1),
  })
  .strict();

const updateSchema = createSchema
  .partial()
  .omit({ bundle_code: true, components: true });

const priceSchema = z
  .object({
    component_subtotal_ngn: z.coerce.number().nonnegative(),
  })
  .strict();

const activeSchema = z.object({ is_active: z.boolean() }).strict();

// Collage cover: the editable badge (title/eyebrow), the curated title font, and
// optional palette overrides. All optional — an empty body generates the default
// editorial cover from the brand palette + piece count.
const hexColour = z
  .string()
  .regex(/^#?[0-9a-fA-F]{6}$/, "expected a #rrggbb colour")
  .optional();
// Per-component manual framing: focal centre (x/y as a 0..1 fraction of the
// source image) + an optional zoom. Keyed by the component's bundle_product_id.
const collageCropSchema = z
  .object({
    x: z.coerce.number().min(0).max(1),
    y: z.coerce.number().min(0).max(1),
    zoom: z.coerce.number().min(1).max(4).optional(),
  })
  .strict();
const collageSettingsSchema = z
  .object({
    title: z.string().max(80).optional(),
    eyebrow: z.string().max(80).optional(),
    font_family: z.string().max(60).optional(),
    bg: hexColour,
    accent: hexColour,
    crops: z.record(z.string().uuid(), collageCropSchema).optional(),
  })
  .strict();
const collageGenerateSchema = z
  .object({ settings: collageSettingsSchema.optional() })
  .strict();
// Apply-all carries the SHARED style (font/eyebrow/palette) — each bundle keeps
// its own title, so title is intentionally ignored here.
const collageApplyAllSchema = z
  .object({ settings: collageSettingsSchema })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCreate: mk(createSchema),
  validateUpdate: mk(updateSchema),
  validateComponent: mk(componentSchema),
  validatePrice: mk(priceSchema),
  validateActive: mk(activeSchema),
  validateCollageGenerate: mk(collageGenerateSchema),
  validateCollageApplyAll: mk(collageApplyAllSchema),
  createSchema,
  updateSchema,
  componentSchema,
};
