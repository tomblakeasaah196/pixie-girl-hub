/**
 * Email Campaigns (V2.2 §6.16) — routes. Mounted at /api/v1/email-campaigns.
 * Permission key: email_campaigns. Templates + campaigns; recipients are built
 * from contacts; sends go through the email provider; events roll up counters.
 */

"use strict";

const express = require("express");
const multer = require("multer");
const c = require("./email-campaigns.controller");
const v = require("./email-campaigns.validator");
const { requirePermission } = require("../../middleware/rbac");
const { config } = require("../../config/env");

const router = express.Router();
const can = (action) => requirePermission("email_campaigns", action);

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (config.MEDIA_MAX_FILE_SIZE_MB || 10) * 1024 * 1024 },
});

// Templates (admin-UI Tier-1 J)
router.get("/templates", can("view"), c.listTemplates);
router.post(
  "/templates",
  can("create"),
  v.validateTemplateCreate,
  c.createTemplate,
);
router.patch(
  "/templates/:id",
  can("edit"),
  v.validateTemplateUpdate,
  c.updateTemplate,
);

// Saved segments (audience builder)
// Mail-editor image upload (drag/drop or pick → public URL)
router.post(
  "/upload-image",
  can("create"),
  imageUpload.single("file"),
  c.uploadImage,
);

// Brand frame (the header/footer wrapped around every campaign mail)
router.get("/frame", can("view"), c.getFrame);
router.put("/frame", can("edit"), v.validateFramePatch, c.updateFrame);
router.get("/frame/shell", can("view"), c.frameShell);

router.get("/segments", can("view"), c.listSegments);
router.post("/segments", can("create"), v.validateSegmentSave, c.saveSegment);
router.post(
  "/segments/preview",
  can("view"),
  v.validateAudiencePreview,
  c.previewAudience,
);
router.get("/segments/:id", can("view"), c.getSegment);
router.get("/segments/:id/preview", can("view"), c.previewSegment);
router.delete("/segments/:id", can("delete"), c.deleteSegment);

// Campaigns
router.get("/", can("view"), c.listCampaigns);
router.post("/", can("create"), v.validateCampaignCreate, c.createCampaign);
router.get("/:id", can("view"), c.getCampaign);
router.patch("/:id", can("edit"), v.validateCampaignUpdate, c.updateCampaign);
router.get("/:id/stats", can("view"), c.getStats);
router.get("/:id/preview", can("view"), c.previewCampaign);
router.get("/:id/ab-results", can("view"), c.getAbTestResults);
router.post(
  "/:id/recipients",
  can("edit"),
  v.validateBuildRecipients,
  c.buildRecipients,
);
router.post(
  "/:id/audience-from-segment",
  can("edit"),
  v.validateAudienceFromSegment,
  c.buildAudienceFromSegment,
);
router.post(
  "/:id/variants",
  can("edit"),
  v.validateVariantCreate,
  c.createVariant,
);
router.post(
  "/:id/winner",
  can("edit"),
  v.validateDeclareWinner,
  c.declareWinner,
);
router.post("/:id/schedule", can("edit"), v.validateSchedule, c.schedule);
router.post("/:id/send", can("approve"), c.sendCampaign);
router.post("/:id/pause", can("edit"), c.pauseCampaign);
router.post("/:id/cancel", can("edit"), c.cancelCampaign);
router.post("/:id/events", can("edit"), v.validateEventIngest, c.recordEvent);

module.exports = router;
