"use strict";

const express = require("express");
const c = require("./messaging-accounts.controller");
const v = require("./messaging-accounts.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("messaging_accounts", action);

router.get("/", can("view"), c.listAccounts);
router.post("/", can("create"), v.validateUpsert, c.upsertAccount);
router.get("/:id", can("view"), c.getAccount);
router.post("/:id/active", can("edit"), v.validateSetActive, c.setActive);
router.post("/:id/test", can("view"), c.testAccount);
router.delete("/:id", can("delete"), c.removeAccount);

module.exports = router;
