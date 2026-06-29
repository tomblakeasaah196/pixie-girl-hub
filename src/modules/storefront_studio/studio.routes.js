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
const multer = require("multer");
const controller = require("./studio.controller");
const validator = require("./studio.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("storefront_studio", action);

// In-memory upload for branding images (logo/favicon/OG). 8MB cap.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

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

// Popups (newsletter / exit-intent / promo / age-gate)
router.get("/popups", can("view"), controller.listPopups);
router.put(
  "/popups/draft",
  can("edit"),
  validator.validatePopupDraft,
  controller.savePopupDraft,
);
router.post(
  "/popups/:popupKey/publish",
  can("approve"),
  controller.publishPopup,
);
router.delete("/popups/:popupKey", can("approve"), controller.deletePopup);

// Branding image upload (logo / favicon / OG) -> returns { url }.
router.post(
  "/upload-image",
  can("edit"),
  imageUpload.single("file"),
  controller.uploadImage,
);

// Section template library for the page composer.
router.get("/section-templates", can("view"), controller.listSectionTemplates);

// Draft preview: mint a token + storefront URL for the embedded/live preview.
router.get("/preview", can("view"), controller.previewInfo);

// Revisions: publish history + one-click rollback (restores to draft).
router.get("/revisions", can("view"), controller.listRevisions);
router.post(
  "/revisions/:revisionId/rollback",
  can("approve"),
  controller.rollbackRevision,
);

module.exports = router;
