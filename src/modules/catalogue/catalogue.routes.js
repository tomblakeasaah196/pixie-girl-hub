/**
 * Catalogue (V2.2 §6.4/§6.9) — routes. Mounted at /api/v1/catalogue.
 * Permission key: catalogue. Paths are namespaced (/categories, /products)
 * to avoid param collisions.
 */

"use strict";

const express = require("express");
const multer = require("multer");
const c = require("./catalogue.controller");
const v = require("./catalogue.validator");
const vault = require("./cost_vault.controller");
const vaultV = require("./cost_vault.validator");
const styled = require("./styled.controller");
const styledV = require("./styled.validator");
const styledVar = require("./styled_variants.controller");
const styledVarV = require("./styled_variants.validator");
const usdReprice = require("./usd-reprice.controller");
const usdRepriceV = require("./usd-reprice.validator");
const { config } = require("../../config/env");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (a) => requirePermission("catalogue", a);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MEDIA_MAX_FILE_SIZE_MB * 1024 * 1024 },
});

// Categories
router.get("/categories", can("view"), c.listCategories);
router.post(
  "/categories",
  can("create"),
  v.validateCategoryCreate,
  c.createCategory,
);
router.get("/categories/:catId", can("view"), c.getCategory);
router.patch(
  "/categories/:catId",
  can("edit"),
  v.validateCategoryUpdate,
  c.updateCategory,
);
router.delete("/categories/:catId", can("delete"), c.archiveCategory);

// Products
router.get("/products", can("view"), c.listProducts);
router.post(
  "/products",
  can("create"),
  v.validateProductCreate,
  c.createProduct,
);
// Bulk import (Excel/CSV → catalogue). Literal segment declared before :id so
// it is never shadowed by the param route. Codes are auto-generated server-side.
router.post(
  "/products/bulk-import",
  can("create"),
  v.validateBulkImport,
  c.bulkImportProducts,
);
// Trash bin — soft-deleted products available to restore. Literal segment
// declared before :id so it is never shadowed by the param route.
router.get("/products/trash", can("view"), c.listTrash);
router.get("/products/:id", can("view"), c.getProduct);
router.patch(
  "/products/:id",
  can("edit"),
  v.validateProductUpdate,
  c.updateProduct,
);
router.delete("/products/:id", can("delete"), c.deleteProduct);
// Restore a soft-deleted product (frees-name model — see 000041).
router.post("/products/:id/restore", can("edit"), c.restoreProduct);

// Variants (under a product)
router.get("/products/:id/variants", can("view"), c.listVariants);
router.post(
  "/products/:id/variants",
  can("create"),
  v.validateVariantCreate,
  c.addVariant,
);
router.patch(
  "/products/:id/variants/:variantId",
  can("edit"),
  v.validateVariantUpdate,
  c.updateVariant,
);
router.delete(
  "/products/:id/variants/:variantId",
  can("delete"),
  c.removeVariant,
);

// ── Cost Vault (P0-1) ────────────────────────────────────
// Read/write a variant's TRUE cost + supplier. Service enforces vault
// access (owner is_ceo or a live shared.cost_vault_grants row); every
// access is audited as sensitive. Cost is AES-256-GCM encrypted at rest.
router.get(
  "/products/:id/variants/:variantId/cost",
  can("view"),
  vault.getCost,
);
router.put(
  "/products/:id/variants/:variantId/cost",
  can("edit"),
  vaultV.validateCostSet,
  vault.setCost,
);
// Self access check — any catalogue user; returns only a boolean so the UI
// can decide whether to render the cost section (no data leak).
router.get("/cost-vault/access", can("view"), vault.myAccess);
// Vault access grants — OWNER ONLY (enforced in the service via is_ceo).
router.get("/cost-vault/grants", can("view"), vault.listGrants);
router.post(
  "/cost-vault/grants",
  can("view"),
  vaultV.validateGrantCreate,
  vault.grantAccess,
);
router.delete(
  "/cost-vault/grants/:userId",
  can("view"),
  vaultV.validateGrantRevoke,
  vault.revokeAccess,
);

// ── Styled products (P0-6) — storefront skins over a base ─
router.get("/styled-products", can("view"), styled.list);
// Brand-wide size-tier ladder + head-size guide (the "Size & Guide" modal).
// Literal segments declared before :id so they are never shadowed.
router.get(
  "/styled-products/size-config",
  can("view"),
  styledVar.getSizeConfig,
);
router.put(
  "/styled-products/size-config",
  can("edit"),
  styledVarV.validateSizeConfig,
  styledVar.saveSizeConfig,
);

// ── USD pricing: bulk "Apply exchange rate" tool (Catalogue → Config) ──
// One NGN-per-USD rate recomputes every USD price from its NGN value; the run
// is snapshotted so it can be undone. Reads are view; writes are edit.
router.get("/usd-pricing", can("view"), usdReprice.status);
router.get("/usd-pricing/market-rate", can("view"), usdReprice.marketRate);
router.post(
  "/usd-pricing/preview",
  can("edit"),
  usdRepriceV.validatePreview,
  usdReprice.preview,
);
router.post(
  "/usd-pricing/apply",
  can("edit"),
  usdRepriceV.validateApply,
  usdReprice.apply,
);
router.post("/usd-pricing/undo", can("edit"), usdReprice.undo);
// Import / export engine (PR-B): multi-sheet .xlsx (styled + colours +
// reference). Literal segments before :id so they're never shadowed.
router.get("/styled-products/import-template", can("view"), c.styledTemplate);
router.get("/styled-products/export", can("view"), c.exportStyled);
router.post(
  "/styled-products/import",
  can("create"),
  upload.single("file"),
  c.importStyled,
);
// Trash bin — soft-deleted styled products available to restore.
router.get("/styled-products/trash", can("view"), styled.listTrash);
// AI draft (P0-8: only ever creates a DRAFT; gated by the products_ai_drafting
// feature in the service). Literal segment declared before :id.
router.post(
  "/styled-products/ai-draft",
  can("create"),
  styledV.validateAiDraft,
  styled.aiDraft,
);
router.post(
  "/styled-products",
  can("create"),
  styledV.validateStyledCreate,
  styled.create,
);
router.get("/styled-products/:id", can("view"), styled.getOne);
router.patch(
  "/styled-products/:id",
  can("edit"),
  styledV.validateStyledUpdate,
  styled.update,
);
// Restore a soft-deleted styled product.
router.post("/styled-products/:id/restore", can("edit"), styled.restore);
// Promote draft → live, and the reverse — both gated by catalogue.publish
// (the "Ops can publish" rule; Sales/Marketing edit drafts but can't publish).
router.post("/styled-products/:id/publish", can("publish"), styled.publish);
router.post(
  "/styled-products/:id/unpublish",
  can("publish"),
  styledV.validateUnpublish,
  styled.unpublish,
);
router.delete("/styled-products/:id", can("delete"), styled.remove);

// Per-product Trash bin — soft-deleted colours + variants (with purge dates).
// Literal 'trash' declared before the param-bearing colour/variant routes.
router.get("/styled-products/:id/trash", can("view"), styledVar.listTrash);

// ── Styled colours (each colour owns its pictures + optional video) ──
router.get("/styled-products/:id/colours", can("view"), styledVar.listColours);
router.post(
  "/styled-products/:id/colours",
  can("edit"),
  styledVarV.validateColourCreate,
  styledVar.createColour,
);
router.patch(
  "/styled-products/:id/colours/:colourId",
  can("edit"),
  styledVarV.validateColourUpdate,
  styledVar.updateColour,
);
router.delete(
  "/styled-products/:id/colours/:colourId",
  can("edit"),
  styledVar.deleteColour,
);
// Restore a soft-deleted colour (brings back the variants trashed with it).
router.post(
  "/styled-products/:id/colours/:colourId/restore",
  can("edit"),
  styledVar.restoreColour,
);
// Per-colour images (gallery per colour/variant; 2–3 min, capped in service).
// Literal 'images' before :imageId.
router.get(
  "/styled-products/:id/colours/:colourId/images",
  can("view"),
  styledVar.listColourImages,
);
router.post(
  "/styled-products/:id/colours/:colourId/images",
  can("edit"),
  upload.single("file"),
  v.validateImageMeta,
  styledVar.addColourImage,
);
router.delete(
  "/styled-products/:id/colours/:colourId/images/:imageId",
  can("edit"),
  styledVar.removeColourImage,
);

// ── Styled colour × size variants ────────────────────────
router.get(
  "/styled-products/:id/variants",
  can("view"),
  styledVar.listVariants,
);
// Bulk-generate the colour × size matrix ("all sizes" or a picked subset).
// Literal 'bulk' declared before the :variantId param route.
router.post(
  "/styled-products/:id/variants/bulk",
  can("edit"),
  styledVarV.validateVariantBulkCreate,
  styledVar.bulkCreateVariants,
);
router.patch(
  "/styled-products/:id/variants/:variantId",
  can("edit"),
  styledVarV.validateVariantUpdate,
  styledVar.updateVariant,
);
router.delete(
  "/styled-products/:id/variants/:variantId",
  can("edit"),
  styledVar.deleteVariant,
);
// Restore a soft-deleted variant (refused if its combo/SKU was re-used live).
router.post(
  "/styled-products/:id/variants/:variantId/restore",
  can("edit"),
  styledVar.restoreVariant,
);

// Collections (+ rules + members)
router.get("/collections", can("view"), c.listCollections);
// Import / export (single sheet, created independently). Literal segments
// before :colId so they're never shadowed.
router.get("/collections/import-template", can("view"), c.collectionsTemplate);
router.get("/collections/export", can("view"), c.exportCollections);
router.post(
  "/collections/import",
  can("create"),
  upload.single("file"),
  c.importCollections,
);
// Bundle import/export surfaced here for the catalogue UI; gated by retention.
router.get(
  "/bundles/import-template",
  requirePermission("retention", "view"),
  c.bundlesTemplate,
);
router.get(
  "/bundles/export",
  requirePermission("retention", "view"),
  c.exportBundles,
);
router.post(
  "/bundles/import",
  requirePermission("retention", "create"),
  upload.single("file"),
  c.importBundles,
);
router.post(
  "/collections",
  can("create"),
  v.validateCollectionCreate,
  c.createCollection,
);
router.get("/collections/:colId", can("view"), c.getCollection);
router.patch(
  "/collections/:colId",
  can("edit"),
  v.validateCollectionUpdate,
  c.updateCollection,
);
router.delete("/collections/:colId", can("delete"), c.archiveCollection);
router.post(
  "/collections/:colId/rules",
  can("edit"),
  v.validateCollectionRule,
  c.addCollectionRule,
);
router.delete(
  "/collections/:colId/rules/:ruleId",
  can("edit"),
  c.removeCollectionRule,
);
router.post(
  "/collections/:colId/members",
  can("edit"),
  v.validateCollectionMember,
  c.addCollectionMember,
);
router.delete(
  "/collections/:colId/members/:styledId",
  can("edit"),
  c.removeCollectionMember,
);

// Product images (multipart upload → Documents gateway)
router.get("/products/:id/images", can("view"), c.listImages);
router.post(
  "/products/:id/images",
  can("edit"),
  upload.single("file"),
  v.validateImageMeta,
  c.addImage,
);
router.patch(
  "/products/:id/images/:imageId",
  can("edit"),
  v.validateImageUpdate,
  c.updateImage,
);
router.delete("/products/:id/images/:imageId", can("edit"), c.removeImage);

// Generic cover-image upload for collections/bundles (compress → store → url).
// The caller saves the returned cdn_url onto the entity's hero_image_url.
router.post(
  "/cover-image",
  can("edit"),
  upload.single("file"),
  c.uploadCoverImage,
);

// Self-hosted media upload → stored + queued for FFmpeg processing (W-13).
router.post("/media", can("edit"), upload.single("file"), c.uploadMedia);

// Product videos
router.get("/products/:id/videos", can("view"), c.listVideos);
// Self-hosted UGC video library + attach (W-13). Literal segment before :videoId.
router.get("/products/:id/video-library", can("view"), c.listMediaVideoLibrary);
router.post(
  "/products/:id/videos/from-media",
  can("edit"),
  v.validateVideoFromMedia,
  c.attachVideoFromMedia,
);
router.post(
  "/products/:id/videos",
  can("edit"),
  v.validateVideoCreate,
  c.addVideo,
);
router.delete("/products/:id/videos/:videoId", can("edit"), c.removeVideo);

// Product SEO (1:1)
router.get("/products/:id/seo", can("view"), c.getSeo);
router.put("/products/:id/seo", can("edit"), v.validateSeoUpsert, c.upsertSeo);

// Product custom attribute values
router.get("/products/:id/attributes", can("view"), c.listAttributeValues);
router.put(
  "/products/:id/attributes",
  can("edit"),
  v.validateAttributeValue,
  c.setAttributeValue,
);
router.delete(
  "/products/:id/attributes/:fieldId",
  can("edit"),
  c.removeAttributeValue,
);

// Related products (cross-sell)
router.get("/products/:id/related", can("view"), c.listRelated);
router.post(
  "/products/:id/related",
  can("edit"),
  v.validateRelatedCreate,
  c.addRelated,
);
router.delete("/products/:id/related/:pairId", can("edit"), c.removeRelated);

module.exports = router;
