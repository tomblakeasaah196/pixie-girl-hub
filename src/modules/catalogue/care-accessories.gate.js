"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const { NotFoundError } = require("../../utils/errors");

// Pixie Girl only. A brand value, query param or DB row must NEVER grant FLH
// access — the brand allowlist is checked before the switch is even read.
const CARE_BRAND = "pixiegirl";

// Within PXG, the owner turns Care & Accessories on/off from Catalogue →
// Config (catalogue_config.care_accessories_enabled, migration 000392 —
// default ON). It governs NEW authoring and NEW sales; it is the rollout kill
// switch. It used to be a server .env variable; it deliberately isn't any more.
//
// Read on the hot path of every Care check, so the value is cached briefly.
// The Config save calls invalidate() so a flip in this process is immediate;
// the TTL only bounds how long a change made elsewhere (another process, a
// direct DB edit) takes to land.
const TTL_MS = 10_000;
const DEFAULT_ON = true;
let cached = null; // { value, at }

async function readSwitch() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  try {
    const { rows } = await query(
      `SELECT care_accessories_enabled FROM ${CARE_BRAND}.catalogue_config
        WHERE singleton = true`,
    );
    // No config row yet = the column default (ON).
    const value = rows.length ? rows[0].care_accessories_enabled !== false : DEFAULT_ON;
    cached = { value, at: Date.now() };
    return value;
  } catch (err) {
    // Keep the last known value through a read hiccup; before any successful
    // read (e.g. the column's migration hasn't run yet) use the default.
    logger.warn({ err: err.message }, "care gate: switch read failed — using last known value");
    return cached ? cached.value : DEFAULT_ON;
  }
}

async function enabled(brand) {
  if (brand !== CARE_BRAND) return false;
  return readSwitch();
}

async function requireEnabled(brand) {
  if (!(await enabled(brand))) throw new NotFoundError("Care & Accessories");
}

// Drop the cached value — called after Catalogue → Config saves the switch.
function invalidate() {
  cached = null;
}

// Brand allowlist ONLY — for work on Care orders that already exist (the
// delivery-fee review, fulfilment). The switch stops new selling; it must
// never strand an already-placed retail order that can't dispatch until its
// fee review settles (docs/PXG_RETAIL_PRODUCTS_FEASIBILITY.md "Kill switch").
function isCareBrand(brand) {
  return brand === CARE_BRAND;
}

function requireCareBrand(brand) {
  if (!isCareBrand(brand)) throw new NotFoundError("Care & Accessories");
}

module.exports = { enabled, requireEnabled, invalidate, isCareBrand, requireCareBrand };
