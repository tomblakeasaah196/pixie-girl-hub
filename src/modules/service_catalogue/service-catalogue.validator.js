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

const money = z.coerce.number().nonnegative();
// Image fields accept absolute URLs OR our relative /media paths.
const imageUrl = z.string().max(2000).nullable().optional();

const createService = z
  .object({
    name: z.string().min(1).max(120),
    slug: slugSchema,
    // `.nullable()` on optional text so the admin form can clear them; numeric
    // fields `.coerce` so string inputs from the UI's number fields parse.
    description: z.string().max(2000).nullable().optional(),
    short_description: z.string().max(500).nullable().optional(),
    long_description: z.string().max(8000).nullable().optional(),
    base_price_ngn: money.optional(),
    base_price_usd: money.nullable().optional(),
    compare_at_price_ngn: money.nullable().optional(),
    compare_at_price_usd: money.nullable().optional(),
    price_is_from: z.boolean().optional(),
    duration_minutes: z.coerce.number().int().positive().nullable().optional(),
    category: z.string().max(60).nullable().optional(),
    tags: z.array(z.string().max(40)).nullable().optional(),
    image_url: imageUrl,
    thumbnail_url: imageUrl,
    is_active: z.boolean().optional(),
    is_visible_storefront: z.boolean().optional(),
    is_featured: z.boolean().optional(),
    sort_order: z.coerce.number().int().optional(),
    required_stylist_tier: z.string().max(40).nullable().optional(),
    // How it sells online.
    sale_mode: z.enum(["book", "buy", "enquire"]).optional(),
    deposit_required: z.boolean().optional(),
    deposit_pct: z.coerce.number().min(0).max(100).nullable().optional(),
    buffer_minutes: z.coerce.number().int().min(0).nullable().optional(),
    location_type: z
      .enum(["in_studio", "home", "virtual"])
      .nullable()
      .optional(),
    cancellation_policy: z.string().max(2000).nullable().optional(),
    meta_title: z.string().max(200).nullable().optional(),
    meta_description: z.string().max(500).nullable().optional(),
    whats_included: z.array(z.string().max(200)).nullable().optional(),
    faqs: z
      .array(z.object({ q: z.string().max(300), a: z.string().max(2000) }))
      .nullable()
      .optional(),
    aftercare_notes: z.string().max(4000).nullable().optional(),
  })
  .strict();

const updateService = createService
  .partial()
  .extend({ slug: slugSchema.optional() })
  .strict();

// Public booking request (no auth) — minimal, customer-supplied.
const bookingRequest = z
  .object({
    full_name: z.string().min(1).max(160),
    phone: z.string().max(40).optional(),
    email: z.string().email().max(200).optional(),
    preferred_date: z.string().date().optional(),
    preferred_time: z.string().max(40).optional(),
    notes: z.string().max(2000).optional(),
    source: z.string().max(40).optional(),
  })
  .strict()
  .refine((v) => v.phone || v.email, {
    message: "Provide a phone or an email so we can reach you",
  });

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCreateService: mk(createService),
  validateUpdateService: mk(updateService),
  validateBookingRequest: mk(bookingRequest),
};
