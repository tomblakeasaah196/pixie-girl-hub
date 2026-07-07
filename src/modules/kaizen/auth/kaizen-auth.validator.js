/**
 * Kaizen auth input schemas (Zod). ZodErrors are translated by the central
 * error-handler into 400s with field-level detail.
 */

"use strict";

const { z } = require("zod");

// Min 8 chars, at least one uppercase and one digit — same policy as the
// platform admin bootstrap (scripts/create-admin.js).
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/\d/, "Password must include a number");

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: password,
});

const acceptInviteSchema = z.object({
  token: z.string().min(10),
  password,
});

module.exports = { loginSchema, changePasswordSchema, acceptInviteSchema };
