/**
 * Calendar (V2.2 §6.18) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const EVENT_TYPE = [
  "meeting",
  "call",
  "delivery",
  "pickup",
  "fitting",
  "photoshoot",
  "training",
  "review",
  "reminder",
  "task_deadline",
  "viewing",
  "follow_up",
  "leave",
  "appointment",
  "service_booking",
  "production_milestone",
  "stylist_appointment",
  "other",
];

const participant = z
  .object({
    user_id: z.string().uuid().optional(),
    contact_id: z.string().uuid().optional(),
    status: z.enum(["invited", "accepted", "declined", "tentative"]).optional(),
    is_organiser: z.boolean().optional(),
  })
  .strict();

const resource = z
  .object({
    resource_type: z.string().min(1).max(40),
    resource_name: z.string().min(1).max(160),
    quantity: z.coerce.number().int().positive().optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

const eventCreate = z
  .object({
    title: z.string().min(1).max(200),
    event_type: z.enum(EVENT_TYPE),
    start_at: z.string().datetime({ offset: true }),
    end_at: z.string().datetime({ offset: true }),
    all_day: z.boolean().optional(),
    location: z.string().max(300).optional(),
    description: z.string().max(2000).optional(),
    recurrence_rule: z.string().max(500).optional(),
    reference_type: z.string().max(40).optional(),
    reference_id: z.string().uuid().optional(),
    is_private: z.boolean().optional(),
    participants: z.array(participant).optional(),
    resources: z.array(resource).optional(),
    force: z.boolean().optional(),
  })
  .strict()
  .refine((d) => new Date(d.end_at) >= new Date(d.start_at), {
    message: "end_at must be >= start_at",
    path: ["end_at"],
  });

const eventUpdate = z
  .object({
    title: z.string().min(1).max(200).optional(),
    event_type: z.enum(EVENT_TYPE).optional(),
    start_at: z.string().datetime({ offset: true }).optional(),
    end_at: z.string().datetime({ offset: true }).optional(),
    all_day: z.boolean().optional(),
    location: z.string().max(300).optional(),
    description: z.string().max(2000).optional(),
    recurrence_rule: z.string().max(500).optional(),
    is_private: z.boolean().optional(),
  })
  .strict()
  .refine(
    (d) => {
      if (d.start_at && d.end_at) {
        return new Date(d.end_at) >= new Date(d.start_at);
      }
      return true;
    },
    { message: "end_at must be >= start_at", path: ["end_at"] },
  );

const participantResponse = z
  .object({ status: z.enum(["invited", "accepted", "declined", "tentative"]) })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateEventCreate: mk(eventCreate),
  validateEventUpdate: mk(eventUpdate),
  validateParticipantAdd: mk(participant),
  validateParticipantResponse: mk(participantResponse),
};
