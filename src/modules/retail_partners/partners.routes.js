/**
 * Retail Partners (V2.2 §6.29) — routes. Mounted at /api/v1/retail-partners.
 * Permission key: retail_partners. Consignment wholesale: partners, locations,
 * stock + movements (dispatch/sale/return), and periodic settlements.
 */

"use strict";

const express = require("express");
const c = require("./partners.controller");
const v = require("./partners.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("retail_partners", action);

// ── Stock + movements (literal segments before /:id) ───────
router.get("/stock", can("view"), c.listStock);
router.get("/movements", can("view"), c.listMovements);
router.post(
  "/movements",
  can("create"),
  v.validateMovementRecord,
  c.recordMovement,
);

// ── Settlements ────────────────────────────────────────────
router.get("/settlements", can("view"), c.listSettlements);
router.post(
  "/settlements",
  can("create"),
  v.validateSettlementGenerate,
  c.generateSettlement,
);
router.get("/settlements/:id", can("view"), c.getSettlement);
router.post("/settlements/:id/approve", can("approve"), c.approveSettlement);
router.post(
  "/settlements/:id/paid",
  can("approve"),
  v.validateSettlementPaid,
  c.markSettlementPaid,
);

// ── Partners ───────────────────────────────────────────────
router.get("/", can("view"), c.listPartners);
router.post("/", can("create"), v.validatePartnerCreate, c.createPartner);
router.get("/:id", can("view"), c.getPartner);
router.patch("/:id", can("edit"), v.validatePartnerUpdate, c.updatePartner);
router.post("/:id/status", can("edit"), v.validateStatusChange, c.setStatus);

// ── Locations (nested under a partner) ─────────────────────
router.get("/:id/locations", can("view"), c.listLocations);
router.post(
  "/:id/locations",
  can("create"),
  v.validateLocationCreate,
  c.createLocation,
);

module.exports = router;
