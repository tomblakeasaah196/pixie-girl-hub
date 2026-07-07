/**
 * Kaizen perf controller. Mounted (behind operator auth) at
 * /api/v1/kaizen/perf.
 */

"use strict";

const express = require("express");
const service = require("./perf.service");

const router = express.Router();

router.get("/summary", async (req, res) => {
  const hours = Math.min(Number(req.query.hours) || 24, 168);
  res.json({ data: await service.summary({ hours }) });
});

router.get("/route", async (req, res) => {
  const pattern = String(req.query.pattern || "");
  const hours = Math.min(Number(req.query.hours) || 24, 168);
  if (!pattern) return res.json({ data: [] });
  res.json({ data: await service.route({ pattern, hours }) });
});

module.exports = { router };
