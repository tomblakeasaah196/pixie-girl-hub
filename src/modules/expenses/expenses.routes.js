/**
 * Expense Management (V2.2 §6.7) — routes. Mounted at /api/v1/expenses.
 * Permission key: expenses.
 *
 * /advances/* is declared BEFORE the /:id expense routes so the literal
 * segment isn't captured by the :id param.
 */

"use strict";

const express = require("express");
const multer = require("multer");
const controller = require("./expenses.controller");
const validator = require("./expenses.validator");
const { config } = require("../../config/env");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("expenses", action);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MEDIA_MAX_FILE_SIZE_MB * 1024 * 1024 },
});

// Categories
router.get("/categories", can("view"), controller.listCategories);
router.post(
  "/categories",
  can("create"),
  validator.validateCategoryCreate,
  controller.createCategory,
);
router.patch(
  "/categories/:catId",
  can("edit"),
  validator.validateCategoryUpdate,
  controller.updateCategory,
);

// Cash advances (request → approve → disburse → settle)
router.get("/advances", can("view"), controller.listAdvances);
router.post(
  "/advances",
  can("create"),
  validator.validateAdvanceRequest,
  controller.requestAdvance,
);
router.get("/advances/:advId", can("view"), controller.getAdvance);
router.post(
  "/advances/:advId/approve",
  can("approve"),
  validator.validateAdvanceApprove,
  controller.approveAdvance,
);
router.post(
  "/advances/:advId/reject",
  can("approve"),
  validator.validateAdvanceReject,
  controller.rejectAdvance,
);
router.post(
  "/advances/:advId/disburse",
  can("approve"),
  validator.validateAdvanceDisburse,
  controller.disburseAdvance,
);
router.post(
  "/advances/:advId/settle",
  can("edit"),
  validator.validateAdvanceSettle,
  controller.settleAdvance,
);

// Expenses
router.get("/", can("view"), controller.listExpenses);
// KPIs before /:id so the literal isn't captured as an id.
router.get("/kpis", can("view"), controller.kpis);
router.post(
  "/",
  can("create"),
  validator.validateExpenseCreate,
  controller.createExpense,
);
router.get("/:id", can("view"), controller.getById);
router.post(
  "/:id/submit",
  can("edit"),
  validator.validateTransition,
  controller.submit,
);
router.post(
  "/:id/approve",
  can("approve"),
  validator.validateTransition,
  controller.approve,
);
router.post(
  "/:id/reject",
  can("approve"),
  validator.validateTransition,
  controller.reject,
);
router.post(
  "/:id/pay",
  can("approve"),
  validator.validateMarkPaid,
  controller.markPaid,
);

// Receipts (multipart upload → Documents gateway)
router.get("/:id/receipts", can("view"), controller.listReceipts);
router.post(
  "/:id/receipts",
  can("edit"),
  upload.single("file"),
  validator.validateReceiptMeta,
  controller.addReceipt,
);

module.exports = router;
