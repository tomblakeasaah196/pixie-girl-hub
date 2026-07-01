/**
 * Customer assets (Stylist Studio §6.24) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const checkIn = z
  .object({
    owner_contact_id: z.string().uuid(),
    intake_photo_doc_id: z.string().uuid().optional(),
    condition_note: z.string().max(1000).optional(),
    service_job_id: z.string().uuid().optional(),
  })
  .strict();

const checkOut = z
  .object({ status: z.enum(["returned_to_owner", "lost"]).optional() })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCheckIn: mk(checkIn),
  validateCheckOut: mk(checkOut),
};
