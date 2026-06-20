/**
 * E-Commerce Storefront & Channel Sync (V2.2 §6.4) — authenticated routes.
 * Mounted at /api/v1/storefront. Permission key: storefront. Admin-side
 * catalogue preview (the public storefront + analytics + order-form +
 * install-hub live under /api/public). Brand resolves from req.brand.
 *
 * Side-effect: register order.paid → loyalty/streak is handled by the
 * retention module; nothing to register here.
 */

"use strict";

const express = require("express");
const controller = require("./storefront.controller");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("storefront", action);

// Admin preview of the published storefront catalogue.
router.get("/products", can("view"), controller.listProducts);
router.get("/products/:slug", can("view"), controller.getProduct);
router.get("/categories", can("view"), controller.listCategories);
router.get("/bundles", can("view"), controller.listBundles);
router.get("/collections/:slug", can("view"), controller.getCollection);

module.exports = router;
