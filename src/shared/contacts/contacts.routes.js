/**
 * Contacts (V2.2 §6.12) — routes. Mounted at /api/v1/contacts.
 * Permission key: contacts. /segments declared before /:id to avoid clash.
 */

"use strict";

const express = require("express");
const c = require("./contacts.controller");
const v = require("./contacts.validator");
const { requirePermission } = require("../../middleware/rbac");
const { NotFoundError } = require("../../utils/errors");

const router = express.Router();
const can = (a) => requirePermission("contacts", a);

// Any :id that isn't a UUID → clean 404 (avoids a 500 from a bad uuid cast).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.param("id", (req, res, next, val) => {
  if (!UUID_RE.test(val)) return next(new NotFoundError("Contact"));
  next();
});

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
// Literal — declared before /:id so "milestones"/"stats" aren't captured as ids.
router.get("/milestones", can("view"), c.milestones);
router.get("/stats", can("view"), c.stats);
router.get("/:id", can("view"), c.getById);
router.patch("/:id", can("edit"), v.validateUpdate, c.update);
router.delete("/:id", can("delete"), c.remove);

// Contacts 360 — unified cross-module activity feed + header roll-up.
router.get("/:id/timeline", can("view"), c.getTimeline);
router.get("/:id/summary", can("view"), c.getSummary);

// Tags (brand-scoped, under a contact)
router.get("/:id/tags", can("view"), c.listTags);
router.post("/:id/tags", can("edit"), v.validateTagCreate, c.addTag);
router.delete("/:id/tags/:tagId", can("edit"), c.removeTag);

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
