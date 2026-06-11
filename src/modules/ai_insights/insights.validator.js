/**
 * AI Insights (V2.2 §6.30) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const resolveBody = z
  .object({ reason: z.string().max(2000).optional() })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateResolve: mk(resolveBody),
};
