/**
 * HR & Payroll validators (V2.2 §6.11) — Pass 1.
 * Zod schemas for employees + the five Tier-1 config tables. `business` is
 * never taken from the body (it comes from brand context).
 */

"use strict";

const { z } = require("zod");

const uuid = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const money = z.number().nonnegative();
const snake = (label) =>
  z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9_]+$/, `${label} must be snake_case`);

// ── Employees ──────────────────────────────────────────────
const SALE_CHANNELS = [
  "instagram",
  "website",
  "whatsapp",
  "walk_in",
  "pos",
  "facebook",
  "tiktok",
  "phone",
  "event",
  "partner",
  "other",
];

const staffCreateSchema = z.object({
  contact_id: uuid,
  employee_number: z.string().min(1).max(40),
  job_title: z.string().min(1).max(120),
  employment_type: z.enum(["full_time", "part_time", "contract", "intern"]),
  start_date: dateStr,
  department: z.string().max(120).optional(),
  end_date: dateStr.nullable().optional(),
  reports_to: uuid.nullable().optional(),
  bank_name: z.string().max(120).optional(),
  bank_account_number: z.string().max(40).optional(),
  bank_sort_code: z.string().max(40).optional(),
  nin: z.string().max(40).optional(),
  bvn: z.string().max(40).optional(),
  base_salary: money.optional(),
  pension_pin: z.string().max(40).optional(),
  nhf_number: z.string().max(40).optional(),
  tax_id: z.string().max(40).optional(),
  probation_status: z
    .enum([
      "not_applicable",
      "pending",
      "active",
      "passed",
      "failed",
      "extended",
    ])
    .optional(),
  probation_start_date: dateStr.nullable().optional(),
  probation_end_date: dateStr.nullable().optional(),
  annual_leave_days_entitled: z.number().int().min(0).max(365).optional(),
  annual_leave_days_remaining: z.number().min(0).max(365).optional(),
  non_solicit_months: z.number().int().min(0).max(60).optional(),
  dismissal_triggers_log: z.array(z.string().max(200)).max(200).optional(),
  // Work schedule (set at onboarding, editable in HR).
  work_schedule: z
    .record(z.string(), z.enum(["on_site", "remote", "off"]))
    .optional(),
  work_expected_start_time: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Use HH:MM")
    .optional()
    .nullable(),
  work_grace_minutes: z.number().int().min(0).max(240).optional(),
});
const staffUpdateSchema = staffCreateSchema
  .omit({ contact_id: true, employee_number: true })
  .partial()
  .refine((o) => Object.keys(o).length > 0, "No fields to update");

// ── commission_rules ───────────────────────────────────────
const commissionRuleCreateSchema = z.object({
  rule_name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  applies_to_role_id: uuid.nullable().optional(),
  applies_to_user_id: uuid.nullable().optional(),
  category_id: uuid.nullable().optional(),
  product_id: uuid.nullable().optional(),
  variant_id: uuid.nullable().optional(),
  sales_channel: z.enum(SALE_CHANNELS).nullable().optional(),
  calculation_basis: z.enum([
    "gross_revenue",
    "net_revenue",
    "margin",
    "units",
  ]),
  rate_pct: z.number().min(0).max(1).optional(),
  rate_fixed_ngn: money.optional(),
  tiered_config: z.any().optional(),
  min_commission_ngn: money.optional(),
  max_commission_ngn: money.optional(),
  valid_from: dateStr.optional(),
  valid_to: dateStr.nullable().optional(),
  is_active: z.boolean().optional(),
  priority: z.number().int().min(0).max(32767).optional(),
});
const commissionRuleUpdateSchema = commissionRuleCreateSchema.partial();

// ── bonus_rules ────────────────────────────────────────────
const bonusRuleCreateSchema = z.object({
  rule_name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  bonus_type: z.enum([
    "customer_rating",
    "quarterly_performance",
    "recognition",
    "milestone",
    "referral_bonus",
    "sales_target",
    "service_quality",
    "custom",
  ]),
  amount_type: z.enum(["fixed_ngn", "pct_of_salary", "from_pool", "custom"]),
  amount_value: z.number().optional(),
  applies_to_role_ids: z.array(uuid).max(50).optional(),
  trigger_criteria: z.record(z.any()).optional(),
  is_auto_triggered: z.boolean().optional(),
  max_per_staff_per_year: z.number().int().min(0).max(365).optional(),
  is_active: z.boolean().optional(),
  valid_from: dateStr.optional(),
  valid_to: dateStr.nullable().optional(),
});
const bonusRuleUpdateSchema = bonusRuleCreateSchema.partial();

// ── performance_kpi_definitions ────────────────────────────
const kpiDefCreateSchema = z.object({
  kpi_key: snake("kpi_key"),
  display_name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  weight_pct: z.number().min(0).max(100),
  score_source: z
    .enum([
      "manual",
      "customer_ratings",
      "sales_data",
      "crm_data",
      "service_job_ratings",
      "clock_in_data",
      "custom",
    ])
    .optional(),
  auto_score_config: z.record(z.any()).optional(),
  min_score: z.number().optional(),
  max_score: z.number().optional(),
  applies_to_role_ids: z.array(uuid).max(50).optional(),
  display_order: z.number().int().min(0).max(32767).optional(),
  is_active: z.boolean().optional(),
});
const kpiDefUpdateSchema = kpiDefCreateSchema.partial();

// ── performance_cycles ─────────────────────────────────────
const cycleCreateSchema = z.object({
  cycle_name: z.string().min(1).max(120),
  cycle_type: z
    .enum(["monthly", "quarterly", "semi_annual", "annual", "ad_hoc"])
    .optional(),
  starts_on: dateStr,
  ends_on: dateStr,
  status: z
    .enum(["upcoming", "open", "scoring", "calibration", "closed", "archived"])
    .optional(),
  scoring_opens_at: dateStr.nullable().optional(),
  scoring_closes_at: dateStr.nullable().optional(),
  bonus_pool_ngn: money.nullable().optional(),
  notes: z.string().max(1000).optional(),
});
const cycleUpdateSchema = cycleCreateSchema.partial();

// ── payroll_deductions ─────────────────────────────────────
const deductionCreateSchema = z.object({
  deduction_type: z.enum([
    "paye",
    "pension_employee",
    "pension_employer",
    "nhf",
    "nsitf",
    "other",
  ]),
  effective_from: dateStr,
  effective_to: dateStr.nullable().optional(),
  rate_pct: z.number().min(0).max(1).optional(),
  bands: z.array(z.record(z.any())).optional(),
  consolidated_relief_ngn: money.optional(),
  consolidated_relief_pct: z.number().min(0).max(1).optional(),
  min_taxable_ngn: money.optional(),
  max_taxable_ngn: money.optional(),
  is_active: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});
const deductionUpdateSchema = deductionCreateSchema.partial();

// ── Performance appraisal scoring + reviews (F-8) ──────────
const SCORE_SOURCES = [
  "manual",
  "customer_ratings",
  "sales_data",
  "crm_data",
  "service_job_ratings",
  "clock_in_data",
  "custom",
];
const appraisalScoreSchema = z.object({
  user_id: uuid,
  scores: z
    .array(
      z.object({
        kpi_id: uuid,
        raw_score: z.coerce.number(),
        comments: z.string().max(2000).optional(),
        score_source: z.enum(SCORE_SOURCES).optional(),
        evidence: z.record(z.any()).optional(),
      }),
    )
    .min(1),
});
const reviewGenerateSchema = z.object({ user_id: uuid });
const reviewContentSchema = z
  .object({
    strengths: z.string().max(5000).optional(),
    improvement_areas: z.string().max(5000).optional(),
    development_goals: z.string().max(5000).optional(),
    manager_comments: z.string().max(5000).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, "No fields to update");
const reviewAdvanceSchema = z.object({
  status: z.enum([
    "draft",
    "submitted",
    "reviewed",
    "approved",
    "finalised",
    "disputed",
  ]),
});
const reviewAcknowledgeSchema = z.object({
  agreed: z.boolean().optional(),
  employee_response: z.string().max(5000).optional(),
  employee_disagreement: z.string().max(5000).optional(),
});

function make(schema) {
  return (req, _res, next) => {
    req.body = schema.parse(req.body || {});
    next();
  };
}

module.exports = {
  staff: { create: make(staffCreateSchema), update: make(staffUpdateSchema) },
  commissionRule: {
    create: make(commissionRuleCreateSchema),
    update: make(commissionRuleUpdateSchema),
  },
  bonusRule: {
    create: make(bonusRuleCreateSchema),
    update: make(bonusRuleUpdateSchema),
  },
  kpiDef: {
    create: make(kpiDefCreateSchema),
    update: make(kpiDefUpdateSchema),
  },
  cycle: { create: make(cycleCreateSchema), update: make(cycleUpdateSchema) },
  deduction: {
    create: make(deductionCreateSchema),
    update: make(deductionUpdateSchema),
  },
  appraisal: {
    score: make(appraisalScoreSchema),
    reviewGenerate: make(reviewGenerateSchema),
    reviewContent: make(reviewContentSchema),
    reviewAdvance: make(reviewAdvanceSchema),
    reviewAcknowledge: make(reviewAcknowledgeSchema),
  },
  schemas: {
    staffCreateSchema,
    kpiDefCreateSchema,
    commissionRuleCreateSchema,
  },
};
