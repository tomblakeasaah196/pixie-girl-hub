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

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateConversationCreate: mk(conversationCreate),
  validateMessagePost: mk(messagePost),
  validateReason: mk(reason),
  schemas: { conversationCreate, messagePost, reason },
};
