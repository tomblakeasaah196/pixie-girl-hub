/**
 * Bundle offers (F-2 / PD §6.23.4) — authenticated routes. Mounted under
 * /api/v1/retention/bundles. Permission key: retention.
 */

"use strict";

const express = require("express");
const controller = require("./bundle.controller");
const validator = require("./bundle.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("retention", action);

router.get("/", can("view"), controller.list);
router.post("/", can("create"), validator.validateCreate, controller.create);

// Collage covers — static paths declared before "/:id" so they never bind as
// an :id. Curated font list, and the restyle-all batch action.
router.get("/collage/fonts", can("view"), controller.collageFonts);
router.post(
  "/collage/apply-all",
  can("edit"),
  validator.validateCollageApplyAll,
  controller.applyCollageAll,
);

router.get("/:id", can("view"), controller.getOne);
router.patch("/:id", can("edit"), validator.validateUpdate, controller.update);
router.patch(
  "/:id/active",
  can("edit"),
  validator.validateActive,
  controller.setActive,
);
router.post(
  "/:id/price",
  can("view"),
  validator.validatePrice,
  controller.price,
);
router.post(
  "/:id/components",
  can("edit"),
  validator.validateComponent,
  controller.addComponent,
);
router.delete(
  "/:id/components/:componentId",
  can("edit"),
  controller.removeComponent,
);
router.post(
  "/:id/collage-cover",
  can("edit"),
  validator.validateCollageGenerate,
  controller.generateCollage,
);
router.delete("/:id", can("delete"), controller.remove);

module.exports = router;
