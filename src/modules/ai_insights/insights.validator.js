/**
 * AI Insights (V2.2 §6.30 / §6.31) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const resolveBody = z
  .object({ reason: z.string().max(2000).optional() })
  .strict();

// AI Control matrix update — any subset of the three toggles.
const moduleUpdateBody = z
  .object({
    insights_enabled: z.boolean().optional(),
    narration_enabled: z.boolean().optional(),
    frequency: z.enum(["realtime", "daily", "weekly", "off"]).optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, {
    message: "At least one field is required",
  });

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateResolve: mk(resolveBody),
  validateModuleUpdate: mk(moduleUpdateBody),
};
