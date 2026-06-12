/**
 * Automated retention workflows (F-4 / PD §6.23) — authenticated routes.
 * Mounted under /api/v1/retention/workflows. Permission key: retention.
 */

"use strict";

const express = require("express");
const controller = require("./workflow.controller");
const validator = require("./workflow.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("retention", action);

router.get("/", can("view"), controller.list);
router.post("/", can("create"), validator.validateCreate, controller.create);
router.post(
  "/trigger",
  can("approve"),
  validator.validateTrigger,
  controller.trigger,
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
