/**
 * Contacts (V2.2 §6.12) — routes. Mounted at /api/v1/contacts.
 * Permission key: contacts. /segments declared before /:id to avoid clash.
 */

"use strict";

const express = require("express");
const c = require("./contacts.controller");
const v = require("./contacts.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (a) => requirePermission("contacts", a);

// Segments (brand-scoped)
router.get("/segments", can("view"), c.listSegments);
router.post(
  "/segments",
  can("create"),
  v.validateSegmentCreate,
  c.createSegment,
);
router.get("/segments/:segId", can("view"), c.getSegment);
router.patch(
  "/segments/:segId",
  can("edit"),
  v.validateSegmentUpdate,
  c.updateSegment,
);
router.delete("/segments/:segId", can("delete"), c.deleteSegment);

// Contacts (global)
router.get("/", can("view"), c.list);
router.post("/", can("create"), v.validateCreate, c.create);
router.get("/:id", can("view"), c.getById);
router.patch("/:id", can("edit"), v.validateUpdate, c.update);
router.delete("/:id", can("delete"), c.remove);

// Contacts 360 — unified cross-module activity feed + header roll-up.
router.get("/:id/timeline", can("view"), c.getTimeline);
router.get("/:id/summary", can("view"), c.getSummary);

// Addresses (under a contact)
router.get("/:id/addresses", can("view"), c.listAddresses);
router.post(
  "/:id/addresses",
  can("edit"),
  v.validateAddressCreate,
  c.addAddress,
);
router.patch(
  "/:id/addresses/:addressId",
  can("edit"),
  v.validateAddressUpdate,
  c.updateAddress,
);
router.delete("/:id/addresses/:addressId", can("edit"), c.deleteAddress);

module.exports = router;
