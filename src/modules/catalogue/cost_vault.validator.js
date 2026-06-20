/**
 * Cost Vault (V2.2 §6.24 P0-1) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const costSet = z
  .object({
    cost_ngn: z.coerce.number().nonnegative().optional(),
    cost_native: z
      .object({
        amount: z.coerce.number().nonnegative(),
        currency: z.string().min(3).max(3),
      })
      .strict()
      .optional(),
    supplier_id: z.string().uuid().nullable().optional(),
    cost_source: z.enum(["manual", "production", "grn", "import"]).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.cost_ngn !== undefined || v.cost_native || v.supplier_id !== undefined,
    {
      message: "Provide at least one of cost_ngn, cost_native, or supplier_id.",
    },
  );

const grantCreate = z
  .object({
    user_id: z.string().uuid(),
    business: z.string().min(1).max(63).optional(), // defaults to active brand
  })
  .strict();

const grantRevoke = z
  .object({
    reason: z.string().max(500).optional(),
  })
  .strict();

const mw = (s) => (req, _res, next) => {
  req.body = s.parse(req.body ?? {});
  next();
};

module.exports = {
  validateCostSet: mw(costSet),
  validateGrantCreate: mw(grantCreate),
  validateGrantRevoke: mw(grantRevoke),
};
