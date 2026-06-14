"use strict";

const repo = require("../../modules/marketing/marketing.repo");
const connectors = require("../../services/ad-connectors");
const { logger } = require("../../config/logger");
const dayjs = require("dayjs");

async function runAdSpendSync() {
  logger.info("ad-spend-sync: start");
  const accounts = await repo.listActiveAccountsForSync();
  // sync last 7 days (excluding today)
  const to = dayjs().subtract(1, "day").format("YYYY-MM-DD");
  const from = dayjs().subtract(7, "day").format("YYYY-MM-DD");

  for (const a of accounts) {
    try {
      const connector = connectors.forPlatform(a.platform);
      if (!connector.isConfigured || !connector.isConfigured()) {
        logger.warn(
          { account: a.ad_account_id },
          "ad connector not configured; skipping account",
        );
        continue;
      }
      const prepared = await connector.prepare(a);
      const metrics = await connector.pullDailyMetrics(prepared, { from, to });
      for (const m of metrics) {
        // Ensure campaign exists in our DB (may create with minimal data)
        const adCampaignId = await repo.upsertCampaignFromExternal({
          brand: a.business,
          ad_account_id: a.ad_account_id,
          platform: a.platform,
          c: {
            external_campaign_id: m.external_campaign_id,
            name: m.external_campaign_id,
          },
        });
        // record the spend
        await repo.recordSpend({
          ad_campaign_id: adCampaignId,
          metric_date: m.metric_date,
          s: {
            spend_amount: m.spend_amount,
            spend_ngn: m.spend_amount, // connector should already provide NGN mapping or caller updates later
            impressions: m.impressions,
            clicks: m.clicks,
            conversions: m.conversions,
            conversion_value: m.conversion_value,
            conversion_value_ngn: m.conversion_value,
          },
        });
      }
      await repo.setAccountSynced({ id: a.ad_account_id });
      logger.info(
        { account: a.ad_account_id, rows: metrics.length },
        "ad-spend-sync: account processed",
      );
    } catch (err) {
      logger.error(
        { err, account: a.ad_account_id },
        "ad-spend-sync: account failed",
      );
    }
  }

  logger.info("ad-spend-sync: complete");
}

module.exports = { runAdSpendSync };
