/**
 * Kaizen health controller. Mounted (behind operator auth) at
 * /api/v1/kaizen/health.
 */

"use strict";

const express = require("express");
const service = require("./health.service");

const router = express.Router();

router.get("/current", async (_req, res) => {
  res.json({ data: await service.current() });
});

router.get("/history", async (req, res) => {
  const component = String(req.query.component || "");
  const hours = Math.min(Number(req.query.hours) || 24, 168);
  if (!component) {
    return res.json({ data: [] });
  }
  res.json({ data: await service.history({ component, hours }) });
});

module.exports = { router };
