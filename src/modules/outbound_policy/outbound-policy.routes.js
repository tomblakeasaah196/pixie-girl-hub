"use strict";

const express = require("express");
const c = require("./outbound-policy.controller");
const v = require("./outbound-policy.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("outbound_policy", action);

router.get("/", can("view"), c.listPolicies);
router.get("/resolve", can("view"), c.resolveChannel);
router.get("/:event_key", can("view"), c.getPolicy);
router.put("/", can("edit"), v.validateUpsert, c.upsertPolicy);

module.exports = router;
