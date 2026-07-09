"use strict";

const { z } = require("zod");

const CATEGORY = ["MARKETING", "UTILITY", "AUTHENTICATION"];
const RATE_CATEGORY = ["MARKETING", "UTILITY", "AUTHENTICATION", "SERVICE"];

// Meta component objects. We keep the schema permissive on the inner
// shape (Meta's format evolves) but pin the type + a couple of common
// fields so an obviously-broken payload is rejected before it hits the
// Graph API.
const component = z
  .object({
    type: z.enum(["HEADER", "BODY", "FOOTER", "BUTTONS"]),
    format: z.string().optional(),
    text: z.string().max(4096).optional(),
    example: z.record(z.any()).optional(),
    buttons: z.array(z.record(z.any())).max(10).optional(),
  })
  .passthrough();

// Meta template names must be lowercase alphanumeric + underscore.
const templateName = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores only");

const create = z
  .object({
    name: templateName,
    language: z.string().min(2).max(15).default("en_US"),
    category: z.enum(CATEGORY),
    components: z.array(component).min(1).max(10),
    // When true, submit straight to Meta for review; otherwise save as
    // a local draft the operator can submit later.
    submit: z.boolean().optional().default(false),
  })
  .strict();

const update = z
  .object({
    category: z.enum(CATEGORY).optional(),
    components: z.array(component).min(1).max(10).optional(),
    submit: z.boolean().optional().default(false),
  })
  .strict();

const rate = z
  .object({
    category: z.enum(RATE_CATEGORY),
    amount_ngn: z.number().min(0).max(100000),
    note: z.string().max(500).optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCreate: mk(create),
  validateUpdate: mk(update),
  validateRate: mk(rate),
};
