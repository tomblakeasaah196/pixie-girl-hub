/**
 * Email Campaigns (V2.2 §6.16) — routes. Mounted at /api/v1/email-campaigns.
 * Permission key: email_campaigns. Templates + campaigns; recipients are built
 * from contacts; sends go through the email provider; events roll up counters.
 */

"use strict";

const express = require("express");
const c = require("./email-campaigns.controller");
const v = require("./email-campaigns.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("email_campaigns", action);

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
router.get("/segments", can("view"), c.listSegments);
router.post("/segments", can("create"), v.validateSegmentSave, c.saveSegment);
router.get("/segments/:id", can("view"), c.getSegment);
router.get("/segments/:id/preview", can("view"), c.previewSegment);
router.delete("/segments/:id", can("delete"), c.deleteSegment);

// Campaigns
router.get("/", can("view"), c.listCampaigns);
router.post("/", can("create"), v.validateCampaignCreate, c.createCampaign);
router.get("/:id", can("view"), c.getCampaign);
router.get("/:id/stats", can("view"), c.getStats);
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
