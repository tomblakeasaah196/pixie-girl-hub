/**
 * Sales (V2.2 §6.2) — routes. Mounted at /api/v1/sales. Permission key: sales.
 */

"use strict";

const express = require("express");
const c = require("./sales.controller");
const v = require("./sales.validator");
const vSettings = require("./payment-settings.validator");
const timelineController = require("./timeline.controller");
const { requirePermission } = require("../../middleware/rbac");
// `order.stock_shortfall` is an in-process event and markPaid runs HERE (API
// payments + gateway webhooks), so the subscriber has to be registered in the
// web process, not only in the worker. register() is idempotent.
require("./stock-shortfall.subscribers");

const router = express.Router();
const can = (a) => requirePermission("sales", a);

// Flexi Pay settings (D2/D16) — the Sales → Payments tab. Gated at the
// manager tier (sales.approve): the RBAC action vocabulary is a fixed
// 6-action set (schema CHECK), so a bespoke action was consciously avoided.
router.get("/payment-settings", can("view"), c.getPaymentSettings);
router.put(
  "/payment-settings",
  can("approve"),
  vSettings.validateSettingsPatch,
  c.updatePaymentSettings,
);

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
// Impact-modal live state: on/off of the messages a manual move fires.
// Declared before "/orders/:id" so the literal path isn't shadowed by :id.
router.get("/orders/status-automations", can("view"), c.getStatusAutomations);
router.get("/orders/:id", can("view"), c.getById);
// The order's Stylist Studio job — order-scoped, gated by sales.view (NOT the
// service_jobs module's stylist own-scope), so seeing the order is enough to
// see its studio progress.
router.get("/orders/:id/service-job", can("view"), c.getOrderServiceJob);
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
// Un-cancel from the Orders archive. Body { confirm: true } commits when the
// dry run reported lines that can no longer be re-held.
router.post(
  "/orders/:id/restore",
  can("edit"),
  v.validateOrderRestore,
  c.restoreOrder,
);
// Change Order (§6.2 amendments) — swap the products on an order that was
// already placed (and possibly paid), correct its quantities, its prices or
// its delivery details, and reconcile stock, the GL, the invoice, Stylist
// Studio and Logistics in one transaction. See docs/ORDER_AMENDMENTS.md.
//
// Gated at sales.edit, the same tier as Cancel: cancelling an order is the
// strictly more destructive act, so a repair must not be harder to reach than
// a write-off. The service refuses outright once the order is completed,
// cancelled, refunded or has a cancellation pending review.
router.get("/orders/:id/amendments", can("view"), c.listAmendments);
router.post(
  "/orders/:id/amendment/preview",
  can("edit"),
  v.validateOrderAmendPreview,
  c.previewAmendment,
);
router.post(
  "/orders/:id/amendment",
  can("edit"),
  v.validateOrderAmend,
  c.amendOrder,
);

router.post(
  "/orders/:id/status",
  can("edit"),
  v.validateOrderStatusSet,
  c.setOrderStatus,
);
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
router.post(
  "/quotations/:quoId/accept",
  can("edit"),
  v.validateQuotationAccept,
  c.acceptQuotation,
);
// Customer-facing pay link for a quote (000090): mints the public token and
// returns the /quote/:token URL to paste into WhatsApp/email. Paying it
// converts the quote to an order at confirmation.
router.get("/quotations/:quoId/pay-link", can("view"), c.getQuotationPayLink);
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
