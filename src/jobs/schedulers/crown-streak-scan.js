/**
 * Crown streak scanner (Module 6.23). Runs daily, per brand: nudges streaks
 * entering their warning window and, once a deadline passes, spends a freeze
 * if one is left or breaks the streak.
 *
 * Detection lives here; the scan emits `crown.streak_at_risk` /
 * `crown.streak_frozen` / `crown.streak_broken` on the retention event bus.
 * The email + in-app delivery subscriber (so sales can reach out) is wired
 * with the notifications templates in the customer-facing PR.
 */

"use strict";

const { logger } = require("../../config/logger");
const { BRANDS } = require("../../config/brands");
const streak = require("../../modules/retention/crown.streak");

async function runCrownStreakScan() {
  const totals = { nudged: 0, frozen: 0, broken: 0 };
  for (const brand of BRANDS) {
    try {
      const res = await streak.scan({ brand });
      totals.nudged += res.nudged;
      totals.frozen += res.frozen;
      totals.broken += res.broken;
    } catch (err) {
      logger.error({ err: err.message, brand }, "crown streak scan failed");
    }
  }
  logger.info(totals, "crown streak scan complete");
  return totals;
}

module.exports = { runCrownStreakScan };
