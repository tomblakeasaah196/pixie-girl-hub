/**
 * Platform Settings — protected routes (mounted at /api/v1/platform-settings).
 *
 * The unauthenticated companion endpoint lives in branding.public.routes.js
 * and is mounted at /api/public/branding so the login page can theme
 * itself before any token exists.
 */

"use strict";

const express = require("express");
const controller = require("./platform-settings.controller");
const validator = require("./platform-settings.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
// Appearance is a business-setup concern; we reuse its permission key
// rather than minting a new module so the existing access matrix
// already covers it.
const can = (action) => requirePermission("business_setup", action);

// GET /api/v1/platform-settings — the singleton (full payload incl. theme).
router.get("/", can("view"), controller.getSettings);

// PATCH /api/v1/platform-settings — admin-only partial update.
router.patch(
  "/",
  can("edit"),
  validator.validatePlatformUpdate,
  controller.updateSettings,
);

// GET /api/v1/platform-settings/fonts — the curated picker catalogue.
router.get("/fonts", can("view"), controller.listFonts);

module.exports = router;
