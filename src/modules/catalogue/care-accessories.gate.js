"use strict";

const { config } = require("../../config/env");
const { NotFoundError } = require("../../utils/errors");

// A brand value, query param or DB toggle must NEVER grant FLH access. The
// flag governs NEW authoring and NEW sales; it is the rollout kill switch.
// Default is off, including in production.
function enabled(brand) {
  return brand === "pixiegirl" && config.FEATURE_PXG_CARE_ACCESSORIES_ENABLED === true;
}

function requireEnabled(brand) {
  if (!enabled(brand)) throw new NotFoundError("Care & Accessories");
}

// Brand allowlist ONLY — for work on Care orders that already exist (the
// delivery-fee review, fulfilment). The kill switch stops new selling; it must
// never strand an already-placed retail order that can't dispatch until its
// fee review settles (docs/PXG_RETAIL_PRODUCTS_FEASIBILITY.md "Kill switch").
function isCareBrand(brand) {
  return brand === "pixiegirl";
}

function requireCareBrand(brand) {
  if (!isCareBrand(brand)) throw new NotFoundError("Care & Accessories");
}

module.exports = { enabled, requireEnabled, isCareBrand, requireCareBrand };
