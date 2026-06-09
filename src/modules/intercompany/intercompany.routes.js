/**
 * Inter-Company Transactions (V2.2 §5.1) — routes. Mounted at
 * /api/v1/intercompany. Permission key: intercompany. Records a cross-brand
 * trade with mirrored GL in both ledgers, buyer match, settle, and
 * reconciliation. Shared tables (cross-brand).
 */

"use strict";

const express = require("express");
const controller = require("./intercompany.controller");
const validator = require("./intercompany.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("intercompany", action);

router.get("/", can("view"), controller.list);
router.post("/", can("create"), validator.validateRecord, controller.record);
router.get("/:id", can("view"), controller.getById);
router.post("/:id/match", can("approve"), controller.match);
router.post("/:id/settle", can("approve"), controller.settle);
router.post(
  "/:id/reconciliations",
  can("edit"),
  validator.validateReconciliation,
  controller.openReconciliation,
);

module.exports = router;
