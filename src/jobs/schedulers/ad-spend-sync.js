/**
 * Nightly ad spend + campaign sync (V2.2 §6.15). For every active ad account:
 *   1. prepare() a usable access token (Google refreshes; Meta passes through)
 *   2. pull campaigns → upsert, mapping each external id to its internal row
 *   3. pull a spend window → recordSpend per campaign/day (feeds the ROAS report)
 *
 * Resilient by design: a network with blank app creds (connector.isConfigured()
 * false) and an account with no stored token are skipped; one bad account never
 * fails the batch. Spend is converted to NGN via the FX service (NGN accounts
 * pass through 1:1; non-NGN fall back to the native amount if no rate).
 */

"use strict";

const repo = require("../../modules/marketing/marketing.repo");
const { forPlatform } = require("../../services/ad-connectors");
const fx = require("../../services/fx.service");
const { logger } = require("../../config/logger");

const SYNC_WINDOW_DAYS = 7;

const ymd = (d) => d.toISOString().slice(0, 10);

async function runAdSpendSync({ windowDays = SYNC_WINDOW_DAYS } = {}) {
  let accounts = [];
  try {
    accounts = await repo.listActiveAccountsForSync();
  } catch (err) {
    logger.error({ err: err.message }, "ad-sync: account list failed");
    return { accounts: 0, campaigns: 0, spendRows: 0, skipped: 0 };
  }

  // Window: the last `windowDays` up to yesterday (today is still accruing).
  const to = new Date(Date.now() - 86_400_000);
  const from = new Date(to.getTime() - (windowDays - 1) * 86_400_000);
  const range = { from: ymd(from), to: ymd(to) };

  // Fetch FX once for any non-NGN account currency.
  let rates = {};
  const foreign = [
    ...new Set(
      accounts
        .map((a) => String(a.currency || "NGN").toUpperCase())
        .filter((c) => c !== "NGN"),
    ),
  ];
  if (foreign.length && fx.isConfigured()) {
    try {
      rates = await fx.fetchRatesToNGN(foreign);
    } catch (err) {
      logger.warn(
        { err: err.message },
        "ad-sync: FX fetch failed; non-NGN spend left at native amount",
      );
    }
  }
  const toNgn = (amount, currency) => {
    const c = String(currency || "NGN").toUpperCase();
    if (c === "NGN") return amount;
    const r = rates[c];
    return r ? amount * r : amount;
  };

  let campaignsTouched = 0;
  let spendRows = 0;
  let skipped = 0;

  for (const account of accounts) {
    const connector = forPlatform(account.platform);
    if (!connector.isConfigured()) {
      skipped += 1; // network not enabled in this deployment
      continue;
    }
    if (!account.access_token && !account.refresh_token) {
      skipped += 1; // account never authorised
      continue;
    }
    try {
      const acct = await connector.prepare(account);

      const campaigns = await connector.pullCampaigns(acct);
      const idByExternal = new Map();
      for (const c of campaigns) {
        const internalId = await repo.upsertCampaignFromExternal({
          brand: account.business,
          ad_account_id: account.ad_account_id,
          platform: account.platform,
          c,
        });
        idByExternal.set(c.external_campaign_id, internalId);
        campaignsTouched += 1;
      }

      const metrics = await connector.pullDailyMetrics(acct, range);
      for (const m of metrics) {
        const internalId = idByExternal.get(m.external_campaign_id);
        if (!internalId) continue; // metric for a campaign we didn't ingest
        await repo.recordSpend({
          ad_campaign_id: internalId,
          metric_date: m.metric_date,
          s: {
            spend_amount: m.spend_amount,
            spend_ngn: toNgn(m.spend_amount, account.currency),
            impressions: m.impressions,
            clicks: m.clicks,
            conversions: m.conversions,
            conversion_value: m.conversion_value,
            conversion_value_ngn: toNgn(m.conversion_value, account.currency),
          },
        });
        spendRows += 1;
      }

      await repo.setAccountSynced({ id: account.ad_account_id });
    } catch (err) {
      logger.error(
        {
          err: err.message,
          ad_account_id: account.ad_account_id,
          platform: account.platform,
        },
        "ad-sync: account sync failed",
      );
      skipped += 1;
    }
  }

  logger.info(
    { accounts: accounts.length, campaigns: campaignsTouched, spendRows, skipped },
    "ad spend sync done",
  );
  return {
    accounts: accounts.length,
    campaigns: campaignsTouched,
    spendRows,
    skipped,
  };
}

module.exports = { runAdSpendSync };
