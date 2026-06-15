/**
 * Cash Request & Disbursement (V2.2 §6.32). Mounted at /api/v1/cash-requests.
 * Permission key: expenses (Cash Request is the §6.7 companion flow).
 *
 * Workflow: create(draft) → submit → finance-decision → [ceo-decision] →
 * disburse (mandatory bank_transaction_id) → settle (advances). Cancel is
 * allowed at any pre-disbursement state.
 *
 * Backing tables (shared): cash_requests, cash_request_state_history.
 */

"use strict";

const express = require("express");
const controller = require("./cash-request.controller");
const validator = require("./cash-request.validator");
const { requirePermission } = require("../../middleware/rbac");

require("./cash-request.subscribers");

const router = express.Router();
const can = (action) => requirePermission("expenses", action);

router.get("/", can("view"), controller.list);
router.get("/kpis/summary", can("view"), controller.kpis);
router.post("/", can("create"), validator.validateCreate, controller.create);
router.get("/:id", can("view"), controller.getById);

router.post("/:id/submit", can("edit"), controller.submit);
router.post(
  "/:id/finance-decision",
  can("approve"),
  validator.validateDecision,
  controller.financeDecision,
);
router.post(
  "/:id/ceo-decision",
  can("approve"),
  validator.validateDecision,
  controller.ceoDecision,
);
router.post(
  "/:id/disburse",
  can("approve"),
  validator.validateDisburse,
  controller.disburse,
);
router.post(
  "/:id/settle",
  can("edit"),
  validator.validateSettle,
  controller.settle,
);
router.post(
  "/:id/cancel",
  can("edit"),
  validator.validateCancel,
  controller.cancel,
);

// Documents (linked via shared.cash_request_documents)
router.post(
  "/:id/documents",
  can("edit"),
  validator.validateDocument,
  controller.addDocument,
);
router.get("/:id/documents", can("view"), controller.listDocuments);

// State history timeline
router.get("/:id/history", can("view"), controller.getHistory);

module.exports = router;
