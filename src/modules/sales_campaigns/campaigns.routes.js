/**
 * Sales Campaigns & Landing Pages (V2.2 §6.22)
 *
 * Module: sales_campaigns   Permission key: sales_campaigns
 * Mounted at /api/v1/sales-campaigns (auth + brand-context applied upstream).
 *
 * Backing tables: sales_campaigns, sales_campaign_products,
 *                 sales_campaign_signups, sales_campaign_metrics
 */

"use strict";

const express = require("express");
const multer = require("multer");
const controller = require("./campaigns.controller");
const v2 = require("./campaigns.v2.controller");
const validator = require("./campaigns.validator");
const { requirePermission } = require("../../middleware/rbac");
const { config } = require("../../config/env");

const router = express.Router();

// In-memory upload for landing hero / look-book images → storage.service.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (config.MEDIA_MAX_FILE_SIZE_MB || 10) * 1024 * 1024 },
});

// ── v2: Bundles (catalogue-level) ──────────────────────────
router.get(
  "/catalogue-bundles",
  requirePermission("sales_campaigns", "view"),
  v2.listCatalogueBundleSources,
);
router.get(
  "/bundles",
  requirePermission("sales_campaigns", "view"),
  v2.listBundles,
);
router.post(
  "/bundles",
  requirePermission("sales_campaigns", "create"),
  validator.validateBundleCreate,
  v2.createBundle,
);
router.get(
  "/bundles/:id",
  requirePermission("sales_campaigns", "view"),
  v2.getBundle,
);
router.patch(
  "/bundles/:id",
  requirePermission("sales_campaigns", "edit"),
  validator.validateBundleUpdate,
  v2.updateBundle,
);
router.delete(
  "/bundles/:id",
  requirePermission("sales_campaigns", "delete"),
  v2.archiveBundle,
);
router.post(
  "/bundles/:id/duplicate",
  requirePermission("sales_campaigns", "create"),
  validator.validateDuplicateBundle,
  v2.duplicateBundleHandler,
);
router.post(
  "/bundles/:id/items",
  requirePermission("sales_campaigns", "edit"),
  validator.validateBundleItem,
  v2.addBundleItem,
);
router.delete(
  "/bundles/:id/items/:itemId",
  requirePermission("sales_campaigns", "edit"),
  v2.removeBundleItem,
);
router.patch(
  "/bundles/:id/reorder",
  requirePermission("sales_campaigns", "edit"),
  v2.reorderBundleItems,
);

// ── v2: Ambassadors (CRM-level) ─────────────────────────────
router.get(
  "/ambassadors",
  requirePermission("sales_campaigns", "view"),
  v2.listAmbassadorContacts,
);
router.post(
  "/ambassadors/:contactId/promote",
  requirePermission("sales_campaigns", "edit"),
  v2.promoteContact,
);
router.delete(
  "/ambassadors/:contactId",
  requirePermission("sales_campaigns", "edit"),
  v2.demoteContact,
);

// ── Collection ─────────────────────────────────────────────
router.get("/", requirePermission("sales_campaigns", "view"), controller.list);
router.post(
  "/",
  requirePermission("sales_campaigns", "create"),
  validator.validateCreate,
  controller.create,
);

// ── Single campaign ────────────────────────────────────────
router.get(
  "/:id",
  requirePermission("sales_campaigns", "view"),
  controller.getById,
);
router.patch(
  "/:id",
  requirePermission("sales_campaigns", "edit"),
  validator.validateUpdate,
  controller.update,
);
router.delete(
  "/:id",
  requirePermission("sales_campaigns", "delete"),
  controller.archive,
);

// ── Lifecycle transitions ──────────────────────────────────
router.post(
  "/:id/submit",
  requirePermission("sales_campaigns", "edit"),
  validator.validateTransition,
  controller.submit,
);
router.post(
  "/:id/approve",
  requirePermission("sales_campaigns", "approve"),
  validator.validateTransition,
  controller.approve,
);
router.post(
  "/:id/reject",
  requirePermission("sales_campaigns", "approve"),
  validator.validateTransition,
  controller.reject,
);
router.post(
  "/:id/launch",
  requirePermission("sales_campaigns", "edit"),
  controller.launch,
);
router.post(
  "/:id/pause",
  requirePermission("sales_campaigns", "edit"),
  controller.pause,
);
router.post(
  "/:id/resume",
  requirePermission("sales_campaigns", "edit"),
  controller.resume,
);
router.post(
  "/:id/end",
  requirePermission("sales_campaigns", "edit"),
  controller.end,
);
router.post(
  "/:id/duplicate",
  requirePermission("sales_campaigns", "create"),
  validator.validateDuplicate,
  controller.duplicate,
);

// ── Products (include / exclude) ───────────────────────────
router.get(
  "/:id/products",
  requirePermission("sales_campaigns", "view"),
  controller.listProducts,
);
router.post(
  "/:id/products",
  requirePermission("sales_campaigns", "edit"),
  validator.validateAddProduct,
  controller.addProduct,
);
router.post(
  "/:id/products/batch",
  requirePermission("sales_campaigns", "edit"),
  validator.validateBatchAddProducts,
  controller.addProductsBatch,
);
router.patch(
  "/:id/products/:linkId",
  requirePermission("sales_campaigns", "edit"),
  validator.validateUpdateProduct,
  controller.updateProduct,
);
router.delete(
  "/:id/products/:linkId",
  requirePermission("sales_campaigns", "edit"),
  controller.removeProduct,
);

// ── Landing page ───────────────────────────────────────────
router.post(
  "/:id/upload-image",
  requirePermission("sales_campaigns", "edit"),
  imageUpload.single("file"),
  controller.uploadImage,
);
router.get(
  "/:id/landing",
  requirePermission("sales_campaigns", "view"),
  controller.getLanding,
);
router.patch(
  "/:id/landing",
  requirePermission("sales_campaigns", "edit"),
  validator.validateLanding,
  controller.updateLanding,
);
router.get(
  "/:id/preview",
  requirePermission("sales_campaigns", "view"),
  controller.preview,
);
router.get(
  "/:id/share-kit",
  requirePermission("sales_campaigns", "view"),
  controller.shareKit,
);

// ── Signups & analytics ────────────────────────────────────
router.get(
  "/:id/signups",
  requirePermission("sales_campaigns", "view"),
  controller.listSignups,
);
router.get(
  "/:id/metrics",
  requirePermission("sales_campaigns", "view"),
  controller.metrics,
);
router.get(
  "/:id/metrics/daily",
  requirePermission("sales_campaigns", "view"),
  controller.dailyMetrics,
);
router.get(
  "/:id/report",
  requirePermission("sales_campaigns", "view"),
  controller.report,
);

// ── v2: Campaign-scoped bundles, tiers, upsells, ambassadors ──
router.get(
  "/:id/bundles",
  requirePermission("sales_campaigns", "view"),
  v2.listCampaignBundles,
);
router.post(
  "/:id/bundles",
  requirePermission("sales_campaigns", "edit"),
  validator.validateAttachBundle,
  v2.attachCampaignBundle,
);
router.post(
  "/:id/bundles/clone",
  requirePermission("sales_campaigns", "edit"),
  validator.validateCloneBundles,
  v2.cloneBundles,
);
router.post(
  "/:id/bundles/import",
  requirePermission("sales_campaigns", "edit"),
  validator.validateImportCatalogueBundle,
  v2.importCatalogueBundle,
);
router.delete(
  "/:id/bundles/:linkId",
  requirePermission("sales_campaigns", "edit"),
  v2.detachCampaignBundle,
);

router.get(
  "/:id/tiers",
  requirePermission("sales_campaigns", "view"),
  v2.listTiers,
);
router.post(
  "/:id/tiers",
  requirePermission("sales_campaigns", "edit"),
  validator.validateTier,
  v2.upsertTier,
);
router.delete(
  "/:id/tiers/:tierId",
  requirePermission("sales_campaigns", "edit"),
  v2.deleteTier,
);

router.get(
  "/:id/upsells",
  requirePermission("sales_campaigns", "view"),
  v2.listUpsells,
);
router.post(
  "/:id/upsells",
  requirePermission("sales_campaigns", "edit"),
  validator.validateUpsell,
  v2.upsertUpsell,
);
router.delete(
  "/:id/upsells/:upsellId",
  requirePermission("sales_campaigns", "edit"),
  v2.deleteUpsell,
);

router.get(
  "/:id/ambassadors",
  requirePermission("sales_campaigns", "view"),
  v2.listCampaignAmbassadors,
);
router.post(
  "/:id/ambassadors",
  requirePermission("sales_campaigns", "edit"),
  validator.validateAttachAmbassador,
  v2.attachAmbassador,
);
router.delete(
  "/:id/ambassadors/:linkId",
  requirePermission("sales_campaigns", "edit"),
  v2.detachAmbassador,
);

// ── v2: Praxis assist ──────────────────────────────────────
router.post(
  "/:id/praxis/draft-copy",
  requirePermission("sales_campaigns", "edit"),
  validator.validatePraxisDraftCopy,
  v2.praxisDraftCopy,
);
router.post(
  "/:id/praxis/suggest-layout",
  requirePermission("sales_campaigns", "edit"),
  validator.validatePraxisSuggestLayout,
  v2.praxisSuggestLayout,
);
router.post(
  "/:id/praxis/suggest-pricing",
  requirePermission("sales_campaigns", "edit"),
  validator.validatePraxisSuggestPricing,
  v2.praxisSuggestPricing,
);
router.post(
  "/:id/praxis/dry-run-pricing",
  requirePermission("sales_campaigns", "view"),
  validator.validatePraxisDryRun,
  v2.praxisDryRunPricing,
);
router.post(
  "/:id/praxis/analytics-qna",
  requirePermission("sales_campaigns", "view"),
  validator.validatePraxisQna,
  v2.praxisAnalyticsQna,
);
router.get(
  "/:id/praxis/daily-briefing",
  requirePermission("sales_campaigns", "view"),
  v2.praxisDailyBriefing,
);
router.post(
  "/:id/praxis/accept",
  requirePermission("sales_campaigns", "edit"),
  validator.validatePraxisAccept,
  v2.praxisAccept,
);

// ── v2: VIP grants ─────────────────────────────────────────
router.get(
  "/:id/vip-grants",
  requirePermission("sales_campaigns", "view"),
  v2.listVipGrants,
);
router.post(
  "/:id/vip-grants",
  requirePermission("sales_campaigns", "edit"),
  validator.validateVipGrant,
  v2.grantVip,
);
router.patch(
  "/:id/vip-grants/:grantId",
  requirePermission("sales_campaigns", "edit"),
  validator.validateVipGiftStatus,
  v2.updateGiftStatus,
);

module.exports = router;
