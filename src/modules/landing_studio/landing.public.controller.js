/**
 * Landing Studio — PUBLIC controller (no auth).
 *
 * Serves the published brand-level landing config to the public sales
 * subdomain (consumed by the Next.js apps/landing app in PR 2). Brand is
 * resolved by hostBrandResolverMiddleware (Host → brand) or an explicit
 * ?brand= / X-Brand-Context hint used by the admin preview.
 */

"use strict";

const service = require("./landing.service");

function brandHint(req) {
  const h = req.headers["x-brand-context"] || req.query.brand;
  return typeof h === "string" ? h.toLowerCase().trim() : undefined;
}

async function published(req, res) {
  const data = await service.getPublished({
    brand: req.brand || brandHint(req),
  });
  res.json({ data });
}

module.exports = { published };
