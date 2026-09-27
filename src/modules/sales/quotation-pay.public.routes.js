/**
 * Public tokenised quotation pay-link (000090). No login: the customer opens a
 * link tied to their quotation's public_pay_token, sees what the quote comes to,
 * and pays it.
 *
 * The quotation itself never holds money. The gateway checkout carries
 * metadata.quotation_id, and the inbound webhook converts the quote into a
 * sales order at the moment of confirmation — then records the payment against
 * that new order through the ordinary order rail. So nothing is written here;
 * as with the order pay-link, payment lands only on webhook confirmation.
 *
 * Mounted at /api/public/quote with the public-write throttle.
 */

"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./payment-link.service");

const router = express.Router();

router.get("/:token", async (req, res, next) => {
  try {
    res.json({
      data: await service.previewQuotationByToken({ token: req.params.token }),
    });
  } catch (err) {
    next(err);
  }
});

// No amount: a quote is paid in full or not at all. There is no order yet, so
// there is no balance to part-pay and no Flexi Pay plan to apply — a deposit
// sale is accepted-and-converted first, then part-paid on the order's own link.
//
// `currency` is still accepted (older pages send it) but never honoured: the
// quote is paid in its own currency. Only staff may switch a currency.
const bodySchema = z
  .object({ currency: z.string().length(3).optional() })
  .strict();

router.post("/:token", async (req, res, next) => {
  try {
    bodySchema.parse(req.body || {});
    const data = await service.createPublicQuotationPaymentLink({
      token: req.params.token,
    });
    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
