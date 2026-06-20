/**
 * Service Catalogue — routes. Mounted at /api/v1/service-catalogue.
 */

"use strict";

const express = require("express");
const multer = require("multer");
const c = require("./service-catalogue.controller");
const v = require("./service-catalogue.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("service_catalogue", action);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Import/export (literal segments before :id so they're never shadowed).
router.get("/import-template", can("view"), c.importTemplate);
router.get("/export", can("view"), c.exportServices);
router.post("/import", can("create"), upload.single("file"), c.importServices);

router.get("/", can("view"), c.listServices);
router.post("/", can("create"), v.validateCreateService, c.createService);
router.get("/:id", can("view"), c.getService);
router.patch("/:id", can("edit"), v.validateUpdateService, c.updateService);
router.delete("/:id", can("delete"), c.deleteService);

module.exports = router;
