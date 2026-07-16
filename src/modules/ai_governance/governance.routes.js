/**
 * AI Governance (V2.2 §6.31) — routes. Mounted at /api/v1/ai-governance.
 * Permission key: ai_governance. The "AI Control" admin surface: feature
 * flags, per-user access grants, encrypted vendor credentials, monthly budget
 * periods, the usage ledger + live spend meter, and the action catalogue.
 */

"use strict";

const express = require("express");
const c = require("./governance.controller");
const v = require("./governance.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("ai_governance", action);

// ── Feature flags ──────────────────────────────────────────
router.get("/flags", can("view"), c.listFlags);
router.get("/flags/audit", can("view"), c.recentFlagAudit);
router.post("/flags", can("create"), v.validateFlagUpsert, c.upsertFlag);
router.post(
  "/flags/:feature_key/toggle",
  can("edit"),
  v.validateFlagToggle,
  c.toggleFlag,
);
// Q8: per-brand toggle, per-user daily cap, per-feature "resting"
// message. All audit-logged in the service — "who turned it off, when"
// always answers itself.
router.post(
  "/flags/:feature_key/brand-scope",
  can("edit"),
  v.validateFlagBrandScope,
  c.setFlagBrandScope,
);
router.post(
  "/flags/:feature_key/user-cap",
  can("edit"),
  v.validateFlagUserCap,
  c.setFlagUserCap,
);
router.post(
  "/flags/:feature_key/resting-message",
  can("edit"),
  v.validateFlagRestingMessage,
  c.setFlagRestingMessage,
);

// ── Access grants ──────────────────────────────────────────
router.get("/grants", can("view"), c.listGrants);
// Employee picker for the AI Access screen — search login users without
// needing iam.view (AI Control admins aren't necessarily IAM admins).
router.get("/grants/users", can("view"), c.searchGrantUsers);
router.post("/grants", can("create"), v.validateGrantCreate, c.grant);
// Grant one user several features at once ("give them the whole AI").
router.post("/grants/bulk", can("create"), v.validateGrantBulk, c.grantBulk);
router.delete(
  "/grants/:grant_id",
  can("delete"),
  v.validateReason,
  c.revokeGrant,
);

// ── Vendor credentials ─────────────────────────────────────
router.get("/vendors", can("view"), c.listVendors);
router.post("/vendors", can("create"), v.validateVendorUpsert, c.upsertVendor);
router.post(
  "/vendors/:vendor/rotate",
  can("edit"),
  v.validateVendorRotate,
  c.rotateVendor,
);
router.post(
  "/vendors/:vendor/active",
  can("edit"),
  v.validateVendorActive,
  c.setVendorActive,
);
// Live "Test connection" (Q2) — makes a real 1-token call so a bad key /
// bad endpoint is caught at Save time, not by a shopper's failing request.
router.post(
  "/vendors/:vendor/test",
  can("edit"),
  v.validateVendorTest,
  c.testVendor,
);

// ── Health (Q6) ────────────────────────────────────────────
router.get("/health/vendors", can("view"), c.listVendorHealth);
router.get("/health/pings", can("view"), c.listHealthPings);
router.get("/health/incidents", can("view"), c.listIncidents);
router.post(
  "/health/vendors/:vendor/ping",
  can("edit"),
  c.pingVendorNow,
);

// ── AI Health & Logs (Q5) ──────────────────────────────────
router.get("/logs/recent", can("view"), c.recentErrors);
router.get("/logs/success-rate", can("view"), c.successRate);

// ── Budget periods ─────────────────────────────────────────
router.get("/budget/active", can("view"), c.activeBudget);
router.get("/budget", can("view"), c.listBudgets);
router.post("/budget", can("create"), v.validateBudgetOpen, c.openBudget);
router.post(
  "/budget/:period_id/caps",
  can("edit"),
  v.validateBudgetCaps,
  c.setBudgetCaps,
);

// ── Usage meter ────────────────────────────────────────────
router.get("/usage", can("view"), c.listUsage);
router.get("/usage/meter", can("view"), c.spendMeter);
// Chief-of-Staff per-turn traces (observability; metadata only).
router.get("/cos-turns", can("view"), c.listCosTurns);

// ── Brand Voice (per-brand Praxis personality) ─────────────
router.get("/brand-voice", can("view"), c.getBrandVoice);
router.put(
  "/brand-voice",
  can("edit"),
  v.validateBrandVoiceUpsert,
  c.upsertBrandVoice,
);

// ── Model catalogue (PR 5) ─────────────────────────────────
// Read-everyone-with-view (so they can see what's configured);
// upsert/edit gated by ai_governance.edit (CEO + AI Control admins).
router.get("/models", can("view"), c.listModels);
router.post("/models", can("edit"), v.validateModelUpsert, c.upsertModel);

// ── Action catalogue ───────────────────────────────────────
router.get("/actions", can("view"), c.listActions);
router.post("/actions", can("create"), v.validateActionUpsert, c.upsertAction);
router.post(
  "/actions/:action_key/toggle",
  can("edit"),
  v.validateActionToggle,
  c.toggleAction,
);

module.exports = router;
