/**
 * Storefront Studio (V2.2 §6.28) — routes. Mounted at /api/v1/storefront-studio.
 * Permission key: storefront_studio. Draft/publish editor for the brand's
 * theme, navigation and pages.
 *
 * Backing tables (shared): storefront_themes, storefront_pages,
 * storefront_navigation, storefront_revisions.
 */

"use strict";

const express = require("express");
const controller = require("./studio.controller");
const validator = require("./studio.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("storefront_studio", action);

// Theme
router.get("/theme", can("view"), controller.getThemes);
router.put(
  "/theme/draft",
  can("edit"),
  validator.validateThemeDraft,
  controller.saveThemeDraft,
);
router.post("/theme/publish", can("approve"), controller.publishTheme);

// Navigation
router.get("/navigation", can("view"), controller.getNavigation);
router.put(
  "/navigation/draft",
  can("edit"),
  validator.validateNavDraft,
  controller.saveNavDraft,
);
router.post("/navigation/publish", can("approve"), controller.publishNav);

// Pages
router.get("/pages", can("view"), controller.listPages);
router.put(
  "/pages/draft",
  can("edit"),
  validator.validatePageDraft,
  controller.savePageDraft,
);
router.post("/pages/:pageKey/publish", can("approve"), controller.publishPage);

module.exports = router;
