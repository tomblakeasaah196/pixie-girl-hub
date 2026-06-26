/**
 * USD bulk-reprice — Zod validators.
 */

"use strict";

const { z } = require("zod");

const rate = z.coerce.number().positive().max(100000);
const rounding = z.enum(["exact", "whole", "ninety_nine"]).default("exact");

const previewSchema = z.object({ rate, rounding }).strict();

const applySchema = z
  .object({
    rate,
    rounding,
    // Server-side confirmation gate — the apply is refused unless this is true.
    confirm: z.literal(true),
  })
  .strict();

const mw = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

module.exports = {
  validatePreview: mw(previewSchema),
  validateApply: mw(applySchema),
};
