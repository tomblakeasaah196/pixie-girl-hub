/**
 * Marketing Campaigns & Ad Analytics (V2.2 §6.15) — repository.
 * SHARED: ad_accounts, ad_campaigns, ad_spend_daily (business-scoped).
 * Attribution joins per-brand sales_orders (utm_campaign) to ad campaigns.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");
const crypto = require("../../services/encryption.service");

// ── Ad accounts ────────────────────────────────────────────
async function createAdAccount({ brand, account }) {
  const { rows } = await query(
    `INSERT INTO shared.ad_accounts
       (business, platform, external_account_id, display_name, currency)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [
      brand,
      account.platform,
      account.external_account_id,
      account.display_name,
      account.currency || "NGN",
    ],
  );
  return rows[0];
}
async function listAdAccounts({ brand }) {
  const { rows } = await query(
    `SELECT * FROM shared.ad_accounts WHERE business = $1 ORDER BY platform`,
    [brand],
  );
  return rows;
}
async function deactivateAdAccount({ brand, id }) {
  const { rows } = await query(
    `UPDATE shared.ad_accounts SET is_active = false
      WHERE ad_account_id = $1 AND business = $2 RETURNING ad_account_id`,
    [id, brand],
  );
  return rows[0] || null;
}

// ── Ad campaigns ───────────────────────────────────────────
async function createAdCampaign({ brand, c }) {
  const { rows } = await query(
    `INSERT INTO shared.ad_campaigns
       (business, ad_account_id, platform, external_campaign_id, name,
        objective, status, budget_amount, budget_currency)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'active'),$8,$9) RETURNING *`,
    [
      brand,
      c.ad_account_id,
      c.platform,
      c.external_campaign_id,
      c.name,
      c.objective || null,
      c.status,
      c.budget_amount !== null && c.budget_amount !== undefined
        ? c.budget_amount
        : null,
      c.budget_currency || null,
    ],
  );
  return rows[0];
}
async function listAdCampaigns({ brand, status, page = 1, page_size = 25 }) {
  const where = ["business = $1"];
  const params = [brand];
  let i = 2;
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const { rows: cnt } = await query(
    `SELECT count(*)::int AS total FROM shared.ad_campaigns ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT * FROM shared.ad_campaigns ${w}
      ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: cnt[0].total };
}
async function getAdCampaign({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM shared.ad_campaigns WHERE ad_campaign_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}
async function setAdCampaignStatus({ brand, id, status }) {
  const { rows } = await query(
    `UPDATE shared.ad_campaigns SET status = $3, updated_at = now()
      WHERE ad_campaign_id = $1 AND business = $2 RETURNING *`,
    [id, brand, status],
  );
  return rows[0] || null;
}

// ── Ad spend (daily) ───────────────────────────────────────
async function recordSpend({ ad_campaign_id, metric_date, s }) {
  const { rows } = await query(
    `INSERT INTO shared.ad_spend_daily
       (ad_campaign_id, metric_date, spend_amount, spend_ngn, impressions,
        clicks, conversions, conversion_value, conversion_value_ngn)
     VALUES ($1,$2,COALESCE($3,0),COALESCE($4,0),COALESCE($5,0),COALESCE($6,0),
             COALESCE($7,0),COALESCE($8,0),COALESCE($9,0))
     ON CONFLICT (ad_campaign_id, metric_date) DO UPDATE
       SET spend_amount = EXCLUDED.spend_amount, spend_ngn = EXCLUDED.spend_ngn,
           impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
           conversions = EXCLUDED.conversions,
           conversion_value = EXCLUDED.conversion_value,
           conversion_value_ngn = EXCLUDED.conversion_value_ngn
     RETURNING *`,
    [
      ad_campaign_id,
      metric_date,
      s.spend_amount,
      s.spend_ngn,
      s.impressions,
      s.clicks,
      s.conversions,
      s.conversion_value,
      s.conversion_value_ngn,
    ],
  );
  return rows[0];
}

// ── Attribution: ad spend vs sales by utm_campaign ─────────
async function adSpendSummary({ brand, from, to }) {
  const params = [brand];
  let range = "";
  let i = 2;
  if (from) {
    range += ` AND s.metric_date >= $${i++}`;
    params.push(from);
  }
  if (to) {
    range += ` AND s.metric_date <= $${i++}`;
    params.push(to);
  }
  const { rows } = await query(
    `SELECT ac.ad_campaign_id, ac.name, ac.platform,
            COALESCE(SUM(s.spend_ngn),0) AS spend_ngn,
            COALESCE(SUM(s.impressions),0) AS impressions,
            COALESCE(SUM(s.clicks),0) AS clicks,
            COALESCE(SUM(s.conversions),0) AS conversions
       FROM shared.ad_campaigns ac
       LEFT JOIN shared.ad_spend_daily s ON s.ad_campaign_id = ac.ad_campaign_id ${range}
      WHERE ac.business = $1
      GROUP BY ac.ad_campaign_id, ac.name, ac.platform
      ORDER BY spend_ngn DESC`,
    params,
  );
  return rows;
}

async function salesByUtmCampaign({ brand, from, to }) {
  const params = [];
  const where = [
    "utm_campaign IS NOT NULL",
    "status IN ('paid','awaiting_dispatch','completed')",
  ];
  let i = 1;
  if (from) {
    where.push(`COALESCE(placed_at, created_at) >= $${i++}`);
    params.push(from);
  }
  if (to) {
    where.push(`COALESCE(placed_at, created_at) <= $${i++}`);
    params.push(to);
  }
  const { rows } = await query(
    `SELECT utm_campaign,
            count(*)::int AS orders,
            COALESCE(SUM(total_ngn),0) AS revenue_ngn
       FROM ${t(brand, "sales_orders")}
      WHERE ${where.join(" AND ")}
      GROUP BY utm_campaign
      ORDER BY revenue_ngn DESC`,
    params,
  );
  return rows;
}

// ── Live integration: tokens, external-campaign upsert, sync ───────────────
const enc = (v) => (v ? crypto.encrypt(v) : null);
const dec = (v) => (v ? crypto.decrypt(v) : null);

/** INTERNAL: account row with decrypted OAuth tokens. Never return over HTTP. */
async function getAccountInternal({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM shared.ad_accounts WHERE ad_account_id = $1 AND business = $2`,
    [id, brand],
  );
  const a = rows[0];
  if (!a) return null;
  a.access_token = dec(a.access_token_enc);
  a.refresh_token = dec(a.refresh_token_enc);
  return a;
}

/** INTERNAL: every active account (all businesses) for the nightly sync. */
async function listActiveAccountsForSync() {
  const { rows } = await query(
    `SELECT * FROM shared.ad_accounts WHERE is_active = true`,
  );
  return rows.map((a) => ({
    ...a,
    access_token: dec(a.access_token_enc),
    refresh_token: dec(a.refresh_token_enc),
  }));
}

/** Store (encrypted) OAuth tokens against an account; COALESCE keeps the other. */
async function updateAccountTokens({ brand, id, access_token, refresh_token }) {
  const { rows } = await query(
    `UPDATE shared.ad_accounts
        SET access_token_enc  = COALESCE($3, access_token_enc),
            refresh_token_enc = COALESCE($4, refresh_token_enc),
            updated_at = now()
      WHERE ad_account_id = $1 AND business = $2
      RETURNING ad_account_id`,
    [id, brand, enc(access_token), enc(refresh_token)],
  );
  return rows[0] || null;
}

async function setAccountSynced({ id }) {
  await query(
    `UPDATE shared.ad_accounts SET last_sync_at = now() WHERE ad_account_id = $1`,
    [id],
  );
}

/** Upsert a campaign pulled from the platform; returns its internal id. */
async function upsertCampaignFromExternal({
  brand,
  ad_account_id,
  platform,
  c,
}) {
  const { rows } = await query(
    `INSERT INTO shared.ad_campaigns
       (business, ad_account_id, platform, external_campaign_id, name,
        objective, status, budget_amount, budget_currency, budget_type,
        start_date, end_date, external_created_at, last_external_sync_at)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'active'),$8,$9,$10,$11,$12,$13, now())
     ON CONFLICT (ad_account_id, external_campaign_id) DO UPDATE
       SET name = EXCLUDED.name,
           objective = COALESCE(EXCLUDED.objective, shared.ad_campaigns.objective),
           status = EXCLUDED.status,
           budget_amount = EXCLUDED.budget_amount,
           budget_currency = EXCLUDED.budget_currency,
           budget_type = EXCLUDED.budget_type,
           start_date = EXCLUDED.start_date,
           end_date = EXCLUDED.end_date,
           last_external_sync_at = now()
     RETURNING ad_campaign_id`,
    [
      brand,
      ad_account_id,
      platform,
      c.external_campaign_id,
      c.name,
      c.objective || null,
      c.status,
      c.budget_amount !== undefined ? c.budget_amount : null,
      c.budget_currency || null,
      c.budget_type || null,
      c.start_date || null,
      c.end_date || null,
      c.external_created_at || null,
    ],
  );
  return rows[0].ad_campaign_id;
}

/** INTERNAL: campaign joined to its account (decrypted tokens) for push ops. */
async function getCampaignForPush({ brand, id }) {
  const { rows } = await query(
    `SELECT c.*, a.external_account_id, a.currency AS account_currency,
            a.access_token_enc, a.refresh_token_enc
       FROM shared.ad_campaigns c
       JOIN shared.ad_accounts a ON a.ad_account_id = c.ad_account_id
      WHERE c.ad_campaign_id = $1 AND c.business = $2`,
    [id, brand],
  );
  const r = rows[0];
  if (!r) return null;
  r.account = {
    ad_account_id: r.ad_account_id,
    external_account_id: r.external_account_id,
    currency: r.account_currency,
    access_token: dec(r.access_token_enc),
    refresh_token: dec(r.refresh_token_enc),
  };
  delete r.access_token_enc;
  delete r.refresh_token_enc;
  return r;
}

module.exports = {
  createAdAccount,
  listAdAccounts,
  deactivateAdAccount,
  createAdCampaign,
  listAdCampaigns,
  getAdCampaign,
  setAdCampaignStatus,
  recordSpend,
  adSpendSummary,
  salesByUtmCampaign,
  // live integration
  getAccountInternal,
  listActiveAccountsForSync,
  updateAccountTokens,
  setAccountSynced,
  upsertCampaignFromExternal,
  getCampaignForPush,
};
