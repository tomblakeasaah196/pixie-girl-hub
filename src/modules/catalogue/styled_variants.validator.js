/**
 * Styled colour × size variants + size-tier/guide config — Zod validators.
 */

"use strict";

const { z } = require("zod");

const money = z.coerce.number().nonnegative();
const sizeCode = z
  .string()
  .min(1)
  .max(8)
  .regex(
    /^[A-Z0-9]+$/,
    "size code must be UPPERCASE letters/digits (e.g. S, XL)",
  );

const tier = z
  .object({
    size_code: sizeCode,
    label: z.string().min(1).max(60).optional(),
    premium_ngn: money.optional(),
    circumference_min_in: z.coerce.number().nonnegative().nullable().optional(),
    circumference_max_in: z.coerce.number().nonnegative().nullable().optional(),
    circumference_min_cm: z.coerce.number().nonnegative().nullable().optional(),
    circumference_max_cm: z.coerce.number().nonnegative().nullable().optional(),
    guidance_text: z.string().max(500).nullable().optional(),
    display_order: z.coerce.number().int().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const laceCode = z
  .string()
  .min(1)
  .max(8)
  .regex(
    /^[A-Z0-9]+$/,
    "lace code must be UPPERCASE letters/digits (e.g. 13X4, 360)",
  );

const laceTier = z
  .object({
    lace_code: laceCode,
    label: z.string().min(1).max(60).optional(),
    premium_ngn: money.optional(),
    description: z.string().max(500).nullable().optional(),
    display_order: z.coerce.number().int().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const sizeConfig = z
  .object({
    tiers: z.array(tier).max(20).optional(),
    lace_sizes: z.array(laceTier).max(20).optional(),
    size_guide_title: z.string().max(160).nullable().optional(),
    head_size_guide_md: z.string().max(8000).nullable().optional(),
    // One-click Categories toggle (Products → Config).
    categories_enabled: z.boolean().optional(),
  })
  .strict();

const colourCreate = z
  .object({
    name: z.string().min(1).max(80),
    hex: z
      .string()
      .regex(/^#?[0-9a-fA-F]{3,8}$/, "hex colour like #1B1B1B")
      .max(9)
      .nullable()
      .optional(),
    premium_ngn: money.optional(),
    video_url: z.string().max(2000).nullable().optional(),
    external_video_url: z.string().max(2000).nullable().optional(),
    display_order: z.coerce.number().int().optional(),
    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const colourUpdate = colourCreate.partial();

const variantBulkCreate = z
  .object({
    colour_ids: z.array(z.string().uuid()).optional(),
    all_sizes: z.boolean().optional(),
    size_codes: z.array(sizeCode).optional(),
    // Lace axis (optional): generate colour × size × lace. Omit for no lace.
    all_lace: z.boolean().optional(),
    lace_codes: z.array(laceCode).optional(),
  })
  .strict()
  .refine((v) => v.all_sizes || (v.size_codes && v.size_codes.length), {
    message: "Provide all_sizes=true or a non-empty size_codes list",
  });

const variantUpdate = z
  .object({
    price_override_ngn: money.nullable().optional(),
    compare_at_price_ngn: money.nullable().optional(),
    is_active: z.boolean().optional(),
    is_default: z.boolean().optional(),
    display_order: z.coerce.number().int().optional(),
  })
  .strict();

const mw = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

module.exports = {
  validateSizeConfig: mw(sizeConfig),
  validateColourCreate: mw(colourCreate),
  validateColourUpdate: mw(colourUpdate),
  validateVariantBulkCreate: mw(variantBulkCreate),
  validateVariantUpdate: mw(variantUpdate),
};
