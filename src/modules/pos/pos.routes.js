/**
 * Point of Sale (V2.2 §6.3) — routes. Mounted at /api/v1/pos.
 * Permission key: pos.
 *
 * Backing tables (per-brand): pos_terminals, pos_pin_credentials, pos_sessions,
 * pos_transactions, pos_payment_splits, pos_cash_drops, pos_void_log,
 * pos_session_summary.
 */

"use strict";

const express = require("express");
const controller = require("./pos.controller");
const validator = require("./pos.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("pos", action);

// ── Terminals (Tier-1 admin config) ──────────────────────
router.get("/terminals", can("view"), controller.listTerminals);
router.post(
  "/terminals",
  can("create"),
  validator.validateTerminalCreate,
  controller.createTerminal,
);
router.get("/terminals/:id", can("view"), controller.getTerminal);
router.patch(
  "/terminals/:id",
  can("edit"),
  validator.validateTerminalUpdate,
  controller.updateTerminal,
);
// Push a card charge to the terminal's linked Nomba POS device (D / §6.21).
router.post(
  "/terminals/:id/charge",
  can("edit"),
  validator.validateTerminalCharge,
  controller.requestTerminalCharge,
);

// ── Staff PINs (never returned) ──────────────────────────
router.post("/pins", can("edit"), validator.validatePinSet, controller.setPin);
router.post(
  "/pins/verify",
  can("view"),
  validator.validatePinVerify,
  controller.verifyPin,
);

// ── Sessions ─────────────────────────────────────────────
router.get("/sessions", can("view"), controller.listSessions);
router.post(
  "/sessions",
  can("create"),
  validator.validateSessionOpen,
  controller.openSession,
);
router.get("/sessions/:id", can("view"), controller.getSession);
router.post(
  "/sessions/:id/close",
  can("edit"),
  validator.validateSessionClose,
  controller.closeSession,
);
router.post(
  "/sessions/:id/reconcile",
  can("approve"),
  validator.validateSessionReconcile,
  controller.reconcileSession,
);

// ── Cash drops ───────────────────────────────────────────
router.post(
  "/cash-drops",
  can("edit"),
  validator.validateCashDrop,
  controller.recordCashDrop,
);

// ── Checkout / transactions ──────────────────────────────
router.get("/transactions", can("view"), controller.listTransactions);
router.post(
  "/checkout",
  can("create"),
  validator.validateCheckout,
  controller.checkout,
);
router.get("/transactions/:id", can("view"), controller.getTransaction);
router.post(
  "/transactions/:id/void",
  can("approve"),
  validator.validateVoid,
  controller.voidTransaction,
);

module.exports = router;
