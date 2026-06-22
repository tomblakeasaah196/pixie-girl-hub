/**
 * HR operations validators (HR Phase 1).
 * Zod schemas for leave, queries, targets, settings and reconcile. `business`
 * is always brand context, never the body.
 */

"use strict";

const { z } = require("zod");

const uuid = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const timeStr = z.string().regex(/^\d{1,2}:\d{2}$/, "expected HH:MM");

const leaveRequestSchema = z.object({
  profile_id: uuid.optional(),
  leave_type: z.enum([
    "annual", "sick", "maternity", "paternity", "compassionate",
    "bereavement", "unpaid", "special_event_in_lieu", "public_holiday",
  ]),
  start_date: dateStr,
  end_date: dateStr,
  days_requested: z.number().int().min(1).max(365),
  reason: z.string().max(2000).optional(),
});

const leaveRejectSchema = z.object({
  rejection_reason: z.string().max(2000).optional(),
});

const queryRaiseSchema = z.object({
  profile_id: uuid,
  query_type: z.enum([
    "lateness", "absence", "offsite_clockin", "conduct", "performance", "other",
  ]).optional(),
  severity: z.enum(["low", "normal", "high"]).optional(),
  subject: z.string().min(1).max(200),
  details: z.string().max(5000).optional(),
});

const queryRespondSchema = z.object({
  response: z.string().min(1).max(5000),
});

const queryResolveSchema = z.object({
  resolution: z.enum(["waived", "upheld"]),
  note: z.string().max(2000).optional(),
});

const targetCreateSchema = z.object({
  profile_id: uuid,
  user_id: uuid.optional(),
  period_month: z.number().int().min(1).max(12),
  period_year: z.number().int().min(2024).max(2100),
  metric: z.enum([
    "styles_completed", "services_completed", "sales_count", "sales_revenue", "custom",
  ]).optional(),
  metric_label: z.string().min(1).max(120),
  target_value: z.number().positive(),
  source: z.enum(["operations", "sales", "manual"]).optional(),
  reward_type: z.enum(["pct_salary", "fixed_ngn", "none"]).optional(),
  reward_value: z.number().nonnegative().optional(),
  reward_note: z.string().max(500).optional(),
  bonus_rule_id: uuid.optional(),
});

const targetProgressSchema = z.object({
  current_value: z.number().nonnegative(),
});

const settingsUpdateSchema = z
  .object({
    lateness_enabled: z.boolean().optional(),
    lateness_tiers: z
      .array(z.object({
        after_minutes: z.number().int().min(1),
        deduction_pct: z.number().min(0).max(100),
      }))
      .max(20)
      .optional(),
    lateness_auto_query: z.boolean().optional(),
    lateness_query_reminder_days: z.number().int().min(0).max(30).optional(),
    default_grace_minutes: z.number().int().min(0).max(240).optional(),
    default_expected_start_time: timeStr.nullable().optional(),
    working_days: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])).max(7).optional(),
    earnings_tracker_enabled: z.boolean().optional(),
    geofence_enabled: z.boolean().optional(),
    geofence_required_on_site: z.boolean().optional(),
    geofence_accuracy_max_m: z.number().int().min(10).max(2000).optional(),
    offsite_auto_query: z.boolean().optional(),
    offsite_marks_absent: z.boolean().optional(),
    payout_require_pin: z.boolean().optional(),
    payout_provider: z.enum(["nomba", "flutterwave", "manual"]).optional(),
    onboarding_checklist: z
      .array(z.object({ key: z.string().max(60), label: z.string().max(200) }))
      .max(50)
      .optional(),
    contract_template_doc_id: uuid.nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "No fields to update");

const payoutPinSchema = z.object({
  pin: z.string().regex(/^\d{4,8}$/, "PIN must be 4–8 digits"),
});

const reconcileSchema = z.object({
  date: dateStr.optional(),
});

const clockSchema = z.object({
  event_type: z.enum(["clock_in", "clock_out"]),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  accuracy_m: z.number().nonnegative().nullable().optional(),
  address: z.string().max(500).optional(),
  device_fingerprint: z.string().max(200).optional(),
});

function make(schema) {
  return (req, _res, next) => {
    req.body = schema.parse(req.body || {});
    next();
  };
}

module.exports = {
  leaveRequest: make(leaveRequestSchema),
  leaveReject: make(leaveRejectSchema),
  queryRaise: make(queryRaiseSchema),
  queryRespond: make(queryRespondSchema),
  queryResolve: make(queryResolveSchema),
  targetCreate: make(targetCreateSchema),
  targetProgress: make(targetProgressSchema),
  settingsUpdate: make(settingsUpdateSchema),
  payoutPin: make(payoutPinSchema),
  reconcile: make(reconcileSchema),
  clock: make(clockSchema),
};
