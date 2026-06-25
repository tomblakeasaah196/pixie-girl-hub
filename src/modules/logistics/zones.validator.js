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

const rateTier = z.object({
  label: z.string().min(1),
  min_qty: z.coerce.number().int().positive(),
  max_qty: z.coerce.number().int().positive().nullable().optional(),
  fee_ngn: z.coerce.number().nonnegative(),
});

const rateCard = z
  .object({
    tiers: z.array(rateTier).optional().default([]),
    add_on_per_2_ngn: z.coerce.number().nonnegative().optional(),
  })
  .default({ tiers: [] });

const zoneBase = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(1000).optional(),
  geometry_type: z.enum(["polygon", "radius", "country"]),
  // Optional: 'country' zones carry no geometry (matched by country_code).
  geometry: geometry.optional(),
  fee_ngn: z.coerce.number().nonnegative(),
  country_code: z.string().max(20).optional(),
  priority: z.coerce.number().int().optional(),
  is_active: z.boolean().optional(),
  rate_card: rateCard.optional(),
  courier_key: z.string().max(60).optional(),
  // Explicit "this zone is free on purpose" marker. Lets the system tell an
  // intentional ₦0 (a promo / VIP rate → "Free delivery") apart from a zone
  // that was never priced (→ fee confirmed before dispatch).
  is_free_delivery: z.boolean().optional(),
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
