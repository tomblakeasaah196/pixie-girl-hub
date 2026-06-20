/**
 * Contacts (V2.2 §6.12) — Zod validators.
 */

"use strict";

const { z } = require("zod");

/** Social handle: optional leading '@', then 1-30 chars of letters/digits/._
 *  Empty string from the form is treated as "not provided". Stored without
 *  the leading '@' so the canonical form is consistent. */
const socialHandle = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .trim()
    .max(60)
    .regex(/^@?[A-Za-z0-9._]{1,30}$/, "Invalid handle")
    .transform((s) => s.replace(/^@/, ""))
    .optional(),
);

const contactCreate = z
  .object({
    display_name: z.string().min(1).max(200),
    primary_phone: z.string().min(5).max(30),
    contact_type: z.array(z.string()).optional(),
    first_name: z.string().max(120).optional(),
    last_name: z.string().max(120).optional(),
    company_name: z.string().max(200).optional(),
    gender: z.enum(["M", "F", "other", "prefer_not"]).optional(),
    date_of_birth: z.string().date().optional(),
    tin: z.string().max(40).optional(),
    cac_number: z.string().max(40).optional(),
    whatsapp_number: z.string().max(30).optional(),
    email: z.string().email().optional(),
    country_code: z.string().max(4).optional(),
    instagram_handle: socialHandle,
    tiktok_handle: socialHandle,
    facebook_handle: socialHandle,
    priority_level: z.enum(["vip", "regular", "new"]).optional(),
    assigned_to: z.string().uuid().optional(),
    visible_to: z.array(z.string()).optional(),
    source: z.string().max(40).optional(),
    notes: z.string().max(4000).optional(),
  })
  .strict();

const segmentCreate = z
  .object({
    name: z.string().min(1).max(160),
    description: z.string().max(2000).optional(),
    filter: z.record(z.any()).optional(),
  })
  .strict();

const addressCreate = z
  .object({
    address_type: z
      .enum(["delivery", "billing", "office", "home", "other"])
      .optional(),
    line1: z.string().min(1).max(300),
    line2: z.string().max(300).optional(),
    area: z.string().max(120).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    country: z.string().max(120).optional(),
    country_code: z.string().max(4).optional(),
    postal_code: z.string().max(20).optional(),
    landmark: z.string().max(200).optional(),
    recipient_name: z.string().max(160).optional(),
    recipient_phone: z.string().max(30).optional(),
    google_maps_url: z.string().url().optional(),
    latitude: z.coerce.number().optional(),
    longitude: z.coerce.number().optional(),
    is_default: z.boolean().optional(),
    is_verified: z.boolean().optional(),
  })
  .strict();

const tagCreate = z
  .object({
    tag_name: z.string().min(1).max(60),
    colour: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex colour")
      .optional(),
  })
  .strict();

const mw = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

module.exports = {
  validateCreate: mw(contactCreate),
  validateUpdate: mw(contactCreate.partial()),
  validateSegmentCreate: mw(segmentCreate),
  validateSegmentUpdate: mw(segmentCreate.partial()),
  validateAddressCreate: mw(addressCreate),
  validateAddressUpdate: mw(addressCreate.partial()),
  validateTagCreate: mw(tagCreate),
  contactCreate,
  segmentCreate,
  addressCreate,
};
