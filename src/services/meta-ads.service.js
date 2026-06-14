/**
 * Meta Marketing connector (V2.2 §6.15) — live pull (spend/insights) + push
 * (create / pause / budget) against the Facebook Graph Marketing API.
 *
 * Auth is per-ad-account: each business stores its own access token (AES-
 * encrypted on shared.ad_accounts). META_MARKETING_API_KEY is an optional
 * system-user fallback; META_ADS_APP_SECRET (optional) adds an appsecret_proof
 * to every call. No per-account token AND no fallback → a clean 409/503.
 *
 * Money note: Graph insights report `spend` in MAJOR account-currency units,
 * but campaign budgets (daily/lifetime) are in MINOR units (e.g. kobo). We
 * convert on the budget paths only.
 *
 * Same connector interface as google-ads.service. Structured against the
 * documented Graph shapes; needs a live ad account to validate end-to-end.
 */

"use strict";

const axios = require("axios");
const crypto = require("crypto");
const { config } = require("../config/env");
const { AppError } = require("../utils/errors");

const PLATFORM = "meta_ads";

const graph = () => `https://graph.facebook.com/${config.META_GRAPH_VERSION}`;

// Meta auth is per-account, so the network is always "available"; individual
// calls fail cleanly if a given account has no token.
function isConfigured() {
  return true;
}

// Token already lives (decrypted) on the account — nothing to refresh.
async function prepare(account) {
  return account;
}

const TO_META = {
  draft: "PAUSED",
  active: "ACTIVE",
  paused: "PAUSED",
  ended: "PAUSED",
  removed: "DELETED",
};
const FROM_META = {
  ACTIVE: "active",
  PAUSED: "paused",
  DELETED: "removed",
  ARCHIVED: "ended",
  IN_PROCESS: "draft",
  WITH_ISSUES: "active",
};

const actId = (id) =>
  String(id).startsWith("act_") ? String(id) : `act_${id}`;

function objectiveToMeta(o) {
  const map = {
    sales: "OUTCOME_SALES",
    awareness: "OUTCOME_AWARENESS",
    traffic: "OUTCOME_TRAFFIC",
    engagement: "OUTCOME_ENGAGEMENT",
    leads: "OUTCOME_LEADS",
  };
  return map[(o || "").toLowerCase()] || "OUTCOME_TRAFFIC";
}

function appsecretProof(token) {
  if (!config.META_ADS_APP_SECRET) return null;
  return crypto
    .createHmac("sha256", config.META_ADS_APP_SECRET)
    .update(token)
    .digest("hex");
}

/** Build the access_token (+ optional appsecret_proof) query params. */
function authParams(account) {
  const token = account.access_token || config.META_MARKETING_API_KEY;
  if (!token) {
    throw new AppError(
      "META_ADS_NOT_AUTHORISED",
      "Meta ad account has no stored access token",
      409,
    );
  }
  const params = { access_token: token };
  const proof = appsecretProof(token);
  if (proof) params.appsecret_proof = proof;
  return params;
}

/** GET with Graph cursor paging (paging.next is a full URL with params baked in). */
async function getAll(firstUrl, firstParams) {
  const out = [];
  let url = firstUrl;
  let params = firstParams;
  while (url) {
    const { data } = await axios.get(url, params ? { params } : undefined);
    if (Array.isArray(data.data)) out.push(...data.data);
    url = data.paging && data.paging.next ? data.paging.next : null;
    params = null; // the "next" URL already carries the query
  }
  return out;
}

function sumActions(arr, types) {
  if (!Array.isArray(arr)) return 0;
  return arr
    .filter((a) => types.includes(a.action_type))
    .reduce((s, a) => s + Number(a.value || 0), 0);
}

const PURCHASE_ACTIONS = [
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "onsite_conversion.purchase",
];

async function pullCampaigns(account) {
  const rows = await getAll(
    `${graph()}/${actId(account.external_account_id)}/campaigns`,
    {
      ...authParams(account),
      fields:
        "id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time,created_time",
      limit: 200,
    },
  );
  return rows.map((c) => {
    const minor = c.daily_budget || c.lifetime_budget || null;
    return {
      external_campaign_id: String(c.id),
      name: c.name,
      objective:
        (c.objective || "").toLowerCase().replace(/^outcome_/, "") || null,
      status: FROM_META[c.status] || "paused",
      budget_amount: minor ? Number(minor) / 100 : null,
      budget_currency: account.currency,
      budget_type: c.daily_budget
        ? "daily"
        : c.lifetime_budget
          ? "lifetime"
          : null,
      start_date: c.start_time ? c.start_time.slice(0, 10) : null,
      end_date: c.stop_time ? c.stop_time.slice(0, 10) : null,
      external_created_at: c.created_time || null,
    };
  });
}

async function pullDailyMetrics(account, { from, to }) {
  const rows = await getAll(
    `${graph()}/${actId(account.external_account_id)}/insights`,
    {
      ...authParams(account),
      level: "campaign",
      time_increment: 1,
      time_range: JSON.stringify({ since: from, until: to }),
      fields: "campaign_id,spend,impressions,clicks,actions,action_values",
      limit: 500,
    },
  );
  return rows.map((r) => ({
    external_campaign_id: String(r.campaign_id),
    metric_date: r.date_start,
    spend_amount: Number(r.spend || 0),
    spend_currency: account.currency,
    impressions: Number(r.impressions || 0),
    clicks: Number(r.clicks || 0),
    conversions: Math.round(sumActions(r.actions, PURCHASE_ACTIONS)),
    conversion_value: sumActions(r.action_values, PURCHASE_ACTIONS),
  }));
}

async function createCampaign(account, input) {
  // Always PAUSED — never start spend without an explicit activate.
  const { data } = await axios.post(
    `${graph()}/${actId(account.external_account_id)}/campaigns`,
    null,
    {
      params: {
        ...authParams(account),
        name: input.name,
        objective: objectiveToMeta(input.objective),
        status: "PAUSED",
        special_ad_categories: JSON.stringify([]),
      },
    },
  );
  return { external_campaign_id: String(data.id), status: "paused" };
}

async function setStatus(account, external_campaign_id, status) {
  const { data } = await axios.post(
    `${graph()}/${external_campaign_id}`,
    null,
    {
      params: { ...authParams(account), status: TO_META[status] || "PAUSED" },
    },
  );
  return data.success !== false;
}

async function setBudget(account, external_campaign_id, { amount, type }) {
  const field = type === "lifetime" ? "lifetime_budget" : "daily_budget";
  const { data } = await axios.post(
    `${graph()}/${external_campaign_id}`,
    null,
    {
      params: {
        ...authParams(account),
        [field]: Math.round(Number(amount) * 100),
      },
    },
  );
  return data.success !== false;
}

module.exports = {
  platform: PLATFORM,
  isConfigured,
  prepare,
  pullCampaigns,
  pullDailyMetrics,
  createCampaign,
  setStatus,
  setBudget,
};
