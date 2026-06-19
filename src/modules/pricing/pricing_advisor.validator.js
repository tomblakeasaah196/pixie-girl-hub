/**
 * Pricing advisor — Zod validators.
 */

"use strict";

const { z } = require("zod");

const money = z.coerce.number().nonnegative();
const channel = z
  .enum(["storefront", "pos", "wholesale", "partner", "intercompany"])
  .optional();

const recommend = z
  .object({
    variant_id: z.string().uuid(),
    channel,
    basis: z.enum(["margin", "markup", "price"]).optional(),
    target_value: z.coerce.number().optional(),
    cost_override_ngn: money.nullable().optional(),
    net_of_channel_fee: z.boolean().optional(),
  })
  .strict();

const apply = z
  .object({
    variant_id: z.string().uuid(),
    channel,
    new_price_ngn: money,
    reason: z.string().max(1000).optional(),
  })
  .strict();

const config = z
  .object({
    instant_apply_threshold_pct: z.coerce.number().min(0).max(1000).optional(),
    default_target_margin_pct: z.coerce.number().min(0).max(99.9).optional(),
    round_to_ngn: z.coerce.number().min(0).optional(),
    channel_fees: z
      .array(
        z.object({
          channel: z.string().min(1).max(40),
          label: z.string().max(60).optional(),
          pct: z.coerce.number().min(0).max(1),
          fixed_ngn: z.coerce.number().min(0),
        }),
      )
      .max(20)
      .optional(),
  })
  .strict();

const usd = z.object({ price_usd: money.nullable() }).strict();

const mk = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

module.exports = {
  validateRecommend: mk(recommend),
  validateApply: mk(apply),
  validateConfig: mk(config),
  validateUsd: mk(usd),
};
