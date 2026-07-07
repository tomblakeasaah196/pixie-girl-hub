/**
 * CRM preset thresholds — single source of truth for the client-segmentation
 * cut-offs. Consumed by the CRM clients list (filter chips), the Today
 * buckets, and the nightly segment-presets scheduler, so "VIP" means the
 * same thing on the client list, in a campaign audience, and on a report.
 */

"use strict";

module.exports = {
  VIP_SPEND_NGN: 500000,
  BIG_SPENDER_SPEND_NGN: 250000,
  WINBACK_LAPSED_DAYS: 60,
  NEW_CLIENT_DAYS: 30,
  BIRTHDAY_SOON_DAYS: 30,
  // Today buckets
  CELEBRATE_WINDOW_DAYS: 7,
  STALE_DEAL_DAYS: 7,
};
