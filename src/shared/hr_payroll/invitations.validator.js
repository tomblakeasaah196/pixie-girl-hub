/**
 * Staff invitations validators (F-15).
 */

"use strict";

const { z } = require("zod");

const uuid = z.string().uuid();

const createSchema = z
  .object({
    email: z.string().email(),
    display_name: z.string().max(160).optional(),
    role_ids: z.array(uuid).max(50).optional(),
    business_keys: z.array(z.string().min(1).max(60)).max(20).optional(),
    default_business: z.string().min(1).max(60).optional(),
    is_ceo: z.boolean().optional(),
    staff_profile_id: uuid.optional(),
    expires_in_days: z.coerce.number().int().min(1).max(30).optional(),
  })
  .strict()
  // Owner Q4: no permission-less accounts. A non-CEO invite must carry at
  // least one role (a CEO invite bypasses roles entirely).
  .refine((o) => o.is_ceo === true || (o.role_ids && o.role_ids.length > 0), {
    message: "Select at least one role for the new user",
    path: ["role_ids"],
  });

const acceptSchema = z
  .object({
    token: z.string().min(16).max(200),
    password: z.string().min(10).max(200),
    display_name: z.string().max(160).optional(),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validateCreate: mk(createSchema),
  validateAccept: mk(acceptSchema),
};
