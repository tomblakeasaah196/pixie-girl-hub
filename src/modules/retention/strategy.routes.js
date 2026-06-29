/**
 * Retention strategy engine (Module 6.23) — authenticated routes.
 * Mounted at /api/v1/retention/strategies. Permission key: retention.
 */

"use strict";

const express = require("express");
const controller = require("./strategy.controller");
const validator = require("./strategy.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("retention", action);

// Self-describing catalogue powers the no-code builder UI.
router.get("/catalogue", can("view"), controller.listCatalogue);

router.get("/", can("view"), controller.list);
router.post("/", can("create"), validator.validateCreate, controller.create);
router.post(
  "/from-template",
  can("create"),
  validator.validateFromTemplate,
  controller.fromTemplate,
);
// Manually fire a trigger (testing / custom_event integrations).
router.post("/trigger", can("approve"), validator.validateTrigger, controller.trigger);

router.get("/:id", can("view"), controller.getOne);
router.patch("/:id", can("edit"), validator.validateUpdate, controller.update);
router.patch("/:id/status", can("edit"), validator.validateStatus, controller.setStatus);
router.post("/:id/preview", can("view"), validator.validatePreview, controller.preview);
router.post(
  "/:id/test-send",
  can("edit"),
  validator.validateTestSend,
  controller.testSend,
);
router.get("/:id/enrollments", can("view"), controller.listEnrollments);

module.exports = router;
