/**
 * Audit log (V2.2 §3) — routes. Mounted at /api/v1/audit. Permission key:
 * audit. Read-only: list/filter, single entry, and the full trail for a
 * specific record. Writes are produced by the audit() middleware.
 */

"use strict";

const express = require("express");
const c = require("./audit.controller");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("audit", action);

// Literal segments before /:id.
router.get("/record/:table_name/:record_id", can("view"), c.forRecord);
router.get("/", can("view"), c.list);
router.get("/:id", can("view"), c.getById);

module.exports = router;
