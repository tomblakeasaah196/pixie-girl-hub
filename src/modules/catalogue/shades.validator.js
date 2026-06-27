/**
 * Product Shades (V2.2 §6.4 — "Shop by shade") — Zod validators.
 */

"use strict";

const { z } = require("zod");

const slug = z
  .string()
  .min(2)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kebab-case required");

const shadeCreate = z
  .object({
    name: z.string().min(1).max(160),
    // Optional — the service derives + de-collides a slug from the name.
    slug: slug.optional(),
    short_description: z.string().max(500).nullable().optional(),
    long_description: z.string().max(8000).nullable().optional(),
    cover_image_url: z.string().max(2000).nullable().optional(),
    display_order: z.coerce.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
    meta_title: z.string().max(200).nullable().optional(),
    meta_description: z.string().max(500).nullable().optional(),
  })
  .strict();

const shadeUpdate = shadeCreate.partial();

// Flow-2 bulk assignment: a list of styled product ids to drop into the shade.
const shadeAssign = z
  .object({
    styled_ids: z.array(z.string().uuid()).min(1).max(1000),
  })
  .strict();

const mw = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

module.exports = {
  validateShadeCreate: mw(shadeCreate),
  validateShadeUpdate: mw(shadeUpdate),
  validateShadeAssign: mw(shadeAssign),
};
