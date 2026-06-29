/**
 * Retention analytics (Module 6.23.7) — HTTP controller. req.brand.
 */

"use strict";

const service = require("./analytics.service");

async function overview(req, res) {
  const windowDays = Math.min(365, Math.max(7, parseInt(req.query.window_days, 10) || 90));
  res.json({ data: await service.overview({ brand: req.brand, windowDays }) });
}

module.exports = { overview };
