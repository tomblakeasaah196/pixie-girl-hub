"use strict";

const { z } = require("zod");

// api_key is optional so an operator can flip is_active/notes without
// re-pasting the key — the repo leaves api_key_enc untouched when omitted
// (same "rotate one field at a time" convention as apify_settings).
const upsert = z
  .object({
    api_key: z.string().min(8).max(400).optional(),
    is_active: z.boolean().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const reveal = z
  .object({
    field: z.literal("api_key"),
    password: z.string().min(1).max(200),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateUpsert: mk(upsert),
  validateReveal: mk(reveal),
};
