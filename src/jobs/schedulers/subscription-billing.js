/**
 * Wig subscription recurring billing (W-C / PD §6.23.5).
 * Runs daily (03:00 Africa/Lagos). Charges every due active subscription
 * off-session via Paystack and resolves the revenue in Sales. Idempotent per
 * cycle. Money-moving — validate on staging before relying on it.
 */

"use strict";

const { logger } = require("../../config/logger");
const subscriptions = require("../../modules/retention/subscription.service");

async function runSubscriptionBilling() {
  try {
    return await subscriptions.runDueBilling();
  } catch (err) {
    logger.error({ err: err.message }, "subscription billing sweep failed");
    return { charged: 0 };
  }
}

module.exports = { runSubscriptionBilling };
