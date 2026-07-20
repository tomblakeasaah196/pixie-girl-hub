/**
 * Customer-facing retention HTTP controller (storefront). Authed as the
 * shopper (requireCustomer → req.customer.contact_id); brand from
 * X-Brand-Context. Delegates to customer-retention.service.
 */

"use strict";

const service = require("./customer-retention.service");
const authService = require("./customer-auth.service");
const { VALID_BRANDS } = require("../../config/brands");

function brandHint(req) {
  const h = req.brand || req.headers["x-brand-context"] || req.query.brand;
  return VALID_BRANDS.has(h) ? h : "pixiegirl";
}

async function loyalty(req, res) {
  res.json({
    data: await service.loyalty({
      brand: brandHint(req),
      contact_id: req.customer.contact_id,
    }),
  });
}

async function referral(req, res) {
  const profile = await authService.me({ contact_id: req.customer.contact_id });
  res.json({
    data: await service.referral({
      brand: brandHint(req),
      contact_id: req.customer.contact_id,
      contact: {
        first_name: profile && profile.first_name,
        display_name: profile && profile.display_name,
      },
    }),
  });
}

async function rewards(req, res) {
  res.json({ data: await service.rewards({ brand: brandHint(req) }) });
}

async function redeem(req, res) {
  res.json({
    data: await service.redeem({
      brand: brandHint(req),
      contact_id: req.customer.contact_id,
      reward_id: req.params.id,
      request_id: req.request_id,
    }),
  });
}

// ── Crowns 👑 ──────────────────────────────────────────────
async function crownWallet(req, res) {
  res.json({
    data: await service.crownWallet({
      brand: brandHint(req),
      contact_id: req.customer.contact_id,
    }),
  });
}

async function crownProgramme(req, res) {
  res.json({ data: await service.crownProgramme({ brand: brandHint(req) }) });
}

async function crownDiscount(req, res) {
  res.json({
    data: await service.crownDiscount({
      brand: brandHint(req),
      contact_id: req.customer.contact_id,
    }),
  });
}

async function crownSubmit(req, res) {
  res.status(201).json({
    data: await service.crownSubmit({
      brand: brandHint(req),
      contact_id: req.customer.contact_id,
      input: req.body,
    }),
  });
}

async function crownCheckIn(req, res) {
  res.status(201).json({
    data: await service.crownCheckIn({
      brand: brandHint(req),
      contact_id: req.customer.contact_id,
    }),
  });
}

module.exports = {
  loyalty,
  referral,
  rewards,
  redeem,
  crownWallet,
  crownProgramme,
  crownDiscount,
  crownSubmit,
  crownCheckIn,
};
