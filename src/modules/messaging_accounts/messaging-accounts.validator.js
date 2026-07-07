"use strict";

const { z } = require("zod");

const PLATFORM = ["whatsapp", "instagram", "facebook", "email"];

const REVEAL_FIELDS = [
  "access_token",
  "app_secret",
  "verify_token",
  "business_account_id",
];

// New fields are optional so callers can rotate one secret at a
// time (typing a new access_token without re-entering the app_secret,
// for example). The repo's ON CONFLICT COALESCE keeps existing values.
const upsert = z
  .object({
    platform: z.enum(PLATFORM),
    external_account_id: z.string().min(1).max(200),
    display_name: z.string().min(1).max(160),
    access_token: z.string().max(4000).optional(),
    app_secret: z.string().max(4000).optional(),
    verify_token: z.string().max(400).optional(),
    business_account_id: z.string().max(200).optional(),
    // Legacy plaintext verify token — kept for the /settings page
    // migration path. New writes should use `verify_token` above.
    webhook_verify_token: z.string().max(200).optional(),
    is_active: z.boolean().optional(),
    metadata: z.record(z.any()).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const setActive = z.object({ is_active: z.boolean() }).strict();

const reveal = z
  .object({
    field: z.enum(REVEAL_FIELDS),
    password: z.string().min(1).max(200),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateUpsert: mk(upsert),
  validateSetActive: mk(setActive),
  validateReveal: mk(reveal),
};
