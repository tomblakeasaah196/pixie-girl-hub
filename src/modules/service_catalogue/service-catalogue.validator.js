/**
 * Service Catalogue — Zod validators.
 */

"use strict";

const { z } = require("zod");

const slugSchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens");

const createService = z
  .object({
    name: z.string().min(1).max(120),
    slug: slugSchema,
    // `.nullable()` on optional text so the admin form can clear them; numeric
    // fields `.coerce` so string inputs from the UI's number fields parse.
    description: z.string().max(2000).nullable().optional(),
    base_price_ngn: z.coerce.number().nonnegative().optional(),
    duration_minutes: z.coerce.number().int().positive().nullable().optional(),
    category: z.string().max(60).nullable().optional(),
    image_url: z.string().url().max(2000).nullable().optional(),
    is_active: z.boolean().optional(),
    sort_order: z.coerce.number().int().optional(),
    required_stylist_tier: z.string().max(40).nullable().optional(),
  })
  .strict();

const updateService = createService
  .partial()
  .extend({ slug: slugSchema.optional() })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCreateService: mk(createService),
  validateUpdateService: mk(updateService),
};
