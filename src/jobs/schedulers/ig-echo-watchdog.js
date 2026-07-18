/**
 * Instagram webhook-subscription watchdog.
 *
 * The whole inbox hangs on the account-level webhook subscription (POST
 * /me/subscribed_apps): `messages` carries customer DMs AND app-reply
 * echoes (is_echo — Instagram has no separate message_echoes field,
 * that's Messenger-only), `message_reactions` the ❤️ badges,
 * `messaging_seen` the read ticks. The subscription lives on Meta's
 * side and drifts (account reconnects and partial re-subscribes REPLACE
 * the field list) — and when it does, things silently stop syncing: no
 * error, no webhook, threads just look wrong.
 *
 * This hourly sweep re-reads every active IG account's subscribed fields
 * and re-subscribes the union when anything required is missing, so the
 * longest sync can ever be degraded is one hour — and the CEO is
 * notified that it drifted (messaging-accounts.service owns the logic).
 */

"use strict";

const { logger } = require("../../config/logger");

async function runIgEchoSubscriptionWatchdog() {
  const svc = require("../../modules/messaging_accounts/messaging-accounts.service");
  const summary = await svc.ensureInstagramEchoSubscriptions();
  if (summary.healed || summary.failed) {
    logger.warn(summary, "ig echo-subscription watchdog: drift detected");
  } else {
    logger.info(summary, "ig echo-subscription watchdog done");
  }
  return summary;
}

module.exports = { runIgEchoSubscriptionWatchdog };
