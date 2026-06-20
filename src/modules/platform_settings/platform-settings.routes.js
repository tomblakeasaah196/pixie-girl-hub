/**
 * Platform Settings — protected routes (mounted at /api/v1/platform-settings).
 *
 * The unauthenticated companion endpoint lives in branding.public.routes.js
 * and is mounted at /api/public/branding so the login page can theme
 * itself before any token exists.
 */

"use strict";

const express = require("express");
const multer = require("multer");
const controller = require("./platform-settings.controller");
const validator = require("./platform-settings.validator");
const { requirePermission } = require("../../middleware/rbac");
const { config } = require("../../config/env");

const router = express.Router();
// Appearance is a business-setup concern; we reuse its permission key
// rather than minting a new module so the existing access matrix
// already covers it.
const can = (action) => requirePermission("business_setup", action);

// In-memory upload (handed straight to storage.service). Capped at 8MB —
// branding images (logos, login backgrounds) should be far smaller.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Math.min(8, config.MEDIA_MAX_FILE_SIZE_MB || 8) * 1024 * 1024,
  },
});

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

// POST /api/v1/platform-settings/upload-image — admin uploads a branding
// image (logo / favicon / login background); returns its public URL.
router.post(
  "/upload-image",
  can("edit"),
  upload.single("file"),
  controller.uploadImage,
);

module.exports = router;
