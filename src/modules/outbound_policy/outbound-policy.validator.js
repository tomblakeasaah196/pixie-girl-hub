"use strict";

const { z } = require("zod");

const channel = z.enum([
  "email",
  "whatsapp",
  "instagram",
  "in_app_only",
  "respect_contact_pref",
  "disabled",
]);
const fallbackChannel = z.enum([
  "email",
  "whatsapp",
  "instagram",
  "in_app_only",
  "disabled",
]);

const upsert = z
  .object({
    event_key: z.string().min(1).max(80),
    channel_preference: channel,
    fallback_channel: fallbackChannel.optional(),
    rationale: z.string().max(2000).optional(),
    block_whatsapp: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = { validateUpsert: mk(upsert) };
