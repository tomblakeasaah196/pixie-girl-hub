/**
 * Service Catalogue — routes. Mounted at /api/v1/service-catalogue.
 */

"use strict";

const express = require("express");
const c = require("./service-catalogue.controller");
const v = require("./service-catalogue.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("service_catalogue", action);

router.get("/", can("view"), c.listServices);
router.post("/", can("create"), v.validateCreateService, c.createService);
router.get("/:id", can("view"), c.getService);
router.patch("/:id", can("edit"), v.validateUpdateService, c.updateService);
router.delete("/:id", can("delete"), c.deleteService);

module.exports = router;
