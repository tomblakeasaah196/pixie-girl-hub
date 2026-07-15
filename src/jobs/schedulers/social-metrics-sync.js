/**
 * Twice-daily Social Studio metrics sync (09:00 & 18:00 Africa/Lagos by
 * default — see config.CRON_SOCIAL_METRICS_SYNC). For every active,
 * scrape-enabled social account across every brand: run that platform's
 * configured Apify actor, extract follower count + bio, write it back.
 *
 * Resilient by design, same shape as ad-spend-sync.js: no Apify key
 * configured → whole run is a clean no-op; one account's actor failing
 * (bad handle, actor deprecated, rate limited) never blocks the rest of the
 * batch — it's recorded on that one row via last_scrape_status/_error so
 * the dashboard can surface it without derailing everyone else's numbers.
 */

"use strict";

const repo = require("../../modules/social_media/social.repo");
const apifySettings = require("../../modules/apify_settings/apify-settings.service");
const scraper = require("../../services/social-scraper.service");
const { logger } = require("../../config/logger");

async function runSocialMetricsSync() {
  const apiKey = await apifySettings.resolveActiveApiKey();
  if (!apiKey) {
    logger.info("social-metrics-sync skipped — Apify not configured");
    return { accounts: 0, ok: 0, failed: 0, skipped: true };
  }

  let accounts = [];
  try {
    accounts = await repo.listAccountsForScrape();
  } catch (err) {
    logger.error({ err: err.message }, "social-metrics-sync: account list failed");
    return { accounts: 0, ok: 0, failed: 0 };
  }

  let ok = 0;
  let failed = 0;
  for (const account of accounts) {
    const platform = {
      display_name: account.platform_display_name,
      apify_actor_id: account.apify_actor_id,
      apify_input_template: account.apify_input_template,
      metrics_schema: account.metrics_schema,
    };
    try {
      const result = await scraper.scrapeAccount({ account, platform, apiKey });
      await repo.recordScrapeResult({ account_id: account.account_id, result });
      if (result.ok) {
        ok += 1;
      } else {
        failed += 1;
        logger.warn(
          {
            account_id: account.account_id,
            business: account.business,
            platform: account.platform,
            error: result.error,
          },
          "social-metrics-sync: account scrape failed",
        );
      }
    } catch (err) {
      failed += 1;
      logger.error(
        {
          err: err.message,
          account_id: account.account_id,
          business: account.business,
          platform: account.platform,
        },
        "social-metrics-sync: unexpected error scraping account",
      );
    }
  }

  logger.info({ accounts: accounts.length, ok, failed }, "social metrics sync done");
  return { accounts: accounts.length, ok, failed };
}

module.exports = { runSocialMetricsSync };
