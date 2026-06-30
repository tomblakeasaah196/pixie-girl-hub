/**
 * Public invoice view (V2.2 §6.5). No auth — the link is embedded in the
 * customer's invoice email / WhatsApp. The invoice id is a UUIDv4, so the URL
 * is unguessable; opening it stamps first_viewed_at ("she received it").
 *   GET /api/public/invoices/:brand/:id/view
 */

"use strict";

const express = require("express");
const controller = require("./invoicing.controller");

const router = express.Router();

router.get("/:brand/:id/view", controller.viewPublicInvoice);

const receiptRouter = express.Router();
receiptRouter.get("/:brand/:id/view", controller.viewPublicReceipt);

module.exports = router;
module.exports.receiptRouter = receiptRouter;
