/**
 * Tasks (V2.2 §6.19) — Zod validators.
 */

"use strict";

const { z } = require("zod");
const { flexDatetime } = require("../../utils/validation");

const STATUS = ["to_do", "in_progress", "in_review", "done", "cancelled"];
const PRIORITY = ["low", "normal", "high", "urgent"];

// due_at accepts any ISO shape (UTC, offset, zoneless local, bare date). A
// bare date lands at 17:00 business time — "due Friday" means end of that
// working day, matching the playbook convention in cos.templates.
const dueAt = flexDatetime({ dateOnlyTime: "17:00:00" });
// remind_at is an absolute reminder instant (custom reminders). When present
// it wins over the reminder_minutes-derived value.
const remindAt = flexDatetime({ dateOnlyTime: "09:00:00" });

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
    assigned_to: z.string().uuid().nullable().optional(),
    due_at: dueAt.nullable().optional(),
    parent_task_id: z.string().uuid().optional(),
    reference_type: z.string().max(40).optional(),
    reference_id: z.string().uuid().optional(),
    is_personal: z.boolean().optional(),
    reminder_minutes: z.coerce.number().int().min(0).nullable().optional(),
    remind_at: remindAt.nullable().optional(),
    subtasks: z.array(subtask).optional(),
  })
  .strict();

const taskUpdate = z
  .object({
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(4000).nullable().optional(),
    status: z.enum(STATUS).optional(),
    priority: z.enum(PRIORITY).optional(),
    assigned_to: z.string().uuid().nullable().optional(),
    due_at: dueAt.nullable().optional(),
    reference_type: z.string().max(40).optional(),
    reference_id: z.string().uuid().optional(),
    is_personal: z.boolean().optional(),
    reminder_minutes: z.coerce.number().int().min(0).nullable().optional(),
    remind_at: remindAt.nullable().optional(),
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
