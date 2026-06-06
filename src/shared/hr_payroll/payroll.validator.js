/**
 * Payroll operations validators (V2.2 §6.11) — Pass 2 (Zod).
 */

"use strict";

const { z } = require("zod");
const uuid = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const money = z.number();

const SALE_CHANNELS = [
  "instagram", "website", "whatsapp", "walk_in", "pos",
  "facebook", "tiktok", "phone", "event", "partner", "other",
];
const BONUS_TYPES = [
  "customer_rating", "quarterly_performance", "recognition", "milestone",
  "referral_bonus", "sales_target", "service_quality", "custom",
];

const runCreateSchema = z.object({
  pay_month: z.number().int().min(1).max(12),
  pay_year: z.number().int().min(2000).max(2100),
  pay_date: dateStr,
  period_start: dateStr,
  period_end: dateStr,
  fiscal_period_id: uuid.nullable().optional(),
  notes: z.string().max(1000).optional(),
});

const commissionAccrueSchema = z.object({
  user_id: uuid,
  sale_channel: z.enum(SALE_CHANNELS),
  basis_amount_ngn: money,
  commission_amount_ngn: money,
  order_id: uuid.nullable().optional(),
  order_line_id: uuid.nullable().optional(),
  invoice_id: uuid.nullable().optional(),
  commission_rule_id: uuid.nullable().optional(),
  rate_pct: z.number().min(0).max(1).nullable().optional(),
  rate_fixed_ngn: money.nullable().optional(),
  reverses_earning_id: uuid.nullable().optional(),
});

const bonusAwardSchema = z.object({
  user_id: uuid,
  bonus_type: z.enum(BONUS_TYPES),
  amount_ngn: z.number().positive(),
  reason: z.string().min(1).max(1000),
  bonus_rule_id: uuid.nullable().optional(),
  performance_cycle_id: uuid.nullable().optional(),
  performance_review_id: uuid.nullable().optional(),
});

const bonusDecideSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(1000).optional(),
});

function make(schema) {
  return (req, _res, next) => { req.body = schema.parse(req.body || {}); next(); };
}

module.exports = {
  runCreate: make(runCreateSchema),
  commissionAccrue: make(commissionAccrueSchema),
  bonusAward: make(bonusAwardSchema),
  bonusDecide: make(bonusDecideSchema),
  schemas: { runCreateSchema, bonusAwardSchema, commissionAccrueSchema },
};
