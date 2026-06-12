/**
 * Order timeline (F-5 / PD §6.23.6) — staff controller. Authenticated; uses
 * req.brand. Lets staff record a manual lifecycle event and view the full
 * (internal) timeline for an order.
 */

"use strict";

const { z } = require("zod");
const timeline = require("./timeline.service");

const recordSchema = z
  .object({
    event_code: z.string().min(1).max(60),
    label: z.string().max(200).optional(),
    customer_payload: z.record(z.any()).optional(),
    internal_payload: z.record(z.any()).optional(),
    is_customer_visible: z.boolean().optional(),
    occurred_at: z.string().datetime().optional(),
    once_only: z.boolean().optional(),
  })
  .strict();

async function list(req, res) {
  res.json({
    data: await timeline.listForOrder({
      brand: req.brand,
      sales_order_id: req.params.id,
    }),
  });
}

async function record(req, res) {
  const body = recordSchema.parse(req.body || {});
  res.status(201).json({
    data: await timeline.record({
      brand: req.brand,
      sales_order_id: req.params.id,
      source_module: "manual",
      recorded_by: req.user.user_id,
      ...body,
    }),
  });
}

module.exports = { list, record };
