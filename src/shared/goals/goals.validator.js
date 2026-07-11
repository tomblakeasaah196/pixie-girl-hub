/**
 * Goals (Chief of Staff, PR1) — Zod validators.
 *
 * Mirrors the tasks module style: `.strict()` schemas + an `mk` wrapper that
 * replaces req.body with the parsed value so unknown fields are rejected.
 */

"use strict";

const { z } = require("zod");

const STATUS = ["active", "on_hold", "achieved", "archived", "cancelled"];
const PRIORITY = ["low", "normal", "high", "urgent"];
const MS_STATUS = ["pending", "in_progress", "done", "skipped"];

// Accepts a date (YYYY-MM-DD) or an ISO datetime whose date prefix we keep.
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "expected YYYY-MM-DD");

const milestoneInput = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  target_date: dateStr.nullable().optional(),
  display_order: z.coerce.number().int().optional(),
  depends_on_milestone_id: z.string().uuid().nullable().optional(),
});

const goalCreate = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().max(8000).optional(),
    status: z.enum(STATUS).optional(),
    priority: z.enum(PRIORITY).optional(),
    owner_user_id: z.string().uuid().nullable().optional(),
    target_date: dateStr.nullable().optional(),
    milestones: z.array(milestoneInput).max(50).optional(),
  })
  .strict();

const goalUpdate = z
  .object({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(8000).nullable().optional(),
    status: z.enum(STATUS).optional(),
    priority: z.enum(PRIORITY).optional(),
    owner_user_id: z.string().uuid().nullable().optional(),
    target_date: dateStr.nullable().optional(),
  })
  .strict();

const milestoneAdd = milestoneInput.strict();

const milestoneUpdate = z
  .object({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(4000).nullable().optional(),
    status: z.enum(MS_STATUS).optional(),
    target_date: dateStr.nullable().optional(),
    display_order: z.coerce.number().int().optional(),
    depends_on_milestone_id: z.string().uuid().nullable().optional(),
  })
  .strict();

const stakeholderAdd = z
  .object({
    user_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    role: z.string().max(80).optional(),
  })
  .strict()
  .refine((v) => (v.user_id ? 1 : 0) + (v.contact_id ? 1 : 0) === 1, {
    message: "provide exactly one of user_id or contact_id",
  });

// Linking an existing task/event to this goal — optional milestone target.
const link = z
  .object({ milestone_id: z.string().uuid().nullable().optional() })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateGoalCreate: mk(goalCreate),
  validateGoalUpdate: mk(goalUpdate),
  validateMilestoneAdd: mk(milestoneAdd),
  validateMilestoneUpdate: mk(milestoneUpdate),
  validateStakeholderAdd: mk(stakeholderAdd),
  validateLink: mk(link),
  // Pure schemas exported for unit tests.
  schemas: { goalCreate, goalUpdate, milestoneAdd, milestoneUpdate, stakeholderAdd },
};
