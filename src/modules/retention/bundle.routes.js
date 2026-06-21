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
router.delete("/:id", can("delete"), controller.remove);

module.exports = router;
