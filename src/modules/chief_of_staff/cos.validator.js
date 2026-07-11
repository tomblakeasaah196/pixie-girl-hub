/**
 * Chief of Staff (PR3) — Zod validators. `.strict()` throughout; `mk` replaces
 * req.body with the parsed value so unknown fields are rejected.
 */

"use strict";

const { z } = require("zod");

const conversationCreate = z
  .object({
    title: z.string().max(300).nullable().optional(),
    is_voice_started: z.boolean().optional(),
  })
  .strict();

const messagePost = z
  .object({
    content: z.string().max(20000).optional(),
    input_mode: z.enum(["text", "voice"]).optional(),
    transcribed_text: z.string().max(20000).nullable().optional(),
    source_audio_url: z.string().url().nullable().optional(),
  })
  .strict()
  .refine((v) => (v.content && v.content.trim()) || v.source_audio_url, {
    message: "provide content or a source_audio_url",
  });

const reason = z.object({ reason: z.string().max(2000).optional() }).strict();

// ── Follow-up state machine (PR4) ──────────────────────────
const followupRespond = z
  .object({ answer: z.enum(["done", "in_progress", "delayed"]) })
  .strict();

const followupAct = z
  .object({
    action: z
      .object({
        kind: z.enum([
          "move_deadline",
          "reschedule_dependents",
          "notify_stakeholder",
        ]),
        payload: z
          .object({ days: z.number().int().positive().max(365).optional() })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

const followupSnooze = z
  .object({ until: z.string().datetime({ offset: true }).optional() })
  .strict();

// ── Intelligence (PR5) ─────────────────────────────────────
// Accept a full ISO datetime OR a plain YYYY-MM-DD for date fields.
const dateish = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}([T ].*)?$/, "expected YYYY-MM-DD or ISO datetime");

const scheduleFocus = z
  .object({
    duration: z.number().int().min(15).max(480).optional(), // minutes
    within: z.number().int().min(1).max(30).optional(), // days ahead to scan
  })
  .strict();

const scheduleReschedule = z
  .object({
    match: z.string().min(1).max(200),
    days: z.number().int().min(1).max(365).optional(),
  })
  .strict();

const templateSave = z
  .object({
    goal_id: z.string().uuid(),
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
  })
  .strict();

const templateInstantiate = z
  .object({
    start_date: dateish.optional(),
    name: z.string().min(1).max(200).optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateConversationCreate: mk(conversationCreate),
  validateMessagePost: mk(messagePost),
  validateReason: mk(reason),
  validateFollowupRespond: mk(followupRespond),
  validateFollowupAct: mk(followupAct),
  validateFollowupSnooze: mk(followupSnooze),
  validateScheduleFocus: mk(scheduleFocus),
  validateScheduleReschedule: mk(scheduleReschedule),
  validateTemplateSave: mk(templateSave),
  validateTemplateInstantiate: mk(templateInstantiate),
  schemas: {
    conversationCreate,
    messagePost,
    reason,
    followupRespond,
    followupAct,
    followupSnooze,
    scheduleFocus,
    scheduleReschedule,
    templateSave,
    templateInstantiate,
  },
};
