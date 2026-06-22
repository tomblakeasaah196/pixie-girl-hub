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
    parent_category_id: z.string().uuid().nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    hero_image_url: z.string().max(2000).nullable().optional(),
    meta_title: z.string().max(200).nullable().optional(),
    meta_description: z.string().max(500).nullable().optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_visible_storefront: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const productCreate = z
  .object({
    // Optional: when omitted the service allocates the next code from the
    // Document Numbering sequence (e.g. FLH001N) — operators never type it.
    product_code: z.string().min(1).max(60).optional(),
    name: z.string().min(1).max(200),
    // Optional: the service derives a unique kebab-case slug from the name
    // when not supplied.
    slug: slug.optional(),
    category_id: z.string().uuid().nullable().optional(),
    // Optional free-text fields are `.nullable()` so the UI can CLEAR them
    // (sends null → repo writes NULL). Without this, an empty field 400s.
    short_description: z.string().max(500).nullable().optional(),
    long_description: z.string().max(8000).nullable().optional(),
    texture_type: z.string().max(40).nullable().optional(),
    lace_type: z.string().max(40).nullable().optional(),
    hair_length_inches: z.coerce
      .number()
      .int()
      .min(0)
      .max(60)
      .nullable()
      .optional(),
    density: z.string().max(20).nullable().optional(),
    cap_size: z.string().max(40).nullable().optional(),
    primary_colour: z.string().max(60).nullable().optional(),
    hair_origin: z.string().max(40).nullable().optional(),
    care_instructions: z.string().max(2000).nullable().optional(),
    product_type: z.enum(["physical", "service", "digital"]).optional(),
    is_custom: z.boolean().optional(),
    // NOTE: storefront visibility is intentionally NOT accepted here. A base
    // product is the China-origin, stock-bearing record — it must never be
    // published to the storefront. Only Styled products carry a storefront
    // lifecycle (draft → live). Sending `is_visible_storefront` /
    // `visible_on_channels` on a base product is rejected by `.strict()`.
    brand_name: z.string().max(120).nullable().optional(),
    meta_title: z.string().max(200).nullable().optional(),
    meta_description: z.string().max(500).nullable().optional(),
    track_stock: z.boolean().optional(),
    taxable: z.boolean().optional(),
    vat_rate: z.coerce.number().min(0).max(1).optional(),
    payment_model: z
      .enum(["layaway", "deposit_triggered", "full_payment_only"])
      .optional(),
    required_deposit_pct: z.coerce.number().min(0).max(100).optional(),
    search_keywords: z.array(z.string()).optional(),
    // Lace constructions this base can be made in (4×4, 13×4, …). The styled
    // products built on it inherit this set and may narrow it.
    lace_size_codes: z.array(z.string().max(8)).nullable().optional(),
    // Pre-order / production timeline (P0-7). When the base is out of stock
    // and pre-order is enabled, styled listings show production-framed copy.
    preorder_enabled: z.boolean().optional(),
    expected_ready_date: z.string().date().nullable().optional(),
    production_lead_days: z.coerce
      .number()
      .int()
      .min(0)
      .max(365)
      .nullable()
      .optional(),
  })
  .strict();

// Bulk import (Excel/CSV → catalogue). Each row is the minimal spec our
// operators maintain in a sheet; codes/slugs/SKUs are generated server-side.
// Weight (grams) lands on the auto-created default variant — it's what the
// shipping engine reads. Empty strings are coerced to undefined so blank
// cells don't 400. Capped at 1000 rows so the import stays a single, bounded
// transaction.
const emptyToUndef = (schema) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    schema.optional(),
  );

const bulkImportRow = z
  .object({
    name: z.string().min(1).max(200),
    texture_type: emptyToUndef(z.string().max(40)),
    lace_type: emptyToUndef(z.string().max(40)),
    hair_length_inches: emptyToUndef(z.coerce.number().int().min(0).max(60)),
    density: emptyToUndef(z.string().max(20)),
    cap_size: emptyToUndef(z.string().max(40)),
    primary_colour: emptyToUndef(z.string().max(60)),
    hair_origin: emptyToUndef(z.string().max(40)),
    short_description: emptyToUndef(z.string().max(500)),
    // Category NAME — the service resolves it to an id, creating it if new.
    category: emptyToUndef(z.string().max(160)),
    weight_g: emptyToUndef(z.coerce.number().int().min(0).max(1000000)),
    // Money — always Naira. cost is only applied for Cost-Vault holders.
    cost_ngn: emptyToUndef(z.coerce.number().min(0).max(1000000000000)),
    wholesale_price_ngn: emptyToUndef(
      z.coerce.number().min(0).max(1000000000000),
    ),
  })
  .strict();

const bulkImport = z
  .object({
    rows: z.array(bulkImportRow).min(1).max(1000),
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
    price_storefront_usd: money.optional(),
    price_pos_ngn: money.optional(),
    price_pos_usd: money.optional(),
    price_wholesale_ngn: money.optional(),
    price_wholesale_usd: money.optional(),
    price_partner_ngn: money.optional(),
    price_partner_usd: money.optional(),
    compare_at_price_ngn: money.optional(),
    compare_at_price_usd: money.optional(),
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
    description: z.string().max(2000).nullable().optional(),
    hero_image_url: z.string().max(2000).nullable().optional(),
    mode: z.enum(["manual", "rule"]).optional(),
    display_image_url: z.string().max(2000).nullable().optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_visible_storefront: z.boolean().optional(),
    is_active: z.boolean().optional(),
    meta_title: z.string().max(200).nullable().optional(),
    meta_description: z.string().max(500).nullable().optional(),
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
    // Collections curate STYLED products only — never base products.
    styled_id: z.string().uuid(),
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
    canonical_url: z.string().max(2000).nullable().optional(),
    og_image_url: z.string().max(2000).nullable().optional(),
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
  validateBulkImport: mw(bulkImport),
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
  bulkImport,
  variantCreate,
};
