/**
 * Retention strategy tick (Module 6.23). Runs every minute: advances due
 * enrolments to their next step (send the email, issue the coupon, …),
 * honouring quiet hours + frequency caps. The companion to the daily scanner.
 */

"use strict";

const { logger } = require("../../config/logger");
const engine = require("../../modules/retention/strategy.engine");

async function runRetentionStrategyTick() {
  try {
    return await engine.tick();
  } catch (err) {
    logger.error({ err: err.message }, "retention strategy tick failed");
    return { done: 0 };
  }
}

module.exports = { runRetentionStrategyTick };
