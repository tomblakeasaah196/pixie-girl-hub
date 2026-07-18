/**
 * Instagram echo-subscription watchdog.
 *
 * The `message_echoes` webhook field — the ONLY signal Meta sends when a
 * staffer answers a DM from the Instagram app — is subscribed on the
 * professional account itself (POST /me/subscribed_apps), outside our
 * database. That subscription has repeatedly drifted off (account
 * reconnects and partial re-subscribes REPLACE the field list), and when
 * it does, app-side replies silently vanish from the Hub: no error, no
 * webhook, threads just look unanswered.
 *
 * This hourly sweep re-reads every active IG account's subscribed fields
 * and re-subscribes the union when anything required is missing, so the
 * longest the sync can ever be down is one hour — and the CEO is
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
