/**
 * Instagram token auto-refresh sweep.
 *
 * "Instagram API with Instagram Login" long-lived tokens (IGAA…) expire
 * after ~60 days; Meta's refresh endpoint mints a fresh 60-day token
 * from any valid one that's at least 24h old. This daily sweep rotates
 * every active IG account's token once it's a week old, so the ERP's
 * Instagram connection never silently dies — no operator re-pasting.
 *
 * All the logic (age gate, per-row isolation, encrypted persist, audit)
 * lives in messaging-accounts.service.refreshInstagramTokens; this file
 * only adapts it to the cron registry.
 */

"use strict";

const { logger } = require("../../config/logger");

async function runIgTokenRefreshSweep() {
  const svc = require("../../modules/messaging_accounts/messaging-accounts.service");
  const summary = await svc.refreshInstagramTokens();
  logger.info(summary, "ig token refresh sweep done");
  // A rotation can coincide with Meta dropping the account-level webhook
  // subscriptions (message_echoes above all) — re-assert them right after
  // the sweep instead of waiting for the next hourly watchdog tick.
  try {
    const echo = await svc.ensureInstagramEchoSubscriptions();
    logger.info(echo, "ig echo-subscription check after token sweep");
  } catch (err) {
    logger.warn(
      { err: err.message },
      "ig echo-subscription check after token sweep failed",
    );
  }
  return summary;
}

module.exports = { runIgTokenRefreshSweep };
