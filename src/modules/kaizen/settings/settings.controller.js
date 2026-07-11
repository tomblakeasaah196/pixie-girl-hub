/**
 * Kaizen settings controller. Mounted (behind operator auth) at
 * /api/v1/kaizen/settings.
 */

"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./settings.service");

const router = express.Router();

const updateSchema = z.object({
  retention: z
    .object({
      daily: z.number().int().nonnegative(),
      weekly: z.number().int().nonnegative(),
      monthly: z.number().int().nonnegative(),
    })
    .optional(),
  alert_recipients: z.array(z.string().email()).nullable().optional(),
});

router.get("/", async (_req, res) => {
  res.json({ data: await service.getPublic() });
});

router.patch("/", async (req, res) => {
  const input = updateSchema.parse(req.body);
  const data = await service.update({
    input,
    operatorId: req.operator.operator_id,
    ip: req.ip,
  });
  res.json({ data });
});

module.exports = { router };
