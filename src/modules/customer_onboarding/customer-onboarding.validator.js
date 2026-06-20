/**
 * Customer Onboarding — Zod validators.
 *
 * The submission payload is the "Online QR form" — the same payload
 * the public page POSTs and the staff drawer can pre-fill. Keeping it
 * Zod-validated on the boundary stops bad data ever reaching the
 * contact + address tables.
 */

"use strict";

const { z } = require("zod");

const addressSchema = z
  .object({
    line1: z.string().min(1).max(200),
    line2: z.string().max(200).optional(),
    area: z.string().max(120).optional(),
    city: z.string().max(80).default("Lagos"),
    state: z.string().max(80).default("Lagos"),
    country: z.string().max(80).default("Nigeria"),
    country_code: z.string().length(2).default("NG"),
    postal_code: z.string().max(20).optional(),
    landmark: z.string().max(200).optional(),
    google_maps_url: z.string().url().max(2000).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .strict();

const submissionPayload = z
  .object({
    first_name: z.string().min(1).max(80),
    last_name: z.string().max(80).optional(),
    display_name: z.string().max(160).optional(),
    primary_phone: z.string().max(40).optional(),
    whatsapp_number: z.string().max(40).optional(),
    email: z.string().email().max(200).optional(),
    instagram_handle: z.string().max(80).optional(),
    instagram_user_id: z.string().max(80).optional(),
    preferred_channel: z
      .enum(["whatsapp", "instagram", "email", "sms"])
      .optional(),
    date_of_birth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
      .optional(),
    dob_day: z.number().int().min(1).max(31).optional(),
    dob_month: z.number().int().min(1).max(12).optional(),
    delivery_address: addressSchema,
    billing_same_as_delivery: z.boolean().default(true),
    billing_address: addressSchema.optional(),
    inspiration_photo_ids: z.array(z.string().uuid()).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.primary_phone || v.whatsapp_number || v.email || v.instagram_handle,
    {
      message:
        "Provide at least one contact method: phone, WhatsApp, email or Instagram handle",
    },
  );

const createLink = z
  .object({
    business: z.string().min(1).max(40),
    channel_id: z.string().uuid().optional(),
    seed_payload: z.record(z.any()).optional(),
    source: z.enum(["online", "walkin", "staff"]).optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCreateLink: mk(createLink),
  validateSubmission: mk(submissionPayload),
};
