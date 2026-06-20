/**
 * Landing Studio — admin routes (auth + brand-context applied upstream).
 * Mounted at /api/v1/landing-studio.
 *
 * The studio is a standalone, brand-level editor (not nested in a campaign).
 * It reuses the `sales_campaigns` permission key — the same people who run
 * sales drops own the between-drops landing page.
 *
 *   GET   /                → studio payload (draft + published + meta)
 *   PUT   /                → save draft
 *   POST  /publish         → publish draft → live
 *   POST  /upload-image    → store an image, returns { url }
 */

"use strict";

const express = require("express");
const multer = require("multer");
const controller = require("./landing.controller");
const validator = require("./landing.validator");
const { requirePermission } = require("../../middleware/rbac");
const { config } = require("../../config/env");

const router = express.Router();

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (config.MEDIA_MAX_FILE_SIZE_MB || 10) * 1024 * 1024 },
});

router.get("/", requirePermission("sales_campaigns", "view"), controller.get);
router.put(
  "/",
  requirePermission("sales_campaigns", "edit"),
  validator.validateSave,
  controller.save,
);
router.post(
  "/publish",
  requirePermission("sales_campaigns", "edit"),
  controller.publish,
);
router.post(
  "/upload-image",
  requirePermission("sales_campaigns", "edit"),
  imageUpload.single("file"),
  controller.uploadImage,
);

module.exports = router;
