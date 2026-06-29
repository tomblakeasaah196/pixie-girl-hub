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

module.exports = { loyalty, referral, rewards, redeem };
