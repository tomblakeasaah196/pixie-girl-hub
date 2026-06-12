/**
 * Coupon engine (F-3 / PD §6.23.2) — authenticated routes. Mounted under
 * /api/v1/retention/coupons. Permission key: retention.
 */

"use strict";

const express = require("express");
const controller = require("./coupon.controller");
const validator = require("./coupon.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("retention", action);

router.get("/", can("view"), controller.list);
router.post("/", can("create"), validator.validateCreate, controller.create);
router.post(
  "/validate",
  can("view"),
  validator.validateCheck,
  controller.check,
);
router.get("/:id", can("view"), controller.getOne);
router.patch("/:id", can("edit"), validator.validateUpdate, controller.update);
router.patch(
  "/:id/active",
  can("edit"),
  validator.validateActive,
  controller.setActive,
);

module.exports = router;
