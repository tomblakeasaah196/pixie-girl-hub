/**
 * USD bulk-reprice (Catalogue → Config "Apply USD exchange rate") — HTTP
 * controllers. Thin: req/res only.
 */

"use strict";

const service = require("./usd-reprice.service");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function status(req, res) {
  res.json({ data: await service.getStatus({ brand: req.brand }) });
}

async function marketRate(req, res) {
  res.json({ data: await service.marketRate() });
}

async function preview(req, res) {
  res.json({
    data: await service.preview({
      brand: req.brand,
      rate: req.body.rate,
      rounding: req.body.rounding,
    }),
  });
}

async function apply(req, res) {
  res.json({
    data: await service.apply({
      ...base(req),
      rate: req.body.rate,
      rounding: req.body.rounding,
      confirm: req.body.confirm,
    }),
  });
}

async function undo(req, res) {
  res.json({ data: await service.undo({ ...base(req) }) });
}

module.exports = { status, marketRate, preview, apply, undo };
