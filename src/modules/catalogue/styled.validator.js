/**
 * Styled products (V2.2 §6.4 P0-6) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const slug = z
  .string()
  .min(2)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kebab-case required");
const money = z.coerce.number().nonnegative();

const styledCreate = z
  .object({
    base_product_id: z.string().uuid(),
    base_variant_id: z.string().uuid().optional(),
    styled_code: z.string().min(1).max(60).optional(), // auto-generated if absent
    name: z.string().min(1).max(200),
    slug,
    // `.nullable()` so the editor can clear copy (sends null → NULL). Without
    // it, saving with an empty description 400s.
    short_description: z.string().max(500).nullable().optional(),
    long_description: z.string().max(8000).nullable().optional(),
    // Styled retail price (the size-S anchor) — its own price, not base+add-on.
    retail_price_ngn: money.nullable().optional(),
    retail_price_usd: money.nullable().optional(),
    compare_at_price_ngn: money.nullable().optional(),
    compare_at_price_usd: money.nullable().optional(),
    // Legacy add-on price; retained for backward compatibility.
    style_addon_price_ngn: money.nullable().optional(),
    category_id: z.string().uuid().nullable().optional(),
    visible_on_channels: z.array(z.string()).optional(),
    meta_title: z.string().max(200).nullable().optional(),
    meta_description: z.string().max(500).nullable().optional(),
    search_keywords: z.array(z.string()).optional(),
    // Lace constructions this styled offers (NULL/empty = inherit the base).
    lace_size_codes: z.array(z.string().max(8)).nullable().optional(),
    // Explicit module-card hero image (NULL = default colour's first picture).
    primary_image_id: z.string().uuid().nullable().optional(),
  })
  .strict();

// base_product_id is updatable (the admin can re-point a styled product at a
// different base). The service validates the new base exists / isn't deleted
// and gates when the change is unsafe (see styled.service.update).
const styledUpdate = styledCreate.partial();

const unpublish = z.object({ archive: z.boolean().optional() }).strict();

const aiDraft = z
  .object({
    base_product_id: z.string().uuid(),
    instructions: z.string().max(1000).optional(),
    tone: z.string().max(60).optional(),
    category_id: z.string().uuid().optional(),
    vendor: z.string().max(40).optional(),
  })
  .strict();

const mw = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

module.exports = {
  validateStyledCreate: mw(styledCreate),
  validateStyledUpdate: mw(styledUpdate),
  validateUnpublish: mw(unpublish),
  validateAiDraft: mw(aiDraft),
  styledCreate,
};
