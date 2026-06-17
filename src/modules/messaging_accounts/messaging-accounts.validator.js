"use strict";

const { z } = require("zod");

const PLATFORM = ["whatsapp", "instagram", "facebook", "email"];

const upsert = z
  .object({
    platform: z.enum(PLATFORM),
    external_account_id: z.string().min(1).max(200),
    display_name: z.string().min(1).max(160),
    access_token: z.string().max(2000).optional(),
    webhook_verify_token: z.string().max(200).optional(),
    is_active: z.boolean().optional(),
    metadata: z.record(z.any()).optional(),
  })
  .strict();

const setActive = z.object({ is_active: z.boolean() }).strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateUpsert: mk(upsert),
  validateSetActive: mk(setActive),
};
