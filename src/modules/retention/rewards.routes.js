/**
 * Loyalty rewards catalogue (Module 6.23) — authenticated routes.
 * Mounted at /api/v1/retention/rewards. Permission key: retention.
 */

"use strict";

const express = require("express");
const controller = require("./rewards.controller");
const validator = require("./rewards.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("retention", action);

router.get("/", can("view"), controller.listAll);
router.get("/catalogue", can("view"), controller.listCatalogue);
router.post("/", can("create"), validator.validateCreate, controller.create);
router.patch("/:id", can("edit"), validator.validateUpdate, controller.update);
router.post("/redeem", can("edit"), validator.validateRedeem, controller.redeem);

module.exports = router;
