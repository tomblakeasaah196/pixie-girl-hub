/**
 * Settings module routes — mounted at /api/v1/settings.
 *
 * Owns the schemas introduced in migration 000210. The existing config
 * tables (currencies, tax, numbering, custom fields, pipelines, banks,
 * gateways) stay under /api/v1/business-setup.
 *
 * Gated by the `settings` permission key (CEO/admin) — except the
 * notification-preference routes, which are self-service (any
 * authenticated user manages their own).
 */

"use strict";

const express = require("express");
const controller = require("./settings.controller");
const validator = require("./settings.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("settings", action);

// ── document_templates ───────────────────────────────────
router.get("/document-templates", can("view"), controller.listTemplates);
router.post(
  "/document-templates",
  can("create"),
  validator.validateTemplateCreate,
  controller.createTemplate,
);
router.patch(
  "/document-templates/:id",
  can("edit"),
  validator.validateTemplateUpdate,
  controller.updateTemplate,
);
router.post(
  "/document-templates/:id/set-default",
  can("edit"),
  controller.setDefaultTemplate,
);
router.delete(
  "/document-templates/:id",
  can("delete"),
  controller.deleteTemplate,
);

// ── notification_preferences (self-service; no settings perm) ──
router.get("/notification-preferences", controller.listNotificationPrefs);
router.put(
  "/notification-preferences",
  validator.validateNotificationPref,
  controller.upsertNotificationPref,
);

// ── scheduled_reports ────────────────────────────────────
router.get("/scheduled-reports", can("view"), controller.listReports);
router.post(
  "/scheduled-reports",
  can("create"),
  validator.validateReportCreate,
  controller.createReport,
);
router.patch(
  "/scheduled-reports/:id",
  can("edit"),
  validator.validateReportUpdate,
  controller.updateReport,
);
router.delete("/scheduled-reports/:id", can("delete"), controller.deleteReport);

// ── integration_secrets (write-only) ─────────────────────
router.get("/integration-secrets", can("view"), controller.listSecrets);
router.put(
  "/integration-secrets",
  can("edit"),
  validator.validateSecretSet,
  controller.setSecret,
);
router.delete(
  "/integration-secrets/:id",
  can("delete"),
  controller.deleteSecret,
);

// ── business_policies ────────────────────────────────────
// Settings owns content. Storefront Studio chooses which ones go to the
// public website (read-side), but content lives here.
router.get("/policies", can("view"), controller.listPolicies);
router.post(
  "/policies",
  can("create"),
  validator.validatePolicyCreate,
  controller.createPolicy,
);
router.patch(
  "/policies/:id",
  can("edit"),
  validator.validatePolicyUpdate,
  controller.updatePolicy,
);
router.delete("/policies/:id", can("delete"), controller.deletePolicy);

module.exports = router;
