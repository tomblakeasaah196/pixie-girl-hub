/**
 * Automated retention workflows (F-4 / PD §6.23) — Zod validators.
 * trigger_type / action_type values are enforced by the DB CHECK constraints,
 * so they're accepted as bounded strings here.
 */

"use strict";

const { z } = require("zod");

const createSchema = z
  .object({
    rule_key: z.string().min(2).max(80),
    display_name: z.string().min(1).max(160),
    description: z.string().max(1000).optional(),
    trigger_type: z.string().min(2).max(60),
    trigger_conditions: z.record(z.any()).optional(),
    wait_minutes: z.coerce.number().int().nonnegative().optional(),
    action_type: z.string().min(2).max(60),
    action_config: z.record(z.any()),
    email_template_id: z.string().uuid().optional(),
    coupon_template: z.record(z.any()).optional(),
    segment_id: z.string().uuid().optional(),
    max_executions_per_customer: z.coerce.number().int().positive().optional(),
    rate_limit_days: z.coerce.number().int().positive().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const updateSchema = createSchema.partial().omit({ rule_key: true });

const triggerSchema = z
  .object({
    trigger_type: z.string().min(2).max(60),
    contact_id: z.string().uuid().optional(),
    source_table: z.string().max(60).optional(),
    source_id: z.string().uuid().optional(),
  })
  .strict();

const activeSchema = z.object({ is_active: z.boolean() }).strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCreate: mk(createSchema),
  validateUpdate: mk(updateSchema),
  validateTrigger: mk(triggerSchema),
  validateActive: mk(activeSchema),
  createSchema,
  updateSchema,
  triggerSchema,
};
