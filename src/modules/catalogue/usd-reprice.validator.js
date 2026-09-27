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

// Approve / reject a pending rate-change request: optional note only — the
// rate applied is the one that was requested, never re-sent by the client.
const decisionSchema = z
  .object({ notes: z.string().trim().max(1000).optional() })
  .strict();

const mw = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

// The request id is a workflow instance id; reject anything that isn't a UUID
// here rather than let Postgres fail the cast.
const instanceParams = z.object({ instanceId: z.string().uuid() }).passthrough();
const decision = (req, res, next) => {
  req.params = { ...req.params, ...instanceParams.parse(req.params ?? {}) };
  return mw(decisionSchema)(req, res, next);
};

module.exports = {
  validatePreview: mw(previewSchema),
  validateApply: mw(applySchema),
  validateDecision: decision,
};
