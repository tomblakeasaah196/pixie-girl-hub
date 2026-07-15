/**
 * Apify Settings — routes. Mounted at /api/v1/apify-settings.
 * Permission key: apify_settings. Singleton platform-wide integration
 * credential (no :id — see apify-settings.repo.js).
 */

"use strict";

const express = require("express");
const c = require("./apify-settings.controller");
const v = require("./apify-settings.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("apify_settings", action);

router.get("/", can("view"), c.getSettings);
router.post("/", can("edit"), v.validateUpsert, c.upsertSettings);
router.post("/test", can("view"), c.testConnection);
// Password-verified reveal — re-authenticates the caller itself, so the
// RBAC check here is just the base gate (same reasoning as
// messaging_accounts' /:id/reveal).
router.post("/reveal", can("edit"), v.validateReveal, c.revealSecret);
router.get("/reveals", can("view"), c.listReveals);

module.exports = router;
