/**
 * Loyalty earn-rules (Module 6.23) — authenticated routes.
 * Mounted at /api/v1/retention/earn-rules. Permission key: retention.
 */

"use strict";

const express = require("express");
const controller = require("./earn.controller");
const validator = require("./earn.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("retention", action);

router.get("/", can("view"), controller.list);
router.post("/", can("create"), validator.validateCreate, controller.create);
router.patch("/:id", can("edit"), validator.validateUpdate, controller.update);

module.exports = router;
