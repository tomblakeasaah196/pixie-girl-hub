/**
 * Social Media Management (V2.2 §6.14) — routes. Mounted at /api/v1/social.
 * Permission key: social. Connected accounts + posts/metrics + inbound-DM
 * bridge into Smartcomm (links DMs to the customer profile, §6.1).
 */

"use strict";

const express = require("express");
const c = require("./social.controller");
const v = require("./social.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("social", action);

// Accounts
router.get("/accounts", can("view"), c.listAccounts);
router.post(
  "/accounts",
  can("create"),
  v.validateAccountConnect,
  c.connectAccount,
);
router.delete("/accounts/:id", can("delete"), c.revokeAccount);

// Posts
router.get("/posts", can("view"), c.listPosts);
router.post("/posts", can("create"), v.validatePostCreate, c.createPost);
router.get("/posts/:id", can("view"), c.getPost);
router.post(
  "/posts/:id/publish",
  can("edit"),
  v.validatePublish,
  c.publishPost,
);
router.post(
  "/posts/:id/reschedule",
  can("edit"),
  v.validateReschedule,
  c.reschedulePost,
);
router.post(
  "/posts/:id/metrics",
  can("edit"),
  v.validateMetrics,
  c.recordMetrics,
);
router.post("/posts/:id/metrics/refresh", can("edit"), c.refreshMetrics);

// Inbound DM → Smartcomm (CRM §6.1)
router.post("/dm/ingest", can("edit"), v.validateDmIngest, c.ingestInboundDM);

module.exports = router;
