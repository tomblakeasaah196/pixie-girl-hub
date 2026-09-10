/**
 * Flexi Pay settings (Sales → Payments) — Zod validator for the admin PUT.
 * Every field optional: the endpoint is a patch. Unknown keys rejected so the
 * config JSON can't accumulate junk.
 */

"use strict";

const { z } = require("zod");

const settingsPatch = z
  .object({
    plan_display_name: z.string().min(1).max(60).optional(),
    plan_terms: z.array(z.string().min(1).max(300)).min(1).max(10).optional(),
    min_first_payment_pct: z.coerce.number().min(0).max(100).optional(),
    min_topup_ngn: z.coerce.number().min(0).optional(),
    custom_order_deposit_pct: z.coerce.number().min(0).max(100).optional(),
    layaway_abandonment_days: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .optional(),
    layaway_reminder_cadence_days: z.coerce
      .number()
      .int()
      .min(1)
      .max(90)
      .optional(),
    auto_cancel_after_no_payment: z.boolean().optional(),
    abandoned_checkout_nudge_enabled: z.boolean().optional(),
    abandoned_checkout_nudge_hours: z.coerce
      .number()
      .min(0)
      .max(168)
      .optional(),
    // Floor of 24h is a CEO decision (owner session 2026-09-10): a self-serve
    // buyer always gets at least one overnight to pay. A 12-hour window set
    // here once killed a ₦577,200 storefront order at 03:30 the same night.
    abandoned_checkout_expiry_hours: z.coerce
      .number()
      .min(24)
      .max(720)
      .optional(),
    milestone_messages_enabled: z.boolean().optional(),
    channels: z
      .record(
        z.enum([
          "storefront",
          "public_form",
          "whatsapp",
          "instagram",
          "walk_in",
          "event",
          "sales_campaign",
        ]),
        z.boolean(),
      )
      .optional(),
    allow_staff_recorded_manual_payments: z.boolean().optional(),
  })
  .strict();

const mw = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

module.exports = {
  settingsPatch,
  validateSettingsPatch: mw(settingsPatch),
};
