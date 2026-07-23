/**
 * POS terminal-payment reconciliation. Mounted at /api/v1/pos.
 * Permission key: sales (same module as the rest of Sales — decision 4B).
 *
 * Backing table (shared): pos_terminal_reconciliation.
 */

"use strict";

const express = require("express");
const controller = require("./pos.controller");
const validator = require("./pos.validator");
const { requirePermission } = require("../../middleware/rbac");

require("./pos.subscribers");

const router = express.Router();
const can = (action) => requirePermission("sales", action);

// Manual "Sync now" — runs the same Nomba ledger pull the 10-minute cron
// does, on demand, so staff don't have to wait for the next tick after
// noticing a suspicious gap.
router.post(
  "/reconciliation/sync-nomba-ledger",
  can("edit"),
  controller.syncNombaLedger,
);
router.get("/reconciliation", can("view"), controller.listPending);
router.get(
  "/reconciliation/unresolved",
  can("view"),
  controller.listUnresolved,
);
router.get("/reconciliation/:id", can("view"), controller.getById);
router.get(
  "/reconciliation/:id/suggestions",
  can("view"),
  controller.suggestions,
);
router.post(
  "/reconciliation/:id/match",
  can("edit"),
  validator.validateMatch,
  controller.match,
);
router.post(
  "/reconciliation/:id/ignore",
  can("edit"),
  validator.validateIgnore,
  controller.ignore,
);

module.exports = router;
