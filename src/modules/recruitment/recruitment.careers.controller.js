/**
 * Careers controller — thin public HTTP handlers (req/res only). Brand is
 * resolved from the host by hostBrandResolverMiddleware (req.brand).
 */

"use strict";

const service = require("./recruitment.careers.service");

async function list(req, res) {
  // No brand resolved (unknown host / no ?brand) → empty list, never a 500.
  if (!req.brand) return res.json({ data: [] });
  res.json({ data: await service.listVacancies({ brand: req.brand }) });
}

async function get(req, res) {
  res.json({
    data: await service.getVacancy({ brand: req.brand, slug: req.params.slug }),
  });
}

async function apply(req, res) {
  res.status(201).json({
    data: await service.submitApplication({
      brand: req.brand,
      slug: req.params.slug,
      body: req.body || {},
      files: req.files || {},
      ip: req.ip,
      ua: req.get("user-agent"),
    }),
  });
}

module.exports = { list, get, apply };
