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
router.get("/products/:id", can("view"), c.getProduct);
router.patch(
  "/products/:id",
  can("edit"),
  v.validateProductUpdate,
  c.updateProduct,
);
router.delete("/products/:id", can("delete"), c.deleteProduct);

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

// Collections (+ rules + members)
router.get("/collections", can("view"), c.listCollections);
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
  "/collections/:colId/members/:productId",
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
