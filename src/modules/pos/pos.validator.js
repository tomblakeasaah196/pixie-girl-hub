/**
 * POS terminal-payment reconciliation — Zod validators.
 */

"use strict";

const { z } = require("zod");
const { VALID_BRANDS } = require("../../config/brands");

const brandEnum = z
  .string()
  .refine((v) => VALID_BRANDS.has(v), { message: "Unknown brand" });

const matchSchema = z
  .object({
    brand: brandEnum,
    order_id: z.string().uuid(),
  })
  .strict();

// Decision 5B: a short reason is required to ignore a pending item — it's
// real customer money being written off as a non-match, so it keeps an
// audit trail instead of a silent one-click dismiss.
const ignoreSchema = z
  .object({
    note: z.string().min(3).max(500),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateMatch: mk(matchSchema),
  validateIgnore: mk(ignoreSchema),
  matchSchema,
  ignoreSchema,
};
