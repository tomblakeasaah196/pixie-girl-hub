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
    description: z.string().max(2000).optional(),
    base_price_ngn: z.number().nonnegative().optional(),
    duration_minutes: z.number().int().positive().optional(),
    category: z.string().max(60).optional(),
    image_url: z.string().url().max(2000).optional(),
    is_active: z.boolean().optional(),
    sort_order: z.number().int().optional(),
    required_stylist_tier: z.string().max(40).optional(),
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
