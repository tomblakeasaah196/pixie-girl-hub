"use strict";

const express = require("express");
const c = require("./comms-studio.controller");
const v = require("./comms-studio.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("comms_studio", action);

// Everything is CEO-editable settings surface; view is broadly available so
// operators can look up the copy of an automation before writing about it.
router.get("/", can("view"), c.list);
router.post("/preview", can("view"), v.validatePreview, c.preview);
router.get("/:event_key", can("view"), c.get);
router.get("/:event_key/send-log", can("view"), c.sendLog);
router.put("/", can("edit"), v.validateUpdate, c.update);
router.post("/send-test", can("edit"), v.validateSendTest, c.sendTest);

module.exports = router;
