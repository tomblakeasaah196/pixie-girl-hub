/**
 * WhatsApp Calls — Zod validators. Zod parse errors surface through the
 * global error handler, same as every other module.
 */

"use strict";

const { z } = require("zod");

const OUTCOMES = [
  "deal_closed",
  "order_placed",
  "follow_up",
  "enquiry",
  "complaint",
  "wrong_number",
  "other",
];

// A browser SDP answer is a few KB of text; cap it well above any real
// answer so a runaway payload can't be smuggled through.
const acceptCall = z.object({ sdp: z.string().min(10).max(200_000) }).strict();

const recordOutcome = z
  .object({
    outcome: z.enum(OUTCOMES),
    notes: z.string().max(2000).optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  OUTCOMES,
  validateAccept: mk(acceptCall),
  validateOutcome: mk(recordOutcome),
  // schemas exported for unit tests
  schemas: { acceptCall, recordOutcome },
};
