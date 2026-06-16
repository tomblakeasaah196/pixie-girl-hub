/**
 * Factory i18n — routes (mounted at /api/v1/factory-i18n).
 *
 * Read endpoints are open to any authenticated user.
 * Write endpoints require platform_settings edit permission.
 */

"use strict";

const router = require("express").Router();
const ctrl = require("./factory-i18n.controller");
const { requirePermission } = require("../../middleware/rbac");

// GET /factory-i18n — language list (without translations); for the selector.
router.get("/", ctrl.listLanguages);

// GET /factory-i18n/with-translations — all active languages + bundles; for i18next boot.
router.get("/with-translations", ctrl.listAllWithTranslations);

// GET /factory-i18n/:code — single language with translations.
router.get("/:code", ctrl.getOne);

// POST /factory-i18n — add a new locale.
router.post("/", requirePermission("platform_settings", "edit"), ctrl.create);

// PATCH /factory-i18n/:code — update display_name / is_active.
router.patch("/:code", requirePermission("platform_settings", "edit"), ctrl.patchOne);

// DELETE /factory-i18n/:code — remove a locale (cannot delete 'en').
router.delete("/:code", requirePermission("platform_settings", "edit"), ctrl.deleteOne);

module.exports = router;
