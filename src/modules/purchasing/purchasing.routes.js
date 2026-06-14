/**
 * Purchasing & Procurement (V2.2 §6.8) — routes. Mounted at /api/v1/purchasing.
 * Permission key: purchasing.
 *
 * Backing tables (per-brand): suppliers, supplier_contacts, supplier_products,
 * rfqs, rfq_lines, rfq_quotes, purchase_orders, po_lines, po_state_history,
 * goods_received_notes, grn_lines, supplier_invoices, supplier_invoice_lines,
 * supplier_invoice_matches.
 */

"use strict";

const express = require("express");
const controller = require("./purchasing.controller");
const validator = require("./purchasing.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("purchasing", action);

// ── Suppliers ────────────────────────────────────────────
router.get("/suppliers", can("view"), controller.listSuppliers);
router.post(
  "/suppliers",
  can("create"),
  validator.validateSupplierCreate,
  controller.createSupplier,
);
router.get("/suppliers/:supplierId", can("view"), controller.getSupplier);
router.patch(
  "/suppliers/:supplierId",
  can("edit"),
  validator.validateSupplierUpdate,
  controller.updateSupplier,
);
router.get(
  "/suppliers/:supplierId/contacts",
  can("view"),
  controller.listSupplierContacts,
);
router.post(
  "/suppliers/:supplierId/contacts",
  can("edit"),
  validator.validateSupplierContactAdd,
  controller.addSupplierContact,
);
router.delete(
  "/suppliers/:supplierId/contacts/:linkId",
  can("edit"),
  controller.removeSupplierContact,
);
router.get(
  "/suppliers/:supplierId/products",
  can("view"),
  controller.listSupplierProducts,
);
router.post(
  "/suppliers/:supplierId/products",
  can("edit"),
  validator.validateSupplierProductAdd,
  controller.addSupplierProduct,
);

// Supplier-product links (edited by their own id)
router.patch(
  "/supplier-products/:linkId",
  can("edit"),
  validator.validateSupplierProductUpdate,
  controller.updateSupplierProduct,
);
router.delete(
  "/supplier-products/:linkId",
  can("edit"),
  controller.removeSupplierProduct,
);

// ── RFQ ──────────────────────────────────────────────────
router.get("/rfqs", can("view"), controller.listRfqs);
router.post(
  "/rfqs",
  can("create"),
  validator.validateRfqCreate,
  controller.createRfq,
);
router.get("/rfqs/:rfqId", can("view"), controller.getRfq);
router.post("/rfqs/:rfqId/send", can("edit"), controller.sendRfq);
router.post(
  "/rfqs/:rfqId/quotes",
  can("edit"),
  validator.validateQuoteCreate,
  controller.recordQuote,
);
router.post(
  "/rfqs/:rfqId/award",
  can("approve"),
  validator.validateAward,
  controller.awardQuote,
);

// ── Purchase orders ──────────────────────────────────────
router.get("/purchase-orders", can("view"), controller.listPos);
router.post(
  "/purchase-orders",
  can("create"),
  validator.validatePoCreate,
  controller.createPo,
);
router.get("/purchase-orders/:poId", can("view"), controller.getPo);
router.post("/purchase-orders/:poId/pdf", can("view"), controller.poPdf);
router.post("/purchase-orders/:poId/submit", can("edit"), controller.submitPo);
router.post(
  "/purchase-orders/:poId/approve",
  can("approve"),
  controller.approvePo,
);
router.post(
  "/purchase-orders/:poId/advance",
  can("edit"),
  validator.validatePoAdvance,
  controller.advancePo,
);
router.post(
  "/purchase-orders/:poId/cancel",
  can("delete"),
  validator.validatePoCancel,
  controller.cancelPo,
);

// ── Goods received notes ─────────────────────────────────
router.get("/goods-received-notes", can("view"), controller.listGrns);
router.post(
  "/goods-received-notes",
  can("create"),
  validator.validateGrnCreate,
  controller.createGrn,
);
router.get("/goods-received-notes/:grnId", can("view"), controller.getGrn);
router.post(
  "/goods-received-notes/:grnId/post",
  can("edit"),
  controller.postGrn,
);

// ── Supplier invoices + three-way matching ───────────────
router.get("/supplier-invoices", can("view"), controller.listSupplierInvoices);
router.post(
  "/supplier-invoices",
  can("create"),
  validator.validateSupplierInvoiceCreate,
  controller.createSupplierInvoice,
);
router.get(
  "/supplier-invoices/:invoiceId",
  can("view"),
  controller.getSupplierInvoice,
);
router.post(
  "/supplier-invoices/:invoiceId/match",
  can("edit"),
  controller.matchSupplierInvoice,
);
router.post(
  "/supplier-invoices/:invoiceId/approve",
  can("approve"),
  validator.validateInvoiceApprove,
  controller.approveSupplierInvoice,
);
router.post(
  "/supplier-invoices/:invoiceId/pay",
  can("approve"),
  validator.validateInvoicePay,
  controller.paySupplierInvoice,
);
router.post(
  "/supplier-invoices/:invoiceId/void",
  can("delete"),
  validator.validateInvoiceVoid,
  controller.voidSupplierInvoice,
);

module.exports = router;
