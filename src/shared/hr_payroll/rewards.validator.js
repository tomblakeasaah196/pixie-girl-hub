/**
 * Zod schemas for the rewards engine (rules + evaluate + grant actions).
 */

"use strict";

const { z } = require("zod");

const METRICS = [
  "first_in_days", "last_out_days", "punctual_days", "data_entries",
  "styles_completed", "sales_count", "quality_avg",
];

const ruleCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  metric: z.enum(METRICS),
  comparator: z.enum(["gte", "lte"]).optional(),
  threshold: z.number().nonnegative(),
  period_type: z.enum(["month"]).optional(),
  reward_type: z.enum(["fixed_ngn", "pct_salary", "salary_increase_pct"]),
  reward_value: z.number().nonnegative(),
  is_active: z.boolean().optional(),
});
const ruleUpdateSchema = ruleCreateSchema.partial().refine(
  (o) => Object.keys(o).length > 0,
  "No fields to update",
);

const evaluateSchema = z.object({
  year: z.number().int().min(2020).max(2100).optional(),
  month: z.number().int().min(1).max(12).optional(),
});

const rejectSchema = z.object({
  reason: z.string().max(500).optional(),
});

function make(schema) {
  return (req, _res, next) => {
    req.body = schema.parse(req.body || {});
    next();
  };
}

module.exports = {
  ruleCreate: make(ruleCreateSchema),
  ruleUpdate: make(ruleUpdateSchema),
  evaluate: make(evaluateSchema),
  reject: make(rejectSchema),
};
