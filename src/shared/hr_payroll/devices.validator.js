/**
 * Device-binding validators (migration 000304). Zod schemas for the
 * self-service enrol/remove endpoints. `profile`/`business` come from context,
 * never the body.
 */

"use strict";

const { z } = require("zod");

const enrollStartSchema = z.object({
  device_label: z.string().min(1).max(60),
  device_type: z
    .enum(["mobile", "laptop", "desktop", "tablet", "other"])
    .optional(),
  device_fingerprint: z.string().min(1).max(200),
});

const otpSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, "expected a 6-digit code"),
  device_id: z.string().uuid().optional(),
});

function make(schema) {
  return (req, _res, next) => {
    req.body = schema.parse(req.body || {});
    next();
  };
}

module.exports = {
  enrollStart: make(enrollStartSchema),
  otp: make(otpSchema),
};
