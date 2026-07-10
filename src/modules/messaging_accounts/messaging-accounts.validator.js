"use strict";

const { z } = require("zod");

const PLATFORM = ["whatsapp", "instagram", "facebook", "email", "email_outbound"];

const REVEAL_FIELDS = [
  "access_token",
  "app_secret",
  "verify_token",
  "business_account_id",
  "smtp_password",
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
    // 'email_outbound' only — per-brand SMTP relay config. host/port/
    // user/from/reply_to are plain; smtp_password is encrypted like
    // every other secret on this row.
    smtp_host: z.string().max(255).optional(),
    smtp_port: z.coerce.number().int().min(1).max(65535).optional(),
    smtp_secure: z.boolean().optional(),
    smtp_user: z.string().max(255).optional(),
    smtp_password: z.string().max(1000).optional(),
    from_email: z.string().email().optional(),
    from_name: z.string().max(160).optional(),
    reply_to_email: z.string().email().optional(),
  })
  .strict();

const setActive = z.object({ is_active: z.boolean() }).strict();

// Meta's business-profile "vertical" (industry) allow-list. Sending
// UNDEFINED resets the category. Kept in sync with the UI select.
const WA_VERTICALS = [
  "UNDEFINED",
  "OTHER",
  "AUTO",
  "BEAUTY",
  "APPAREL",
  "EDU",
  "ENTERTAIN",
  "EVENT_PLAN",
  "FINANCE",
  "GROCERY",
  "GOVT",
  "HOTEL",
  "HEALTH",
  "NONPROFIT",
  "PROF_SERVICES",
  "RETAIL",
  "TRAVEL",
  "RESTAURANT",
  "ALCOHOL",
  "ONLINE_GAMBLING",
  "PHYSICAL_GAMBLING",
  "OTC_DRUGS",
  "NOT_A_BIZ",
];

// WhatsApp business profile text fields. Every field is optional so the
// operator can update one at a time; an empty string clears a field on
// Meta. Length caps mirror Meta's own limits (about ≤ 139, description
// ≤ 512, address ≤ 256, email ≤ 128, up to 2 websites of ≤ 256).
const whatsappProfile = z
  .object({
    about: z.string().max(139).optional(),
    address: z.string().max(256).optional(),
    description: z.string().max(512).optional(),
    email: z.union([z.string().email().max(128), z.literal("")]).optional(),
    vertical: z.enum(WA_VERTICALS).optional(),
    websites: z
      .array(z.union([z.string().url().max(256), z.literal("")]))
      .max(2)
      .optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, {
    message: "Nothing to update",
  });

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
  validateWhatsAppProfile: mk(whatsappProfile),
  WA_VERTICALS,
};
