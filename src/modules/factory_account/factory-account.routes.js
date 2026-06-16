/**
 * Factory Account (China running-balance ledger) — routes.
 * Mounted at /api/v1/factory-accounts.
 * Permission key: purchasing (factory accounts are part of the procurement surface).
 *
 * Factory managers get scoped access: they can only see/edit their own account
 * and log shipments. The permission check for factory managers is enforced here
 * by requiring `purchasing.view` for reads and `purchasing.create` / `purchasing.edit`
 * for writes — the CEO role bypasses all checks as per the RBAC contract.
 */

"use strict";

const express = require("express");
const c = require("./factory-account.controller");
const v = require("./factory-account.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("purchasing", action);

// ── Accounts ──────────────────────────────────────────────
router.get("/", can("view"), c.listAccounts);
router.post("/", can("create"), v.validateAccountCreate, c.createAccount);
router.get("/:accountId", can("view"), c.getAccount);
router.patch("/:accountId", can("edit"), v.validateAccountUpdate, c.updateAccount);

// ── Ledger entries ────────────────────────────────────────
router.get("/:accountId/ledger", can("view"), c.listLedger);
router.post("/:accountId/ledger", can("edit"), v.validateLedgerEntry, c.addLedgerEntry);
router.post("/:accountId/reconcile", can("approve"), v.validateLedgerReconcile, c.reconcileEntries);

// ── Shipments ─────────────────────────────────────────────
router.get("/shipments", can("view"), c.listShipments);
router.post("/shipments", can("create"), v.validateShipmentCreate, c.createShipment);
router.get("/shipments/:shipmentId", can("view"), c.getShipment);
router.patch("/shipments/:shipmentId", can("edit"), v.validateShipmentUpdate, c.advanceShipment);
router.post("/shipments/:shipmentId/advance", can("edit"), v.validateShipmentAdvance, c.advanceShipment);

module.exports = router;
