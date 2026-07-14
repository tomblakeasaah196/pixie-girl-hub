/**
 * Social Studio deadline enforcement sweep (V2.2 §6.14).
 *
 * Hourly. For each brand: nudge creators whose scheduled/assigned posts are
 * overdue with no proof, escalate straight to the CEO once a miss goes
 * unresolved past the escalation window. All the policy (grace period,
 * nudge cooldown, escalation threshold, quiet hours) lives in
 * social.deadlines.js; the decision + IO lives in social.service.runDeadlineSweep.
 * This file only adapts it to the cron registry, same as ig-token-refresh.js.
 */

"use strict";

const { logger } = require("../../config/logger");
const { BRANDS } = require("../../config/brands");

async function runSocialDeadlineSweep() {
  const service = require("../../modules/social_media/social.service");
  let nudged = 0;
  let escalated = 0;
  let checked = 0;
  for (const brand of BRANDS) {
    try {
      const r = await service.runDeadlineSweep({ brand });
      checked += r.checked;
      nudged += r.nudged;
      escalated += r.escalated;
    } catch (err) {
      logger.error(
        { err: err.message, brand },
        "social deadline sweep: brand failed",
      );
    }
  }
  logger.info({ checked, nudged, escalated }, "social deadline sweep complete");
  return { checked, nudged, escalated };
}

module.exports = { runSocialDeadlineSweep };
