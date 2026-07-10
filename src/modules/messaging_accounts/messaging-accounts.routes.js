"use strict";

const express = require("express");
const multer = require("multer");
const c = require("./messaging-accounts.controller");
const v = require("./messaging-accounts.validator");
const { config } = require("../../config/env");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("messaging_accounts", action);

// Display-picture uploads are multipart; buffered in memory (→ sharp →
// Meta resumable upload). WhatsApp caps the photo at 5MB but we let the
// platform limit apply, then normalise down before sending.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (config.MEDIA_MAX_FILE_SIZE_MB || 25) * 1024 * 1024 },
});

router.get("/", can("view"), c.listAccounts);
router.post("/", can("create"), v.validateUpsert, c.upsertAccount);
router.get("/:id", can("view"), c.getAccount);
router.post("/:id/active", can("edit"), v.validateSetActive, c.setActive);
router.post("/:id/test", can("view"), c.testAccount);
// Password-verified reveal — edit-permissioned. The endpoint itself
// re-authenticates the user with their login password, so the RBAC
// check is just the base gate.
router.post("/:id/reveal", can("edit"), v.validateReveal, c.revealSecret);
router.get("/:id/reveals", can("view"), c.listReveals);
// WhatsApp business profile — the customer-facing "business card".
router.get("/:id/whatsapp-profile", can("view"), c.getWhatsAppProfile);
router.post(
  "/:id/whatsapp-profile",
  can("edit"),
  v.validateWhatsAppProfile,
  c.updateWhatsAppProfile,
);
router.post(
  "/:id/whatsapp-profile/picture",
  can("edit"),
  upload.single("file"),
  c.setWhatsAppProfilePicture,
);
router.delete("/:id", can("delete"), c.removeAccount);

module.exports = router;
