/**
 * Organisation & Workflow Builder (V2.2 §6.27)
 *
 * Module: org_workflow
 * Permission key: org_workflow
 *
 * Two surfaces share this router (all under /api/v1/org):
 *   - Approvals       the pending-approvals queue + acting on a stage
 *   - Workflows       the definition Builder read/author surface
 *   - Org units       generic org-structure CRUD (org_units, positions, …)
 *
 * Route ORDER matters: the static /approvals and /workflows prefixes are
 * registered BEFORE the dynamic /:id org-unit routes, otherwise Express
 * would match "approvals" as an :id.
 *
 * Backing tables (shared): workflow_definitions, workflow_instances,
 *   workflow_decisions; org_units, org_positions, roles, permissions.
 */

"use strict";

const express = require("express");
const controller = require("./org.controller");
const validator = require("./org.validator");
const approvals = require("./approvals.controller");
const approvalsValidator = require("./approvals.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();

// ── Approvals queue (V2.2 §6.27) ───────────────────────────
router.get(
  "/approvals/pending",
  requirePermission("org_workflow", "view"),
  approvals.listPending,
);
router.get(
  "/approvals/:instance_id",
  requirePermission("org_workflow", "view"),
  approvals.getInstance,
);
router.post(
  "/approvals/:instance_id/act",
  requirePermission("org_workflow", "approve"),
  approvalsValidator.validateAct,
  approvals.act,
);

// ── Workflow definitions (the Builder) ─────────────────────
router.get(
  "/workflows",
  requirePermission("org_workflow", "view"),
  approvals.listDefinitions,
);
router.get(
  "/workflows/:workflow_id",
  requirePermission("org_workflow", "view"),
  approvals.getDefinition,
);
router.post(
  "/workflows",
  requirePermission("org_workflow", "create"),
  approvalsValidator.validateDefinition,
  approvals.createDefinition,
);
router.patch(
  "/workflows/:workflow_id",
  requirePermission("org_workflow", "edit"),
  approvalsValidator.validateDefinitionActive,
  approvals.setDefinitionActive,
);

// ── Org positions (the approval-authority graph) ───────────
router.get(
  "/positions",
  requirePermission("org_workflow", "view"),
  controller.listPositions,
);
router.get(
  "/positions/:position_id",
  requirePermission("org_workflow", "view"),
  controller.getPosition,
);
router.post(
  "/positions",
  requirePermission("org_workflow", "create"),
  validator.validatePositionCreate,
  controller.createPosition,
);
router.patch(
  "/positions/:position_id",
  requirePermission("org_workflow", "edit"),
  validator.validatePositionUpdate,
  controller.updatePosition,
);
router.delete(
  "/positions/:position_id",
  requirePermission("org_workflow", "delete"),
  controller.deletePosition,
);

// ── Dotted-line reporting (info-only; multi-select per position) ──
router.get(
  "/positions/:position_id/dotted-lines",
  requirePermission("org_workflow", "view"),
  controller.listDottedLines,
);
router.post(
  "/positions/:position_id/dotted-lines",
  requirePermission("org_workflow", "create"),
  (req, _res, next) => {
    // The "from" position comes from the path; fold it in before validation.
    req.body = { ...(req.body || {}), position_id: req.params.position_id };
    next();
  },
  validator.validateDottedLineCreate,
  controller.createDottedLine,
);
router.patch(
  "/dotted-lines/:dotted_id",
  requirePermission("org_workflow", "edit"),
  validator.validateDottedLineUpdate,
  controller.updateDottedLine,
);
router.delete(
  "/dotted-lines/:dotted_id",
  requirePermission("org_workflow", "delete"),
  controller.deleteDottedLine,
);

// ── Full organigramme (every department, one chart) ────────
router.post(
  "/chart/pdf",
  requirePermission("org_workflow", "view"),
  controller.exportFullChartPdf,
);

// ── Org-structure CRUD (org_units) ─────────────────────────
router.get("/", requirePermission("org_workflow", "view"), controller.list);
router.get(
  "/:id",
  requirePermission("org_workflow", "view"),
  controller.getById,
);
router.post(
  "/",
  requirePermission("org_workflow", "create"),
  validator.validateCreate,
  controller.create,
);
router.patch(
  "/:id",
  requirePermission("org_workflow", "edit"),
  validator.validateUpdate,
  controller.update,
);
router.delete(
  "/:id",
  requirePermission("org_workflow", "delete"),
  controller.archive,
);

module.exports = router;
