/**
 * Sales (V2.2 §6.2) — routes. Mounted at /api/v1/sales. Permission key: sales.
 */

"use strict";

const express = require("express");
const c = require("./sales.controller");
const v = require("./sales.validator");
const timelineController = require("./timeline.controller");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (a) => requirePermission("sales", a);

// Sales Report export (§6.2) — styled .xlsx for a chosen period.
// Declared before "/orders/:id" so the literal path isn't shadowed.
router.get(
  "/reports/export",
  can("export"),
  v.validateReportExport,
  c.exportReport,
);

router.get("/orders", can("view"), c.listOrders);
router.post("/orders", can("create"), v.validateOrderCreate, c.createOrder);
router.get("/orders/:id", can("view"), c.getById);
router.post("/orders/:id/receipt", can("view"), c.receiptPdf);
router.patch("/orders/:id", can("edit"), v.validateOrderUpdate, c.updateOrder);

// Order timeline (F-5 / §6.23.6) — staff record + view
router.get("/orders/:id/timeline", can("view"), timelineController.list);
router.post("/orders/:id/timeline", can("edit"), timelineController.record);
router.post(
  "/orders/:id/payments",
  can("edit"),
  v.validatePaymentCreate,
  c.addPayment,
);
router.post(
  "/orders/:id/payment-link",
  can("edit"),
  v.validatePaymentLink,
  c.createPaymentLink,
);
router.post("/orders/:id/cancel", can("edit"), c.cancelOrder);
router.patch(
  "/orders/:id/delivery-fee",
  can("edit"),
  v.validateSetDeliveryFee,
  c.setDeliveryFee,
);

// Quotations
router.get("/quotations", can("view"), c.listQuotations);
router.post(
  "/quotations",
  can("create"),
  v.validateQuotationCreate,
  c.createQuotation,
);
router.get("/quotations/:quoId", can("view"), c.getQuotation);
router.post("/quotations/:quoId/pdf", can("view"), c.quotationPdf);
router.post(
  "/quotations/:quoId/send",
  can("edit"),
  v.validateQuotationSend,
  c.sendQuotation,
);
router.post("/quotations/:quoId/accept", can("edit"), c.acceptQuotation);
router.post(
  "/quotations/:quoId/reject",
  can("edit"),
  v.validateQuotationReject,
  c.rejectQuotation,
);
router.post(
  "/quotations/:quoId/convert",
  can("create"),
  v.validateQuotationConvert,
  c.convertQuotation,
);

// Cancellation requests (§6.4 cancellation timer)
router.post(
  "/orders/:id/cancellation",
  can("edit"),
  v.validateCancellationRequest,
  c.requestCancellation,
);
router.get("/cancellations", can("view"), c.listCancellations);
router.get("/cancellations/:reqId", can("view"), c.getCancellation);
router.post(
  "/cancellations/:reqId/approve",
  can("approve"),
  v.validateCancellationReview,
  c.approveCancellation,
);
router.post(
  "/cancellations/:reqId/reject",
  can("approve"),
  v.validateCancellationReview,
  c.rejectCancellation,
);

module.exports = router;
