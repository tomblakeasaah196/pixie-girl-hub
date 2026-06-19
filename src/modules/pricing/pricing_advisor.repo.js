/**
 * Pricing advisor — repository. The product-centric layer: config (the
 * advisor's knobs), a rich variant brief (current prices + cost + tax + USD),
 * fixed-USD writes, and the per-business VAT rate. Reuses pricing.repo for the
 * shared machinery (floors, write-back, history).
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");

const ex = (client) => (client ? client.query.bind(client) : query);

const DEFAULT_CHANNEL_FEES = [
  { channel: "website", label: "Website", pct: 0.029, fixed_ngn: 100 },
  { channel: "instagram", label: "Instagram", pct: 0, fixed_ngn: 500 },
  { channel: "jumia", label: "Jumia", pct: 0.12, fixed_ngn: 0 },
  { channel: "konga", label: "Konga", pct: 0.1, fixed_ngn: 0 },
  { channel: "wholesale", label: "Wholesale", pct: 0, fixed_ngn: 0 },
];

// ── pricing_config (singleton) ───────────────────────────
async function getConfig({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "pricing_config")} WHERE singleton = true`,
  );
  return rows[0] || null;
}

async function upsertConfig({ client, brand, patch, user_id }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "pricing_config")}
       (singleton, instant_apply_threshold_pct, default_target_margin_pct, round_to_ngn, channel_fees, updated_by)
     VALUES (true, COALESCE($1,10), COALESCE($2,55), COALESCE($3,500),
             COALESCE($4::jsonb, $5::jsonb), $6)
     ON CONFLICT (singleton) DO UPDATE SET
       instant_apply_threshold_pct = COALESCE($1, ${t(brand, "pricing_config")}.instant_apply_threshold_pct),
       default_target_margin_pct   = COALESCE($2, ${t(brand, "pricing_config")}.default_target_margin_pct),
       round_to_ngn                = COALESCE($3, ${t(brand, "pricing_config")}.round_to_ngn),
       channel_fees                = COALESCE($4::jsonb, ${t(brand, "pricing_config")}.channel_fees),
       updated_by = $6, updated_at = now()
     RETURNING *`,
    [
      patch.instant_apply_threshold_pct ?? null,
      patch.default_target_margin_pct ?? null,
      patch.round_to_ngn ?? null,
      patch.channel_fees ? JSON.stringify(patch.channel_fees) : null,
      JSON.stringify(DEFAULT_CHANNEL_FEES),
      user_id || null,
    ],
  );
  return rows[0];
}

// ── Variant brief (everything the advisor needs in one read) ──
async function variantBrief({ client, brand, variant_id }) {
  const { rows } = await ex(client)(
    `SELECT pv.variant_id, pv.sku, pv.variant_name,
            pv.price_storefront_ngn, pv.price_pos_ngn, pv.price_wholesale_ngn,
            pv.price_partner_ngn, pv.compare_at_price_ngn, pv.price_usd,
            pv.cost_price_ngn, pv.min_price_ngn,
            p.product_id, p.name AS product_name, p.taxable, p.vat_rate AS product_vat_rate
       FROM ${t(brand, "product_variants")} pv
       JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
      WHERE pv.variant_id = $1`,
    [variant_id],
  );
  return rows[0] || null;
}

async function setUsdPrice({ client, brand, variant_id, price_usd }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "product_variants")} SET price_usd = $2, updated_at = now()
      WHERE variant_id = $1 RETURNING variant_id, price_usd`,
    [variant_id, price_usd],
  );
  return rows[0] || null;
}

// ── Per-business VAT rate (Settings is the source of truth) ──
async function businessTax({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT vat_rate, trading_currency FROM shared.business_config WHERE business_key = $1`,
    [brand],
  );
  return rows[0] || { vat_rate: 0, trading_currency: "NGN" };
}

module.exports = {
  DEFAULT_CHANNEL_FEES,
  getConfig,
  upsertConfig,
  variantBrief,
  setUsdPrice,
  businessTax,
};
