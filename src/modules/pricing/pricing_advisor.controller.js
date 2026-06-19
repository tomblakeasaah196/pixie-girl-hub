/**
 * Pricing advisor — HTTP controller (product-centric advisory + governance).
 */

"use strict";

const advisor = require("./pricing_advisor.service");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function recommend(req, res) {
  res.json({ data: await advisor.recommend({ ...base(req), input: req.body }) });
}

async function apply(req, res) {
  res.json({ data: await advisor.apply({ ...base(req), input: req.body }) });
}

async function getConfig(req, res) {
  res.json({ data: await advisor.getConfig({ brand: req.brand }) });
}

async function updateConfig(req, res) {
  res.json({ data: await advisor.updateConfig({ ...base(req), patch: req.body }) });
}

async function setUsd(req, res) {
  res.json({
    data: await advisor.setUsd({
      ...base(req),
      variant_id: req.params.variant_id,
      price_usd: req.body.price_usd,
    }),
  });
}

module.exports = { recommend, apply, getConfig, updateConfig, setUsd };
