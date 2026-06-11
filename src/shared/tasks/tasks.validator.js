/**
 * Tasks (V2.2 §6.19) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const STATUS = [
  "inbox",
  "today",
  "this_week",
  "this_month",
  "later",
  "done",
  "cancelled",
];
const PRIORITY = ["low", "normal", "high", "urgent"];

const subtask = z.object({
  title: z.string().min(1).max(300),
  display_order: z.coerce.number().int().optional(),
});

const taskCreate = z
  .object({
    title: z.string().min(1).max(300),
    description: z.string().max(4000).optional(),
    status: z.enum(STATUS).optional(),
    priority: z.enum(PRIORITY).optional(),
    assigned_to: z.string().uuid().optional(),
    due_at: z.string().datetime().optional(),
    parent_task_id: z.string().uuid().optional(),
    reference_type: z.string().max(40).optional(),
    reference_id: z.string().uuid().optional(),
    subtasks: z.array(subtask).optional(),
  })
  .strict();

const taskUpdate = z
  .object({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(4000).optional(),
    priority: z.enum(PRIORITY).optional(),
    assigned_to: z.string().uuid().optional(),
    due_at: z.string().datetime().optional(),
    reference_type: z.string().max(40).optional(),
    reference_id: z.string().uuid().optional(),
  })
  .strict();

const statusChange = z.object({ status: z.enum(STATUS) }).strict();
const subtaskAdd = z
  .object({
    title: z.string().min(1).max(300),
    display_order: z.coerce.number().int().optional(),
  })
  .strict();
const subtaskToggle = z.object({ is_done: z.boolean() }).strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateTaskCreate: mk(taskCreate),
  validateTaskUpdate: mk(taskUpdate),
  validateStatusChange: mk(statusChange),
  validateSubtaskAdd: mk(subtaskAdd),
  validateSubtaskToggle: mk(subtaskToggle),
};
