/**
 * Marketing Campaigns & Ad Analytics (V2.2 §6.15) — routes. Mounted at
 * /api/v1/marketing. Permission key: ad_analytics. Ad accounts + campaigns +
 * daily spend + the sales-attribution report (spend ↔ revenue by utm_campaign).
 */

"use strict";

const express = require("express");
const c = require("./marketing.controller");
const v = require("./marketing.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("ad_analytics", action);

// Attribution (spend vs sales) — literal before any :id.
router.get("/attribution", can("view"), c.attributionReport);

// Ad accounts
router.get("/ad-accounts", can("view"), c.listAdAccounts);
router.post(
  "/ad-accounts",
  can("create"),
  v.validateAdAccountConnect,
  c.connectAdAccount,
);
router.delete("/ad-accounts/:id", can("delete"), c.revokeAdAccount);

// Ad campaigns
router.get("/ad-campaigns", can("view"), c.listAdCampaigns);
router.post(
  "/ad-campaigns",
  can("create"),
  v.validateAdCampaignCreate,
  c.createAdCampaign,
);
router.get("/ad-campaigns/:id", can("view"), c.getAdCampaign);
router.post(
  "/ad-campaigns/:id/status",
  can("edit"),
  v.validateStatusChange,
  c.setAdCampaignStatus,
);
router.post(
  "/ad-campaigns/:id/spend",
  can("edit"),
  v.validateSpend,
  c.recordSpend,
);

// Push local campaign state to the external ad platform (create/update)
router.post("/ad-campaigns/:id/push", can("edit"), c.pushAdCampaign);

module.exports = router;
