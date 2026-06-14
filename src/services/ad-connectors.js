/**
 * Ad-network connector registry. Maps an ad_accounts.platform value to its
 * connector (uniform interface: isConfigured / prepare / pullCampaigns /
 * pullDailyMetrics / createCampaign / setStatus / setBudget).
 */

"use strict";

const { AppError } = require("../utils/errors");

const map = {
  google_ads: require("./google-ads.service"),
  meta_ads: require("./meta-ads.service"),
};

function forPlatform(platform) {
  const c = map[platform];
  if (!c) {
    throw new AppError(
      "UNKNOWN_AD_PLATFORM",
      `Unknown ad platform: ${platform}`,
      400,
    );
  }
  return c;
}

module.exports = { forPlatform, connectors: map };
