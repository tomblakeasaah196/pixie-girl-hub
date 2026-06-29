/**
 * Retention strategy engine (Module 6.23) — Zod validators.
 * trigger_type / action_type are bounded strings here; the DB CHECK
 * constraints are the source of truth for the allowed values.
 */

"use strict";

const { z } = require("zod");

const stepSchema = z
  .object({
    step_order: z.coerce.number().int().positive().optional(),
    wait_minutes: z.coerce.number().int().nonnegative().optional(),
    step_conditions: z.record(z.any()).optional(),
    action_type: z.string().min(2).max(40),
    action_config: z.record(z.any()).optional(),
    email_template_id: z.string().uuid().optional(),
    coupon_template: z.record(z.any()).optional(),
    description: z.string().max(400).optional(),
  })
  .strict();

const createSchema = z
  .object({
    strategy_key: z.string().min(2).max(80),
    display_name: z.string().min(1).max(160),
    description: z.string().max(1000).optional(),
    template_key: z.string().max(80).optional(),
    trigger_type: z.string().min(2).max(60),
    trigger_conditions: z.record(z.any()).optional(),
    audience_segment_id: z.string().uuid().optional(),
    goal_event: z.string().max(60).optional(),
    goal_window_days: z.coerce.number().int().positive().optional(),
    status: z.enum(["draft", "active", "paused", "archived"]).optional(),
    max_enrollments_per_customer: z.coerce.number().int().positive().optional(),
    reenroll_cooldown_days: z.coerce.number().int().positive().optional(),
    steps: z.array(stepSchema).optional(),
  })
  .strict();

const updateSchema = createSchema.partial().omit({ strategy_key: true });

const statusSchema = z
  .object({ status: z.enum(["draft", "active", "paused", "archived"]) })
  .strict();

const fromTemplateSchema = z
  .object({
    template_key: z.string().min(2).max(80),
    overrides: z
      .object({
        strategy_key: z.string().min(2).max(80).optional(),
        display_name: z.string().max(160).optional(),
        description: z.string().max(1000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const previewSchema = z
  .object({ contact_id: z.string().uuid().optional() })
  .strict();

const testSendSchema = z
  .object({ step_order: z.coerce.number().int().positive().optional() })
  .strict();

const triggerSchema = z
  .object({
    trigger_type: z.string().min(2).max(60),
    contact_id: z.string().uuid().optional(),
    source_table: z.string().max(60).optional(),
    source_id: z.string().uuid().optional(),
    event: z.record(z.any()).optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCreate: mk(createSchema),
  validateUpdate: mk(updateSchema),
  validateStatus: mk(statusSchema),
  validateFromTemplate: mk(fromTemplateSchema),
  validatePreview: mk(previewSchema),
  validateTestSend: mk(testSendSchema),
  validateTrigger: mk(triggerSchema),
  createSchema,
  updateSchema,
};
