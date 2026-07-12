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

// 60k chars ≈ 15k tokens — roomy enough for a pasted brief or meeting notes
// without letting a paste bomb pin the vendor call.
const MESSAGE_MAX_CHARS = 60000;

const messagePost = z
  .object({
    content: z.string().max(MESSAGE_MAX_CHARS).optional(),
    input_mode: z.enum(["text", "voice"]).optional(),
    transcribed_text: z.string().max(MESSAGE_MAX_CHARS).nullable().optional(),
    source_audio_url: z.string().url().nullable().optional(),
  })
  .strict()
  .refine((v) => (v.content && v.content.trim()) || v.source_audio_url, {
    message: "provide content or a source_audio_url",
  });

const reason = z.object({ reason: z.string().max(2000).optional() }).strict();

// Step payload edit — a plain JSON object (the step's tool arguments), bounded
// so a paste bomb can't land in ai_pending_actions.payload.
const stepPayloadUpdate = z
  .object({
    payload: z.record(z.any()),
  })
  .strict()
  .refine((v) => JSON.stringify(v.payload).length <= 40000, {
    message: "payload too large (max 40000 characters as JSON)",
  });

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

// ── Settings / personalisation (PR6) ───────────────────────
// A 24h HH:MM (or HH:MM:SS) wall-clock time, matching the TIME columns.
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "expected HH:MM (24h)");

const settingsUpdate = z
  .object({
    assistant_name: z.string().min(1).max(60).optional(),
    tone: z.enum(["warm", "concise", "formal"]).optional(),
    avatar_url: z.string().url().max(2000).nullable().optional(),
    pronoun: z.enum(["she", "he", "they", "it"]).optional(),
    work_start: hhmm.optional(),
    work_end: hhmm.optional(),
    timezone: z.string().min(1).max(64).optional(),
    morning_brief_at: hhmm.optional(),
    evening_review_at: hhmm.optional(),
    quiet_start: hhmm.optional(),
    quiet_end: hhmm.optional(),
    celebrate_wins: z.boolean().optional(),
    adaptive_timing: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: "provide at least one field to update",
  });

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateConversationCreate: mk(conversationCreate),
  validateMessagePost: mk(messagePost),
  validateReason: mk(reason),
  validateStepPayloadUpdate: mk(stepPayloadUpdate),
  validateFollowupRespond: mk(followupRespond),
  validateFollowupAct: mk(followupAct),
  validateFollowupSnooze: mk(followupSnooze),
  validateScheduleFocus: mk(scheduleFocus),
  validateScheduleReschedule: mk(scheduleReschedule),
  validateTemplateSave: mk(templateSave),
  validateTemplateInstantiate: mk(templateInstantiate),
  validateSettingsUpdate: mk(settingsUpdate),
  schemas: {
    conversationCreate,
    messagePost,
    reason,
    stepPayloadUpdate,
    followupRespond,
    followupAct,
    followupSnooze,
    scheduleFocus,
    scheduleReschedule,
    templateSave,
    templateInstantiate,
    settingsUpdate,
  },
};
