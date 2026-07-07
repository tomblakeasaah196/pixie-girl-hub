/**
 * Help Center — routes. Mounted at /api/v1/help.
 *
 * Permission key: help_center. Articles + categories are DB-driven so a
 * non-developer can edit copy live via the in-app Help Editor. Saving an
 * article re-syncs it into ai_knowledge_chunks, so Praxis stays grounded
 * in the same body the user reads.
 *
 * Read paths need `view`; the editor paths need `create` / `edit`.
 */

"use strict";

const express = require("express");
const c = require("./help-center.controller");
const v = require("./help-center.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("help_center", action);

// ── Admin / editor (declared before ":slug" so literals aren't shadowed) ──
router.get("/admin/articles", can("edit"), c.listArticlesAdmin);
router.get("/admin/articles/:id", can("edit"), c.getArticleForEdit);
router.get("/admin/categories", can("edit"), c.listCategoriesAdmin);

router.post("/articles", can("create"), v.validateArticleCreate, c.createArticle);
router.patch(
  "/articles/:id",
  can("edit"),
  v.validateArticleUpdate,
  c.updateArticle,
);
router.delete("/articles/:id", can("delete"), c.retireArticle);

router.post(
  "/categories",
  can("create"),
  v.validateCategoryCreate,
  c.createCategory,
);
router.patch(
  "/categories/:id",
  can("edit"),
  v.validateCategoryUpdate,
  c.updateCategory,
);

// ── Public (read) ────────────────────────────────────────
router.get("/categories", can("view"), c.listCategories);
router.get("/articles", can("view"), c.listArticles);
router.get("/articles/:slug", can("view"), c.getArticle);

module.exports = router;
