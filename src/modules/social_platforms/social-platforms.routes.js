/**
 * Social platform registry — routes. Mounted at /api/v1/social-platforms.
 * Reuses the `social` permission (this registry only exists to serve the
 * Social Studio Accounts dashboard — same module the Accounts/Board/Team
 * tabs already gate on).
 */

"use strict";

const express = require("express");
const c = require("./social-platforms.controller");
const v = require("./social-platforms.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("social", action);

router.get("/", can("view"), c.listPlatforms);
router.post("/", can("create"), v.validateCreate, c.createPlatform);
router.patch("/:key", can("edit"), v.validateUpdate, c.updatePlatform);
router.post("/:key/active", can("edit"), v.validateSetActive, c.setActive);

module.exports = router;
