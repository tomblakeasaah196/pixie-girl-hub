/**
 * Praxis AI Agent (V2.2 §6.29) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const conversationCreate = z
  .object({
    title: z.string().max(200).optional(),
    is_voice_started: z.boolean().optional(),
  })
  .strict();

const messagePost = z
  .object({
    content: z.string().max(8000).optional(),
    input_mode: z.enum(["text", "voice"]).optional(),
    transcribed_text: z.string().max(8000).optional(),
    source_audio_url: z.string().url().max(2000).optional(),
  })
  .strict()
  .refine(
    (d) =>
      Boolean(
        (d.content && d.content.length) ||
        d.transcribed_text ||
        d.source_audio_url,
      ),
    { message: "Provide content, transcribed_text, or source_audio_url" },
  );

const reasonBody = z
  .object({ reason: z.string().max(1000).optional() })
  .strict();

const teachBody = z
  .object({
    title: z.string().max(200).optional(),
    content: z.string().min(3).max(8000),
  })
  .strict();

const feedbackBody = z
  .object({
    rating: z.enum(["up", "down"]),
    comment: z.string().max(4000).optional(),
    conversation_id: z.string().uuid().optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateConversationCreate: mk(conversationCreate),
  validateMessagePost: mk(messagePost),
  validateReason: mk(reasonBody),
  validateTeach: mk(teachBody),
  validateFeedback: mk(feedbackBody),
};
