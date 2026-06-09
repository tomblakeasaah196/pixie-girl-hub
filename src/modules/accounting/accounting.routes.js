/**
 * Accounting & Finance (V2.2 §6.6) — routes. Mounted at /api/v1/accounting.
 * Permission key: accounting.
 */

"use strict";

const express = require("express");
const controller = require("./accounting.controller");
const validator = require("./accounting.validator");
const bankController = require("./accounting.bank.controller");
const bankValidator = require("./accounting.bank.validator");
const { requirePermission } = require("../../middleware/rbac");

// Side-effect: register the sales.order.paid → GL posting subscriber.
require("./accounting.subscribers");

const router = express.Router();
const can = (action) => requirePermission("accounting", action);

// Chart of accounts
router.get("/account-groups", can("view"), controller.listGroups);
router.patch(
  "/account-groups/:groupId",
  can("edit"),
  validator.validateGroupUpdate,
  controller.updateGroup,
);
router.get("/accounts", can("view"), controller.listAccounts);
router.post(
  "/accounts",
  can("create"),
  validator.validateAccountCreate,
  controller.createAccount,
);
router.get("/accounts/:accountId", can("view"), controller.getAccount);
router.patch(
  "/accounts/:accountId",
  can("edit"),
  validator.validateAccountUpdate,
  controller.updateAccount,
);

// Fiscal periods
router.get("/periods", can("view"), controller.listPeriods);
router.post(
  "/periods",
  can("create"),
  validator.validatePeriodCreate,
  controller.createPeriod,
);
router.post("/periods/:periodId/close", can("approve"), controller.closePeriod);

// Journals (general ledger)
router.get("/journals", can("view"), controller.listJournals);
router.post(
  "/journals",
  can("create"),
  validator.validateManualJournal,
  controller.createManualJournal,
);
router.get("/journals/:entryId", can("view"), controller.getJournal);
router.post(
  "/journals/:entryId/reverse",
  can("approve"),
  validator.validateReverseReason,
  controller.reverseJournal,
);

// Financial reports (trial balance, P&L, balance sheet, cash flow, ageing)
router.get("/reports/trial-balance", can("view"), controller.trialBalance);
router.get("/reports/profit-and-loss", can("view"), controller.profitAndLoss);
router.get("/reports/balance-sheet", can("view"), controller.balanceSheet);
router.get("/reports/cash-flow", can("view"), controller.cashFlow);
router.get("/reports/ar-ageing", can("view"), controller.arAgeing);
router.get("/reports/ap-ageing", can("view"), controller.apAgeing);

// Bank statements
router.get("/bank-statements", can("view"), bankController.listStatements);
router.post(
  "/bank-statements",
  can("create"),
  bankValidator.validateStatementImport,
  bankController.importStatement,
);
router.get(
  "/bank-statements/:statementId",
  can("view"),
  bankController.getStatement,
);

// Bank reconciliations
router.get(
  "/bank-reconciliations",
  can("view"),
  bankController.listReconciliations,
);
router.post(
  "/bank-reconciliations",
  can("create"),
  bankValidator.validateReconOpen,
  bankController.openReconciliation,
);
router.get(
  "/bank-reconciliations/:reconId",
  can("view"),
  bankController.getReconciliation,
);
router.post(
  "/bank-reconciliations/:reconId/matches",
  can("edit"),
  bankValidator.validateReconMatch,
  bankController.matchLine,
);
router.post(
  "/bank-reconciliations/:reconId/complete",
  can("approve"),
  bankController.completeReconciliation,
);

// Tax filings
router.get("/tax-filings", can("view"), bankController.listFilings);
router.post(
  "/tax-filings",
  can("create"),
  bankValidator.validateFilingCreate,
  bankController.createFiling,
);
router.get("/tax-filings/:filingId", can("view"), bankController.getFiling);
router.post(
  "/tax-filings/:filingId/review",
  can("approve"),
  bankController.reviewFiling,
);
router.post(
  "/tax-filings/:filingId/file",
  can("approve"),
  bankValidator.validateFilingFile,
  bankController.fileFiling,
);
router.post(
  "/tax-filings/:filingId/pay",
  can("approve"),
  bankValidator.validateFilingPay,
  bankController.payFiling,
);

module.exports = router;
