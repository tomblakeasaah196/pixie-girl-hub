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
const paymentSettings = require("./payment-settings.service");
const { VALID } = require("../../config/brands");

const router = express.Router();

// Checkout-safe Flexi Pay config for a brand+channel (plan name, terms,
// minimums, availability). Declared BEFORE /:token so "config" never
// resolves as a token. Campaign availability additionally depends on the
// campaign's own allow_instalments toggle — the campaign checkout validates
// that server-side at order creation.
router.get("/config/:brand", async (req, res, next) => {
  try {
    const brand = String(req.params.brand || "").toLowerCase();
    if (!VALID.has(brand)) {
      return res
        .status(404)
        .json({ error: { code: "NOT_FOUND", message: "Unknown brand" } });
    }
    const channel = String(req.query.channel || "storefront");
    res.json({ data: await paymentSettings.publicConfig({ brand, channel }) });
  } catch (err) {
    next(err);
  }
});

router.get("/:token", async (req, res, next) => {
  try {
    res.json({
      data: await service.previewByToken({ token: req.params.token }),
    });
  } catch (err) {
    next(err);
  }
});

// `currency` is still accepted (the landing pay page sends the order's own
// currency) but never honoured: the order is paid in its locked currency. A
// buyer choosing it was how a Naira order became a $1 USD checkout.
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
    });
    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
