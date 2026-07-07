/**
 * Public order tracking (V2.2 §6.23.6).
 * Lookup by public_tracking_token. No auth required.
 * GET /api/public/tracking/:token
 */

"use strict";

const express = require("express");
const multer = require("multer");
const controller = require("./logistics.controller");
const validator = require("./logistics.validator");

const router = express.Router();

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\//.test(file.mimetype);
    cb(ok ? null : new Error("Only image uploads are accepted"), ok);
  },
});

// Public, unauthenticated: the driver's delivery-confirmation link.
// Declared before "/:token" so "driver" isn't captured as a tracking token.
router.get("/driver/:token", controller.driverView);
router.post(
  "/driver/:token/confirm",
  photoUpload.single("photo"),
  validator.validateDriverConfirm,
  controller.driverConfirm,
);

// Public, unauthenticated: resolve a delivery by its tracking token (searched
// across brands) and return status + state history.
router.get("/:token", controller.trackPublic);

module.exports = router;
