/**
 * Pricing Engine (V2.2 §6.25) — routes. Mounted at /api/v1/pricing.
 * Permission key: pricing.
 *
 * Rules / floors / channel overrides, the effective-price resolver (the
 * storefront/POS/sales connection), goal-seek scenarios, and CEO-approved
 * price proposals that apply back to product_variants.
 */

"use strict";

const express = require("express");
const c = require("./pricing.controller");
const v = require("./pricing.validator");
const adv = require("./pricing_advisor.controller");
const advV = require("./pricing_advisor.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("pricing", action);

// ── Product-centric advisor (the easy-to-use heart) ────────
// recommend = read-only suggestion; apply = threshold governance (instant for
// small changes, else a CEO proposal); config = the advisor's knobs +
// configurable channel fees; usd = the fixed manual dollar price.
router.post("/recommend", can("view"), advV.validateRecommend, adv.recommend);
router.post("/apply", can("edit"), advV.validateApply, adv.apply);
router.get("/config", can("view"), adv.getConfig);
router.put("/config", can("edit"), advV.validateConfig, adv.updateConfig);
router.put(
  "/variants/:variant_id/usd",
  can("edit"),
  advV.validateUsd,
  adv.setUsd,
);

// ── Effective price + history (literals before any :id) ────
router.get("/effective/:variant_id", can("view"), c.effectivePrice);
router.get("/history/:variant_id", can("view"), c.priceHistory);

// ── Rules ──────────────────────────────────────────────────
router.get("/rules", can("view"), c.listRules);
router.post("/rules", can("create"), v.validateRuleCreate, c.createRule);
router.patch("/rules/:id", can("edit"), v.validateRuleUpdate, c.updateRule);
router.delete("/rules/:id", can("delete"), c.deactivateRule);

// ── Floors ─────────────────────────────────────────────────
router.get("/floors", can("view"), c.listFloors);
router.post("/floors", can("create"), v.validateFloorSet, c.setFloor);
router.delete("/floors/:id", can("delete"), c.removeFloor);

// ── Channel overrides ──────────────────────────────────────
router.get("/overrides", can("view"), c.listOverrides);
router.post("/overrides", can("create"), v.validateOverrideSet, c.setOverride);
router.delete("/overrides/:id", can("delete"), c.removeOverride);

// ── Scenarios (goal-seek + sensitivity) ────────────────────
router.get("/scenarios", can("view"), c.listScenarios);
router.post(
  "/scenarios",
  can("create"),
  v.validateScenarioCreate,
  c.createScenario,
);
router.get("/scenarios/:id", can("view"), c.getScenario);
router.post(
  "/scenarios/:id/compute",
  can("edit"),
  v.validateCompute,
  c.computeScenario,
);

// ── Proposals (CEO approval → apply to variants) ───────────
router.get("/proposals", can("view"), c.listProposals);
router.post(
  "/proposals",
  can("create"),
  v.validateProposalCreate,
  c.createProposal,
);
router.get("/proposals/:id", can("view"), c.getProposal);
router.post("/proposals/:id/approve", can("approve"), c.approveProposal);
router.post(
  "/proposals/:id/reject",
  can("approve"),
  v.validateReason,
  c.rejectProposal,
);
router.post(
  "/proposals/:id/revert",
  can("approve"),
  v.validateReason,
  c.revertProposal,
);

module.exports = router;
