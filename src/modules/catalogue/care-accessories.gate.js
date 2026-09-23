"use strict";

const { config } = require("../../config/env");
const { NotFoundError } = require("../../utils/errors");

// A brand value, query param or DB toggle must NEVER grant FLH access. This
// PR's flag allows *staff authoring only*; SQL rejects retail sales until PR 2
// installs the typed order resolver. Default is off, including in production.
function enabled(brand) {
  return brand === "pixiegirl" && config.FEATURE_PXG_CARE_ACCESSORIES_ENABLED === true;
}

function requireEnabled(brand) {
  if (!enabled(brand)) throw new NotFoundError("Care & Accessories");
}

module.exports = { enabled, requireEnabled };
