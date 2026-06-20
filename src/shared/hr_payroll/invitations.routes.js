/**
 * Staff invitations routes (F-15).
 *
 * adminRouter  — mounted under the protected API at /api/v1/staff-invitations
 *                (auth + brand context applied upstream); gated on hr_payroll.
 * publicRouter — mounted at /api/public/staff-invite (no auth) with the public
 *                write throttle; lets an invitee preview + accept their invite.
 */

"use strict";

const express = require("express");
const controller = require("./invitations.controller");
const validate = require("./invitations.validator");
const { requirePermission } = require("../../middleware/rbac");

// ── Admin ──────────────────────────────────────────────────
const adminRouter = express.Router();
const P = (action) => requirePermission("hr_payroll", action);
adminRouter.get("/", P("view"), controller.list);
adminRouter.post("/", P("create"), validate.validateCreate, controller.create);
// Instant provisioning — creates the login now and returns a temp password once.
adminRouter.post(
  "/provision",
  P("create"),
  validate.validateCreate,
  controller.provision,
);
adminRouter.post("/:id/revoke", P("edit"), controller.revoke);

// ── Public ─────────────────────────────────────────────────
const publicRouter = express.Router();
publicRouter.get("/", controller.preview); // ?token=
publicRouter.post("/accept", validate.validateAccept, controller.accept);

module.exports = { adminRouter, publicRouter };
