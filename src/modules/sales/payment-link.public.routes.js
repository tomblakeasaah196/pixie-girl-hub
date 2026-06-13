/**
 * Public tokenised pay-link (C follow-up / PD §6.2). No login: the customer
 * opens a link tied to their order's public_tracking_token, sees what's owed,
 * and pays (any amount). Mounted at /api/public/pay with the public-write
 * throttle. Payment is recorded only when the gateway webhook confirms.
 */

"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./payment-link.service");

const router = express.Router();

router.get("/:token", async (req, res, next) => {
  try {
    res.json({
      data: await service.previewByToken({ token: req.params.token }),
    });
  } catch (err) {
    next(err);
  }
});

const bodySchema = z
  .object({
    amount_ngn: z.coerce.number().positive().optional(),
    currency: z.string().length(3).optional(),
  })
  .strict();

router.post("/:token", async (req, res, next) => {
  try {
    const input = bodySchema.parse(req.body || {});
    const data = await service.createPublicPaymentLink({
      token: req.params.token,
      amount_ngn: input.amount_ngn,
      currency: input.currency,
    });
    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
