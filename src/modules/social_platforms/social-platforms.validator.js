"use strict";

const { z } = require("zod");

const metricSpec = z
  .object({
    key: z.string().min(1).max(40),
    label: z.string().min(1).max(60),
    aliases: z.array(z.string().min(1).max(80)).min(1),
  })
  .strict();

const create = z
  .object({
    platform_key: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,40}$/, "lowercase letters, digits, underscore; must start with a letter"),
    display_name: z.string().min(1).max(80),
    brand_color: z.string().min(1).max(200),
    icon_glyph: z.string().max(8).optional(),
    apify_actor_id: z.string().max(200).optional(),
    apify_input_template: z.record(z.any()).optional(),
    metrics_schema: z.array(metricSpec).optional(),
    supports_bio: z.boolean().optional(),
    sort_order: z.coerce.number().int().min(0).max(9999).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const update = z
  .object({
    display_name: z.string().min(1).max(80).optional(),
    brand_color: z.string().min(1).max(200).optional(),
    icon_glyph: z.string().max(8).optional(),
    apify_actor_id: z.string().max(200).nullable().optional(),
    apify_input_template: z.record(z.any()).optional(),
    metrics_schema: z.array(metricSpec).optional(),
    supports_bio: z.boolean().optional(),
    sort_order: z.coerce.number().int().min(0).max(9999).optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required");

const setActive = z.object({ is_active: z.boolean() }).strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCreate: mk(create),
  validateUpdate: mk(update),
  validateSetActive: mk(setActive),
};
