/**
 * WhatsApp Templates — routes. Mounted at /api/v1/whatsapp-templates.
 *
 * Gated by the `messaging_accounts` permission key: these live under
 * the same Messaging settings surface where a brand's WhatsApp / IG /
 * FB / email keys are configured, so no new RBAC module is introduced.
 * Managing approved templates is a CEO/admin config task, same as
 * rotating the WhatsApp token next to it.
 */

"use strict";

const express = require("express");
const c = require("./whatsapp-templates.controller");
const v = require("./whatsapp-templates.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("messaging_accounts", action);

// ── Category rates (cost per send) ─────────────────────────
router.get("/rates", can("view"), c.listRates);
router.put("/rates", can("edit"), v.validateRate, c.setRate);

// ── Templates ──────────────────────────────────────────────
router.get("/", can("view"), c.list);
router.post("/sync", can("edit"), c.sync);
router.post("/", can("create"), v.validateCreate, c.create);
router.patch("/:id", can("edit"), v.validateUpdate, c.update);
router.post("/:id/submit", can("edit"), c.submit);
router.delete("/:id", can("delete"), c.remove);

module.exports = router;
