/**
 * Payment-gateway configuration validators (B / PD §6.21).
 */

"use strict";

const { z } = require("zod");

const PROVIDER = z.enum(["paystack", "opay", "nomba", "stripe"]);
const ROLE = z.enum(["primary", "fallback", "standalone"]);

const configure = z
  .object({
    provider: PROVIDER,
    is_active: z.boolean().optional(),
    role: ROLE.optional(),
    // Plaintext credential bag — encrypted at rest by the service.
    credentials: z.record(z.string()).optional(),
    supported_currencies: z.array(z.string().length(3)).max(10).optional(),
    display_label: z.string().max(120).optional(),
  })
  .strict();

const setActive = z.object({ is_active: z.boolean() }).strict();
const setRole = z.object({ role: ROLE }).strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateConfigure: mk(configure),
  validateSetActive: mk(setActive),
  validateSetRole: mk(setRole),
};
