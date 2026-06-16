/**
 * Help Center — routes. Mounted at /api/v1/help.
 *
 * Permission key: help_center. Articles + categories are DB-driven so
 * a non-developer can edit copy live (later) and Praxis stays grounded
 * in the same body (mirrored to ai_knowledge_chunks).
 */

"use strict";

const express = require("express");
const c = require("./help-center.controller");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("help_center", action);

router.get("/categories", can("view"), c.listCategories);
router.get("/articles", can("view"), c.listArticles);
router.get("/articles/:slug", can("view"), c.getArticle);

module.exports = router;
