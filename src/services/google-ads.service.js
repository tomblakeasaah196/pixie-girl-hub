/**
 * Google Ads connector (V2.2 §6.15) — live pull (spend/metrics) + push
 * (create / pause / budget) against the Google Ads REST API.
 *
 * App-level creds (developer token + OAuth client) come from env; the per-ad-
 * account refresh token is stored AES-encrypted on shared.ad_accounts and
 * exchanged for a short-lived access token via prepare(). Blank app creds →
 * every call throws a clean 503 and the nightly sync skips this network.
 *
 * Uniform connector interface (shared with meta-ads.service):
 *   isConfigured() -> bool
 *   prepare(account) -> account with a fresh access_token
 *   pullCampaigns(account) -> [{ external_campaign_id, name, objective, status,
 *       budget_amount, budget_currency, budget_type, start_date, end_date }]
 *   pullDailyMetrics(account, { from, to }) -> [{ external_campaign_id,
 *       metric_date, spend_amount, spend_currency, impressions, clicks,
 *       conversions, conversion_value }]
 *   createCampaign(account, input) -> { external_campaign_id, status }
 *   setStatus(account, external_campaign_id, status) -> bool
 *   setBudget(account, external_campaign_id, { amount, type }) -> bool
 *
 * NOTE: structured against the documented Google Ads REST shapes; needs live
 * account creds to validate end-to-end.
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");
const { AppError } = require("../utils/errors");
const { URLSearchParams } = require("url");

const PLATFORM = "google_ads";

function isConfigured() {
  return Boolean(
    config.GOOGLE_ADS_DEVELOPER_TOKEN &&
    config.GOOGLE_ADS_CLIENT_ID &&
    config.GOOGLE_ADS_CLIENT_SECRET,
  );
}

function unavailable(what) {
  throw new AppError(
    "GOOGLE_ADS_NOT_CONFIGURED",
    `Google Ads ${what} is not configured`,
    503,
  );
}

const apiBase = () =>
  `${config.GOOGLE_ADS_BASE_URL}/${config.GOOGLE_ADS_API_VERSION}`;

// Google customer ids are often written 123-456-7890; the API wants digits only.
const cid = (s) => String(s || "").replace(/[^0-9]/g, "");

// Our status vocabulary <-> Google's.
const TO_GOOGLE = {
  draft: "PAUSED",
  active: "ENABLED",
  paused: "PAUSED",
  ended: "REMOVED",
  removed: "REMOVED",
};
const FROM_GOOGLE = { ENABLED: "active", PAUSED: "paused", REMOVED: "removed" };

/** Exchange the account's stored refresh token for a fresh access token. */
async function refreshAccessToken(refresh_token) {
  if (!isConfigured()) unavailable("auth");
  if (!refresh_token) {
    throw new AppError(
      "GOOGLE_ADS_NOT_AUTHORISED",
      "Google Ads account has no stored refresh token",
      409,
    );
  }
  const { data } = await axios.post(
    config.GOOGLE_OAUTH_TOKEN_URL,
    new URLSearchParams({
      client_id: config.GOOGLE_ADS_CLIENT_ID,
      client_secret: config.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token,
      grant_type: "refresh_token",
    }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );
  return { access_token: data.access_token, expires_in: data.expires_in };
}

/** Resolve a valid access token for the account (refreshes the stored token). */
async function prepare(account) {
  const { access_token } = await refreshAccessToken(account.refresh_token);
  return { ...account, access_token };
}

function headers(access_token) {
  const h = {
    Authorization: `Bearer ${access_token}`,
    "developer-token": config.GOOGLE_ADS_DEVELOPER_TOKEN,
    "Content-Type": "application/json",
  };
  if (config.GOOGLE_ADS_LOGIN_CUSTOMER_ID) {
    h["login-customer-id"] = cid(config.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  }
  return h;
}

/** GAQL search with paging; returns the flattened results array. */
async function search(account, gaql) {
  const url = `${apiBase()}/customers/${cid(account.external_account_id)}/googleAds:search`;
  const out = [];
  let pageToken;
  do {
    const { data } = await axios.post(
      url,
      { query: gaql, pageToken },
      { headers: headers(account.access_token) },
    );
    if (Array.isArray(data.results)) out.push(...data.results);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

async function mutate(account, resource, operations) {
  const url = `${apiBase()}/customers/${cid(account.external_account_id)}/${resource}:mutate`;
  const { data } = await axios.post(
    url,
    { operations },
    { headers: headers(account.access_token) },
  );
  return data;
}

async function pullCampaigns(account) {
  if (!isConfigured()) unavailable("pull");
  const rows = await search(
    account,
    `SELECT campaign.id, campaign.name, campaign.status,
            campaign.advertising_channel_type, campaign.start_date,
            campaign.end_date, campaign_budget.amount_micros,
            campaign_budget.period
     FROM campaign WHERE campaign.status != 'REMOVED'`,
  );
  return rows.map((r) => {
    const budget = r.campaignBudget || {};
    return {
      external_campaign_id: String(r.campaign.id),
      name: r.campaign.name,
      objective:
        (r.campaign.advertisingChannelType || "").toLowerCase() || null,
      status: FROM_GOOGLE[r.campaign.status] || "paused",
      budget_amount: budget.amountMicros
        ? Number(budget.amountMicros) / 1e6
        : null,
      budget_currency: account.currency,
      budget_type: budget.period === "DAILY" ? "daily" : "lifetime",
      start_date: r.campaign.startDate || null,
      end_date: r.campaign.endDate || null,
    };
  });
}

async function pullDailyMetrics(account, { from, to }) {
  if (!isConfigured()) unavailable("pull");
  const rows = await search(
    account,
    `SELECT campaign.id, segments.date, metrics.cost_micros,
            metrics.impressions, metrics.clicks, metrics.conversions,
            metrics.conversions_value
     FROM campaign
     WHERE segments.date BETWEEN '${from}' AND '${to}'`,
  );
  return rows.map((r) => {
    const m = r.metrics || {};
    return {
      external_campaign_id: String(r.campaign.id),
      metric_date: r.segments.date,
      spend_amount: m.costMicros ? Number(m.costMicros) / 1e6 : 0,
      spend_currency: account.currency,
      impressions: Number(m.impressions || 0),
      clicks: Number(m.clicks || 0),
      conversions: Math.round(Number(m.conversions || 0)),
      conversion_value: Number(m.conversionsValue || 0),
    };
  });
}

async function createCampaign(account, input) {
  if (!isConfigured()) unavailable("push");
  // A campaign needs a budget resource first. Amount is in micros (1e6 = 1 unit).
  const micros = input.budget_amount
    ? Math.round(Number(input.budget_amount) * 1e6)
    : 1_000_000;
  const budgetRes = await mutate(account, "campaignBudgets", [
    {
      create: {
        name: `${input.name} budget ${Date.now()}`,
        amountMicros: micros,
        deliveryMethod: "STANDARD",
        explicitlyShared: false,
      },
    },
  ]);
  const budgetResource = budgetRes.results[0].resourceName;
  // Always create PAUSED — never start spend without an explicit activate.
  const campRes = await mutate(account, "campaigns", [
    {
      create: {
        name: input.name,
        status: "PAUSED",
        advertisingChannelType: (input.channel || "SEARCH").toUpperCase(),
        campaignBudget: budgetResource,
      },
    },
  ]);
  const resourceName = campRes.results[0].resourceName;
  return {
    external_campaign_id: resourceName.split("/").pop(),
    status: "paused",
  };
}

async function setStatus(account, external_campaign_id, status) {
  if (!isConfigured()) unavailable("push");
  await mutate(account, "campaigns", [
    {
      update: {
        resourceName: `customers/${cid(account.external_account_id)}/campaigns/${external_campaign_id}`,
        status: TO_GOOGLE[status] || "PAUSED",
      },
      updateMask: "status",
    },
  ]);
  return true;
}

async function setBudget(account, external_campaign_id, { amount }) {
  if (!isConfigured()) unavailable("push");
  const rows = await search(
    account,
    `SELECT campaign_budget.resource_name FROM campaign
      WHERE campaign.id = ${Number(external_campaign_id)}`,
  );
  const budgetResource =
    rows[0] && rows[0].campaignBudget
      ? rows[0].campaignBudget.resourceName
      : null;
  if (!budgetResource) {
    throw new AppError(
      "GOOGLE_ADS_NO_BUDGET",
      "Campaign budget resource not found",
      404,
    );
  }
  await mutate(account, "campaignBudgets", [
    {
      update: {
        resourceName: budgetResource,
        amountMicros: Math.round(Number(amount) * 1e6),
      },
      updateMask: "amount_micros",
    },
  ]);
  return true;
}

module.exports = {
  platform: PLATFORM,
  isConfigured,
  prepare,
  refreshAccessToken,
  pullCampaigns,
  pullDailyMetrics,
  createCampaign,
  setStatus,
  setBudget,
};
