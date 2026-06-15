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
    short_description: z.string().max(500).optional(),
    long_description: z.string().max(8000).optional(),
    style_addon_price_ngn: money.optional(),
    category_id: z.string().uuid().optional(),
    visible_on_channels: z.array(z.string()).optional(),
    meta_title: z.string().max(200).optional(),
    meta_description: z.string().max(500).optional(),
    search_keywords: z.array(z.string()).optional(),
  })
  .strict();

const styledUpdate = styledCreate.partial().omit({ base_product_id: true });

const unpublish = z
  .object({ archive: z.boolean().optional() })
  .strict();

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
