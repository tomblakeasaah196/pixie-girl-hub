/**
 * Social Studio (V2.2 §6.14) — routes. Mounted at /api/v1/social.
 * Permission key: social. Content plans (monthly batch + CEO approval),
 * posts (proof-of-publish), targets/performance/team, connected-account
 * registry, and the inbound-DM bridge into Smartcomm (§6.1).
 */

"use strict";

const express = require("express");
const multer = require("multer");
const c = require("./social.controller");
const v = require("./social.validator");
const { requirePermission } = require("../../middleware/rbac");
const { config } = require("../../config/env");

const router = express.Router();
const can = (action) => requirePermission("social", action);

// In-memory upload for the proof screenshot -> storage.service.
const screenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (config.MEDIA_MAX_FILE_SIZE_MB || 10) * 1024 * 1024 },
});

// Accounts
router.get("/accounts", can("view"), c.listAccounts);
router.get("/staff", can("view"), c.listAssignableStaff);
router.post(
  "/accounts",
  can("create"),
  v.validateAccountConnect,
  c.connectAccount,
);
router.delete("/accounts/:id", can("delete"), c.revokeAccount);
router.post("/accounts/:id/sync", can("edit"), c.syncAccount);

// Content plans
router.get("/plans", can("view"), c.listPlans);
router.post("/plans", can("create"), v.validatePlanCreate, c.createPlan);
router.get("/plans/:id", can("view"), c.getPlan);
router.post(
  "/plans/:id/posts",
  can("create"),
  v.validatePlanAddPosts,
  c.addPostsToPlan,
);
router.post("/plans/:id/submit", can("edit"), c.submitPlan);
router.post(
  "/plans/:id/approve",
  can("approve"),
  v.validatePlanDecision,
  c.approvePlan,
);
router.post(
  "/plans/:id/request-changes",
  can("approve"),
  v.validatePlanDecision,
  c.requestPlanChanges,
);

// Posts
router.get("/posts", can("view"), c.listPosts);
router.post("/posts", can("create"), v.validatePostCreate, c.createPost);
router.get("/posts/:id", can("view"), c.getPost);
router.patch("/posts/:id", can("edit"), v.validatePostUpdate, c.updatePost);
router.post(
  "/posts/:id/reschedule",
  can("edit"),
  v.validateReschedule,
  c.reschedulePost,
);
router.post(
  "/posts/:id/proof",
  can("edit"),
  screenshotUpload.single("screenshot"),
  v.validateProofSubmit,
  c.submitProof,
);
router.post(
  "/posts/:id/rate",
  can("approve"),
  v.validateRateCreative,
  c.rateCreative,
);
router.post(
  "/posts/:id/metrics",
  can("edit"),
  v.validateMetrics,
  c.recordMetrics,
);
router.post("/posts/:id/snooze", can("edit"), c.snoozePost);

// Targets + Performance + Team
router.post("/targets", can("approve"), v.validateTargetSet, c.setTarget);
router.get("/targets", can("view"), c.listTargets);
router.get("/performance", can("view"), c.getPerformance);
router.get("/team", can("view"), c.getTeam);
router.get("/team/:userId", can("view"), c.getCreatorDrilldown);

// Inbound DM → Smartcomm (CRM §6.1)
router.post("/dm/ingest", can("edit"), v.validateDmIngest, c.ingestInboundDM);

module.exports = router;
