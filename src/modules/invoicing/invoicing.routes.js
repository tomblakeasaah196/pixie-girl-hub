/**
 * Invoicing & Billing (V2.2 §6.5) — routes. Mounted at /api/v1/invoicing.
 * Permission key: invoicing.
 */

"use strict";

const express = require("express");
const controller = require("./invoicing.controller");
const validator = require("./invoicing.validator");
const { requirePermission } = require("../../middleware/rbac");

// Side-effect: register the sales.order.paid → auto-invoice subscriber.
require("./invoicing.subscribers");

const router = express.Router();
const can = (action) => requirePermission("invoicing", action);

// Settings tab — editable copy for invoice/receipt PDFs + their mail (per brand).
router.get("/settings", can("view"), controller.getDocumentSettings);
router.put(
  "/settings",
  can("edit"),
  validator.validateDocumentSettings,
  controller.updateDocumentSettings,
);

router.get("/invoices", can("view"), controller.listInvoices);
router.post(
  "/invoices",
  can("create"),
  validator.validateInvoiceCreate,
  controller.createInvoice,
);
router.get("/invoices/:id", can("view"), controller.getById);
router.post("/invoices/:id/pdf", can("view"), controller.invoicePdf);
router.post(
  "/invoices/:id/send",
  can("edit"),
  validator.validateInvoiceSend,
  controller.sendInvoice,
);
router.post(
  "/invoices/:id/payments",
  can("edit"),
  validator.validatePaymentApply,
  controller.recordPayment,
);
router.post("/invoices/:id/void", can("delete"), controller.voidInvoice);
router.get("/invoices/:id/receipts", can("view"), controller.listReceipts);
router.get("/invoices/:id/delivery", can("view"), controller.getDelivery);

// Credit notes
router.get("/credit-notes", can("view"), controller.listCreditNotes);
router.post(
  "/credit-notes",
  can("create"),
  validator.validateCreditNoteCreate,
  controller.createCreditNote,
);
router.get("/credit-notes/:cnId", can("view"), controller.getCreditNote);
router.post(
  "/credit-notes/:cnId/issue",
  can("approve"),
  controller.issueCreditNote,
);

// Receipts
router.post(
  "/receipts",
  can("create"),
  validator.validateReceiptIssue,
  controller.issueReceipt,
);

// Reminders (F-10)
router.get("/invoices/:id/reminders", can("view"), controller.listReminders);
router.delete(
  "/invoices/:id/reminders/:reminderId",
  can("edit"),
  controller.cancelReminder,
);

module.exports = router;
