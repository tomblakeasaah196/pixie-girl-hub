/**
 * Workspace Notes (Chief of Staff, PR1) — Zod validators.
 * Served under the `goals` permission (notes ride under goals).
 */

"use strict";

const { z } = require("zod");

const noteCreate = z
  .object({
    title: z.string().max(300).nullable().optional(),
    body: z.string().max(50000).optional(),
    goal_id: z.string().uuid().nullable().optional(),
    milestone_id: z.string().uuid().nullable().optional(),
    pinned: z.boolean().optional(),
  })
  .strict();

const noteUpdate = z
  .object({
    title: z.string().max(300).nullable().optional(),
    body: z.string().max(50000).optional(),
    goal_id: z.string().uuid().nullable().optional(),
    milestone_id: z.string().uuid().nullable().optional(),
    pinned: z.boolean().optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateNoteCreate: mk(noteCreate),
  validateNoteUpdate: mk(noteUpdate),
  schemas: { noteCreate, noteUpdate },
};
