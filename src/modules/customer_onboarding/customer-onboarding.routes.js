/**
 * Customer Onboarding — routes.
 *
 * Two routers exported so the app can mount the admin one at
 * /api/v1/customer-onboarding and the public one at /api/public/onboarding.
 * The public path is token-protected; the admin paths use the
 * smartcomm / customer_onboarding permission keys.
 */

"use strict";

const express = require("express");
const c = require("./customer-onboarding.controller");
const v = require("./customer-onboarding.validator");
const { requirePermission } = require("../../middleware/rbac");

const adminRouter = express.Router();
adminRouter.post(
  "/links",
  // Generating an onboarding link is part of the Smartcomm composer flow,
  // so this rides on smartcomm.edit. Reviewing past submissions uses the
  // dedicated customer_onboarding key.
  requirePermission("smartcomm", "edit"),
  v.validateCreateLink,
  c.createLink,
);
adminRouter.get(
  "/admin/submissions",
  requirePermission("customer_onboarding", "view"),
  c.listAdmin,
);

const publicRouter = express.Router();
publicRouter.get("/:token", c.getPublic);
publicRouter.post("/:token", v.validateSubmission, c.submitPublic);

module.exports = { adminRouter, publicRouter };
