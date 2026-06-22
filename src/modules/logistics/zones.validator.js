/**
 * Delivery zones — Zod validators.
 */

"use strict";

const { z } = require("zod");

const point = z.tuple([z.number(), z.number()]); // [lng, lat]
const geometry = z
  .object({
    points: z.array(point).optional(),
    center: point.optional(),
    radius_km: z.coerce.number().positive().optional(),
  })
  .passthrough();

const zoneBase = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).optional(),
  geometry_type: z.enum(["polygon", "radius", "country"]),
  // Optional: 'country' zones carry no geometry (matched by country_code).
  geometry: geometry.optional(),
  fee_ngn: z.coerce.number().nonnegative(),
  country_code: z.string().max(3).optional(),
  priority: z.coerce.number().int().optional(),
  is_active: z.boolean().optional(),
});

const zoneCreate = zoneBase.strict();
const zoneUpdate = zoneBase.partial().strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCreate: mk(zoneCreate),
  validateUpdate: mk(zoneUpdate),
};
