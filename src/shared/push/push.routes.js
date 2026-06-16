"use strict";

const express = require("express");
const controller = require("./push.controller");

const router = express.Router();

// No extra module permission — scoped to the authenticated user.
router.get("/public-key", controller.publicKey);
router.post("/subscribe", controller.subscribe);
router.delete("/subscribe", controller.unsubscribe);

module.exports = router;
