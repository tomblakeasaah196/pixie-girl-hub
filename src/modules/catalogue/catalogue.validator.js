/**
 * Catalogue (V2.2 §6.4/§6.9) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const slug = z
  .string()
  .min(2)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kebab-case required");
const money = z.coerce.number().nonnegative();

const categoryCreate = z
  .object({
    name: z.string().min(1).max(160),
    slug,
    parent_category_id: z.string().uuid().optional(),
    description: z.string().max(2000).optional(),
    hero_image_url: z.string().url().optional(),
    meta_title: z.string().max(200).optional(),
    meta_description: z.string().max(500).optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_visible_storefront: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const productCreate = z
  .object({
    product_code: z.string().min(1).max(60),
    name: z.string().min(1).max(200),
    slug,
    category_id: z.string().uuid().optional(),
    short_description: z.string().max(500).optional(),
    long_description: z.string().max(8000).optional(),
    texture_type: z.string().max(40).optional(),
    lace_type: z.string().max(40).optional(),
    hair_length_inches: z.coerce.number().int().min(0).max(60).optional(),
    density: z.string().max(20).optional(),
    cap_size: z.string().max(40).optional(),
    primary_colour: z.string().max(60).optional(),
    hair_origin: z.string().max(40).optional(),
    care_instructions: z.string().max(2000).optional(),
    product_type: z.enum(["physical", "service", "digital"]).optional(),
    is_custom: z.boolean().optional(),
    is_visible_storefront: z.boolean().optional(),
    visible_on_channels: z.array(z.string()).optional(),
    brand_name: z.string().max(120).optional(),
    meta_title: z.string().max(200).optional(),
    meta_description: z.string().max(500).optional(),
    track_stock: z.boolean().optional(),
    taxable: z.boolean().optional(),
    vat_rate: z.coerce.number().min(0).max(1).optional(),
    payment_model: z
      .enum(["layaway", "deposit_triggered", "full_payment_only"])
      .optional(),
    required_deposit_pct: z.coerce.number().min(0).max(100).optional(),
    search_keywords: z.array(z.string()).optional(),
  })
  .strict();

const variantCreate = z
  .object({
    sku: z.string().min(1).max(80),
    barcode: z.string().max(80).optional(),
    variant_name: z.string().min(1).max(160),
    variant_length_inches: z.coerce.number().int().min(0).max(60).optional(),
    variant_colour: z.string().max(60).optional(),
    variant_density: z.string().max(20).optional(),
    variant_cap_size: z.string().max(40).optional(),
    price_storefront_ngn: money.optional(),
    price_pos_ngn: money.optional(),
    price_wholesale_ngn: money.optional(),
    price_partner_ngn: money.optional(),
    compare_at_price_ngn: money.optional(),
    // cost_price_ngn / min_price_ngn are DEPRECATED here (P0-1): true cost
    // is write-only via the encrypted cost vault, never as plaintext.
    min_margin_pct: z.coerce.number().min(0).max(100).optional(),
    weight_g: z.coerce.number().int().min(0).optional(),
    channel_external_ids: z.record(z.any()).optional(),
    payment_model_override: z
      .enum(["layaway", "deposit_triggered", "full_payment_only"])
      .optional(),
    required_deposit_pct_override: z.coerce.number().min(0).max(100).optional(),
    reorder_point: z.coerce.number().int().min(0).optional(),
    reorder_quantity: z.coerce.number().int().min(0).optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const collectionCreate = z
  .object({
    name: z.string().min(1).max(160),
    slug,
    description: z.string().max(2000).optional(),
    hero_image_url: z.string().url().optional(),
    mode: z.enum(["manual", "rule"]).optional(),
    display_image_url: z.string().url().optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_visible_storefront: z.boolean().optional(),
    is_active: z.boolean().optional(),
    meta_title: z.string().max(200).optional(),
    meta_description: z.string().max(500).optional(),
  })
  .strict();

const collectionRule = z
  .object({
    field: z.string().min(1).max(60),
    operator: z.enum([
      "=",
      "!=",
      "<",
      ">",
      "<=",
      ">=",
      "in",
      "contains",
      "starts_with",
    ]),
    value: z.any(),
    combinator: z.enum(["AND", "OR"]).optional(),
    display_order: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const collectionMember = z
  .object({
    product_id: z.string().uuid(),
    display_order: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const imageMeta = z
  .object({
    variant_id: z.string().uuid().optional(),
    alt_text: z.string().max(300).optional(),
    caption: z.string().max(500).optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_primary: z.coerce.boolean().optional(),
  })
  .strict();

const imageUpdate = z
  .object({
    variant_id: z.string().uuid().nullable().optional(),
    alt_text: z.string().max(300).nullable().optional(),
    caption: z.string().max(500).nullable().optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_primary: z.boolean().optional(),
  })
  .strict();

const videoCreate = z
  .object({
    source: z.enum(["youtube", "instagram_reel", "tiktok", "direct_upload"]),
    external_ref: z.string().min(1).max(200),
    embed_url: z.string().url(),
    thumbnail_url: z.string().url().optional(),
    title: z.string().max(200).optional(),
    caption: z.string().max(500).optional(),
    duration_seconds: z.coerce.number().int().min(0).optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_primary: z.boolean().optional(),
  })
  .strict();

// Attach a self-hosted media asset as a product video (W-13).
const videoFromMedia = z
  .object({
    media_asset_id: z.string().uuid(),
    title: z.string().max(200).optional(),
    caption: z.string().max(500).optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_primary: z.boolean().optional(),
  })
  .strict();

const seoUpsert = z
  .object({
    meta_title_override: z.string().max(200).nullable().optional(),
    meta_description_override: z.string().max(500).nullable().optional(),
    canonical_url: z.string().url().nullable().optional(),
    og_image_url: z.string().url().nullable().optional(),
    og_title: z.string().max(200).nullable().optional(),
    og_description: z.string().max(500).nullable().optional(),
    twitter_card: z.string().max(40).optional(),
    robots_directive: z.string().max(60).optional(),
  })
  .strict();

const attributeValue = z
  .object({
    field_id: z.string().uuid(),
    value_text: z.string().nullable().optional(),
    value_number: z.coerce.number().nullable().optional(),
    value_date: z.string().date().nullable().optional(),
    value_boolean: z.boolean().nullable().optional(),
    value_json: z.any().optional(),
  })
  .strict();

const relatedCreate = z
  .object({
    related_product_id: z.string().uuid(),
    relation_type: z
      .enum(["related", "complementary", "also_bought", "upgrade", "accessory"])
      .optional(),
    score: z.coerce.number().min(0).max(1).optional(),
    source: z
      .enum(["manual", "co_purchase", "similarity", "editorial"])
      .optional(),
    display_order: z.coerce.number().int().min(0).optional(),
  })
  .strict();

const mw = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

module.exports = {
  validateCategoryCreate: mw(categoryCreate),
  validateCategoryUpdate: mw(categoryCreate.partial()),
  validateProductCreate: mw(productCreate),
  validateProductUpdate: mw(productCreate.partial()),
  validateVariantCreate: mw(variantCreate),
  validateVariantUpdate: mw(variantCreate.partial()),
  validateCollectionCreate: mw(collectionCreate),
  validateCollectionUpdate: mw(collectionCreate.partial()),
  validateCollectionRule: mw(collectionRule),
  validateCollectionMember: mw(collectionMember),
  validateImageMeta: mw(imageMeta),
  validateImageUpdate: mw(imageUpdate),
  validateVideoCreate: mw(videoCreate),
  validateVideoFromMedia: mw(videoFromMedia),
  validateSeoUpsert: mw(seoUpsert),
  validateAttributeValue: mw(attributeValue),
  validateRelatedCreate: mw(relatedCreate),
  categoryCreate,
  productCreate,
  variantCreate,
};
