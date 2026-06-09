/**
 * Customer Retention & Loyalty + Streak Stars + Hair Quiz (V2.2 §6.23) —
 * Zod validators.
 */

"use strict";

const { z } = require("zod");

const pointsSchema = z
  .object({
    points: z.coerce.number().int().positive(),
    notes: z.string().max(500).optional(),
  })
  .strict();

const adjustSchema = z
  .object({
    points: z.coerce.number().int(),
    notes: z.string().max(500).optional(),
  })
  .strict();

const awardStreakSchema = z
  .object({
    action_type: z.string().min(1).max(60),
    reference_type: z.string().max(60).optional(),
    reference_id: z.string().uuid().optional(),
    amount_ngn: z.coerce.number().nonnegative().optional(),
    description: z.string().max(500).optional(),
  })
  .strict();

const quizSubmitSchema = z
  .object({
    slug: z.string().max(120).optional(),
    storefront_session_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    visitor_email: z.string().email().optional(),
    visitor_first_name: z.string().max(120).optional(),
    visitor_phone: z.string().max(40).optional(),
    answers: z.record(z.any()).default({}),
    utm_source: z.string().max(80).optional(),
    utm_medium: z.string().max(80).optional(),
    utm_campaign: z.string().max(120).optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateRedeem: mk(pointsSchema),
  validateAdjust: mk(adjustSchema),
  validateAwardStreak: mk(awardStreakSchema),
  validateQuizSubmit: mk(quizSubmitSchema),
  pointsSchema,
  adjustSchema,
  awardStreakSchema,
  quizSubmitSchema,
};
