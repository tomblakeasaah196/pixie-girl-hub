/**
 * Business Setup / Identity (V2.2 Module 18 + §6.21) — repository.
 * Shared config tables: business_config, currencies, currency_rates (FX),
 * bank_accounts, tax_rates, document_numbering, custom_field_defs,
 * pipeline_stage_defs. All shared-schema; brand-scoped ones filter by
 * `business`. Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (client) => (client ? client.query.bind(client) : query);

// business_config columns the admin may edit (document_prefix is gated in the service).
const CONFIG_COLS = [
  "display_name",
  "legal_name",
  "trading_currency",
  "settlement_currency",
  "document_prefix",
  "storefront_domain",
  "storefront_enabled",
  // Sales Campaigns v2 — dynamic sales subdomain + brand voice + viewer policy.
  "sales_subdomain",
  "praxis_voice_profile",
  "show_viewer_count_policy",
  "viewer_count_floor",
  "address",
  "phone",
  "email",
  "support_email",
  "support_email_display_name",
  "website",
  "tin",
  "cac_number",
  "vat_number",
  "vat_rate",
  "wht_rate",
  "fiscal_year_start",
  "logo_path",
  "logo_alt_path",
  "favicon_path",
  "accent_colour",
  "secondary_colour",
  "mission_statement",
  "brand_fonts",
  "brand_theme",
  "payment_methods",
  "cash_handling_rules",
  "loyalty_settings",
  "cancellation_settings",
  "quantity_discount_rules",
  "intercompany_settings",
  "fx_settings",
  "payment_gateway_fees",
  "installment_settings",
  "allow_staff_recorded_manual_payments",
  "is_active",
];
const CONFIG_JSONB = new Set([
  "praxis_voice_profile",
  "brand_fonts",
  "brand_theme",
  "payment_methods",
  "cash_handling_rules",
  "loyalty_settings",
  "cancellation_settings",
  "quantity_discount_rules",
  "intercompany_settings",
  "fx_settings",
  "payment_gateway_fees",
  "installment_settings",
]);

function buildSet(cols, src, { jsonb = new Set() } = {}, start = 1) {
  const f = [];
  const p = [];
  let i = start;
  for (const col of cols) {
    if (src[col] === undefined) continue;
    if (jsonb.has(col)) {
      f.push(`${col} = $${i++}::jsonb`);
      p.push(JSON.stringify(src[col]));
    } else {
      f.push(`${col} = $${i++}`);
      p.push(src[col]);
    }
  }
  return { f, p, next: i };
}

// ── business_config ──────────────────────────────────────
async function getConfig({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.business_config WHERE business_key = $1`,
    [brand],
  );
  return rows[0] || null;
}
async function updateConfig({ client, brand, patch }) {
  const { f, p, next } = buildSet(CONFIG_COLS, patch, { jsonb: CONFIG_JSONB });
  if (f.length === 0) return getConfig({ client, brand });
  const { rows } = await ex(client)(
    `UPDATE shared.business_config SET ${f.join(", ")} WHERE business_key = $${next} RETURNING *`,
    [...p, brand],
  );
  return rows[0] || null;
}

// ── currencies (global) ──────────────────────────────────
async function listCurrencies({ client }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.currencies ORDER BY display_order, currency_code`,
  );
  return rows;
}
async function upsertCurrency({ client, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.currencies (currency_code, display_name, symbol, decimal_places, rounding_unit, is_settlement, is_active, display_order)
     VALUES ($1,$2,$3,COALESCE($4,2),COALESCE($5,1),COALESCE($6,false),COALESCE($7,true),COALESCE($8,0))
     ON CONFLICT (currency_code) DO UPDATE SET
       display_name = COALESCE(EXCLUDED.display_name, shared.currencies.display_name),
       symbol = COALESCE(EXCLUDED.symbol, shared.currencies.symbol),
       decimal_places = EXCLUDED.decimal_places, rounding_unit = EXCLUDED.rounding_unit,
       is_settlement = EXCLUDED.is_settlement, is_active = EXCLUDED.is_active, display_order = EXCLUDED.display_order
     RETURNING *`,
    [
      row.currency_code,
      row.display_name || null,
      row.symbol || null,
      row.decimal_places ?? null,
      row.rounding_unit ?? null,
      row.is_settlement,
      row.is_active,
      row.display_order ?? null,
    ],
  );
  return rows[0];
}
async function updateCurrency({ client, code, patch }) {
  const cols = [
    "display_name",
    "symbol",
    "decimal_places",
    "rounding_unit",
    "is_settlement",
    "is_active",
    "display_order",
  ];
  const { f, p, next } = buildSet(cols, patch);
  if (f.length === 0) return null;
  const { rows } = await ex(client)(
    `UPDATE shared.currencies SET ${f.join(", ")} WHERE currency_code = $${next} RETURNING *`,
    [...p, code],
  );
  return rows[0] || null;
}

// ── currency_rates (FX) ──────────────────────────────────
async function listRates({ client, from, to, limit = 100 }) {
  const where = [];
  const params = [];
  let i = 1;
  if (from) {
    where.push(`from_currency = $${i++}`);
    params.push(from);
  }
  if (to) {
    where.push(`to_currency = $${i++}`);
    params.push(to);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await ex(client)(
    `SELECT * FROM shared.currency_rates ${w} ORDER BY valid_at DESC LIMIT $${i++}`,
    [...params, limit],
  );
  return rows;
}
async function latestRate({ client, from, to = "NGN" }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.currency_rates WHERE from_currency = $1 AND to_currency = $2 ORDER BY valid_at DESC LIMIT 1`,
    [from, to],
  );
  return rows[0] || null;
}
async function insertRate({ client, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.currency_rates (from_currency, to_currency, rate, source, is_manual_override, set_by, valid_at)
     VALUES ($1,COALESCE($2,'NGN'),$3,$4,COALESCE($5,false),$6,COALESCE($7, now())) RETURNING *`,
    [
      row.from_currency,
      row.to_currency,
      row.rate,
      row.source || null,
      row.is_manual_override,
      row.set_by || null,
      row.valid_at || null,
    ],
  );
  return rows[0];
}

// ── bank_accounts ────────────────────────────────────────
async function listBankAccounts({ client, brand, is_active }) {
  const where = ["business = $1"];
  const params = [brand];
  let i = 2;
  if (is_active !== undefined) {
    where.push(`is_active = $${i++}`);
    params.push(is_active);
  }
  const { rows } = await ex(client)(
    `SELECT * FROM shared.bank_accounts WHERE ${where.join(" AND ")} ORDER BY is_primary DESC, bank_name`,
    params,
  );
  return rows;
}
async function getBankAccount({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.bank_accounts WHERE account_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}
async function createBankAccount({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.bank_accounts (business, bank_name, account_name, account_number, sort_code, currency, is_primary, paystack_recipient_code, opay_account_id)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'NGN'),COALESCE($7,false),$8,$9) RETURNING *`,
    [
      brand,
      row.bank_name,
      row.account_name,
      row.account_number,
      row.sort_code || null,
      row.currency,
      row.is_primary,
      row.paystack_recipient_code || null,
      row.opay_account_id || null,
    ],
  );
  return rows[0];
}
async function updateBankAccount({ client, brand, id, patch }) {
  const cols = [
    "bank_name",
    "account_name",
    "account_number",
    "sort_code",
    "currency",
    "is_primary",
    "paystack_recipient_code",
    "opay_account_id",
    "is_active",
  ];
  const { f, p, next } = buildSet(cols, patch);
  if (f.length === 0) return getBankAccount({ client, brand, id });
  const { rows } = await ex(client)(
    `UPDATE shared.bank_accounts SET ${f.join(", ")} WHERE account_id = $${next} AND business = $${next + 1} RETURNING *`,
    [...p, id, brand],
  );
  return rows[0] || null;
}
async function clearPrimaryBankAccounts({ client, brand }) {
  await ex(client)(
    `UPDATE shared.bank_accounts SET is_primary = false WHERE business = $1 AND is_primary = true`,
    [brand],
  );
}

// ── tax_rates ────────────────────────────────────────────
async function listTaxRates({ client, brand, tax_type, active }) {
  const where = ["business = $1"];
  const params = [brand];
  let i = 2;
  if (tax_type) {
    where.push(`tax_type = $${i++}`);
    params.push(tax_type);
  }
  if (active !== undefined) {
    where.push(`is_active = $${i++}`);
    params.push(active);
  }
  const { rows } = await ex(client)(
    `SELECT * FROM shared.tax_rates WHERE ${where.join(" AND ")} ORDER BY tax_name, effective_from DESC`,
    params,
  );
  return rows;
}
async function getTaxRate({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.tax_rates WHERE tax_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}
async function createTaxRate({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.tax_rates (business, tax_name, tax_type, rate, applies_to, is_active, effective_from, effective_to, excluded_modules)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,true),$7,$8,COALESCE($9,'{}')) RETURNING *`,
    [
      brand,
      row.tax_name,
      row.tax_type,
      row.rate,
      row.applies_to,
      row.is_active,
      row.effective_from,
      row.effective_to || null,
      row.excluded_modules || null,
    ],
  );
  return rows[0];
}
// Toggle a tax on/off system-wide or adjust which modules it's excluded
// from. Only the supplied fields change. `excluded_modules` replaces the
// whole array (the UI sends the full desired set).
async function updateTaxRate({ client, brand, id, patch }) {
  const sets = [];
  const params = [id, brand];
  let i = 3;
  for (const col of ["is_active", "rate", "applies_to", "tax_name"]) {
    if (patch[col] === undefined) continue;
    sets.push(`${col} = $${i++}`);
    params.push(patch[col]);
  }
  if (patch.excluded_modules !== undefined) {
    sets.push(`excluded_modules = $${i++}`);
    params.push(patch.excluded_modules);
  }
  if (sets.length === 0) return getTaxRate({ client, brand, id });
  const { rows } = await ex(client)(
    `UPDATE shared.tax_rates SET ${sets.join(", ")} WHERE tax_id = $1 AND business = $2 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
// The system-wide resolver every other module calls: "what taxes apply
// to {module} for {tax_type} right now?". Honours is_active, the
// effective-date window, and excluded_modules.
async function listEffectiveTaxes({ client, brand, tax_type, module }) {
  const where = [
    "business = $1",
    "is_active = true",
    "effective_from <= CURRENT_DATE",
    "(effective_to IS NULL OR effective_to >= CURRENT_DATE)",
  ];
  const params = [brand];
  let i = 2;
  if (tax_type) {
    where.push(`tax_type = $${i++}`);
    params.push(tax_type);
  }
  if (module) {
    where.push(`NOT ($${i++} = ANY(excluded_modules))`);
    params.push(module);
  }
  const { rows } = await ex(client)(
    `SELECT * FROM shared.tax_rates WHERE ${where.join(" AND ")} ORDER BY tax_name`,
    params,
  );
  return rows;
}
async function supersedeTaxRate({ client, brand, id, effective_to }) {
  const { rows } = await ex(client)(
    `UPDATE shared.tax_rates SET is_active = false, effective_to = $3 WHERE tax_id = $1 AND business = $2 RETURNING *`,
    [id, brand, effective_to],
  );
  return rows[0] || null;
}

// ── document_numbering ───────────────────────────────────
async function listNumbering({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.document_numbering WHERE business = $1 ORDER BY document_type`,
    [brand],
  );
  return rows;
}
async function getNumbering({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.document_numbering WHERE seq_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}
async function updateNumbering({ client, brand, id, patch }) {
  const cols = ["prefix", "padding"];
  const { f, p, next } = buildSet(cols, patch);
  if (f.length === 0) return getNumbering({ client, brand, id });
  const { rows } = await ex(client)(
    `UPDATE shared.document_numbering SET ${f.join(", ")} WHERE seq_id = $${next} AND business = $${next + 1} RETURNING *`,
    [...p, id, brand],
  );
  return rows[0] || null;
}

// ── custom_field_defs ────────────────────────────────────
async function listCustomFields({ client, brand, entity_type, active }) {
  const where = ["business = $1"];
  const params = [brand];
  let i = 2;
  if (entity_type) {
    where.push(`entity_type = $${i++}`);
    params.push(entity_type);
  }
  if (active !== undefined) {
    where.push(`is_active = $${i++}`);
    params.push(active);
  }
  const { rows } = await ex(client)(
    `SELECT * FROM shared.custom_field_defs WHERE ${where.join(" AND ")} ORDER BY entity_type, display_order`,
    params,
  );
  return rows;
}
async function getCustomField({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.custom_field_defs WHERE field_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}
async function createCustomField({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.custom_field_defs (business, entity_type, field_key, field_label, field_type, options, is_required, is_searchable, is_filterable, visible_to_roles, display_order, is_active)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,COALESCE($7,false),COALESCE($8,false),COALESCE($9,false),COALESCE($10,'{}'),COALESCE($11,0),COALESCE($12,true)) RETURNING *`,
    [
      brand,
      row.entity_type,
      row.field_key,
      row.field_label,
      row.field_type,
      JSON.stringify(row.options || []),
      row.is_required,
      row.is_searchable,
      row.is_filterable,
      row.visible_to_roles || [],
      row.display_order ?? null,
      row.is_active,
    ],
  );
  return rows[0];
}
async function updateCustomField({ client, brand, id, patch }) {
  const cols = [
    "field_label",
    "field_type",
    "options",
    "is_required",
    "is_searchable",
    "is_filterable",
    "visible_to_roles",
    "display_order",
    "is_active",
  ];
  const { f, p, next } = buildSet(cols, patch, { jsonb: new Set(["options"]) });
  if (f.length === 0) return getCustomField({ client, brand, id });
  const { rows } = await ex(client)(
    `UPDATE shared.custom_field_defs SET ${f.join(", ")} WHERE field_id = $${next} AND business = $${next + 1} RETURNING *`,
    [...p, id, brand],
  );
  return rows[0] || null;
}

// ── pipeline_stage_defs ──────────────────────────────────
async function listPipelineStages({ client, brand, pipeline_type }) {
  const where = ["business = $1"];
  const params = [brand];
  let i = 2;
  if (pipeline_type) {
    where.push(`pipeline_type = $${i++}`);
    params.push(pipeline_type);
  }
  const { rows } = await ex(client)(
    `SELECT * FROM shared.pipeline_stage_defs WHERE ${where.join(" AND ")} ORDER BY pipeline_type, display_order`,
    params,
  );
  return rows;
}
async function createPipelineStage({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.pipeline_stage_defs (business, pipeline_type, stage_key, stage_label, display_order, is_terminal, is_positive_terminal, colour)
     VALUES ($1,$2,$3,$4,COALESCE($5,0),COALESCE($6,false),$7,$8) RETURNING *`,
    [
      brand,
      row.pipeline_type,
      row.stage_key,
      row.stage_label,
      row.display_order ?? null,
      row.is_terminal,
      row.is_positive_terminal ?? null,
      row.colour || null,
    ],
  );
  return rows[0];
}
async function updatePipelineStage({ client, brand, id, patch }) {
  const cols = [
    "stage_label",
    "display_order",
    "is_terminal",
    "is_positive_terminal",
    "colour",
  ];
  const { f, p, next } = buildSet(cols, patch);
  if (f.length === 0) return null;
  const { rows } = await ex(client)(
    `UPDATE shared.pipeline_stage_defs SET ${f.join(", ")} WHERE stage_id = $${next} AND business = $${next + 1} RETURNING *`,
    [...p, id, brand],
  );
  return rows[0] || null;
}
async function deletePipelineStage({ client, brand, id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM shared.pipeline_stage_defs WHERE stage_id = $1 AND business = $2`,
    [id, brand],
  );
  return rowCount > 0;
}

module.exports = {
  getConfig,
  updateConfig,
  listCurrencies,
  upsertCurrency,
  updateCurrency,
  listRates,
  latestRate,
  insertRate,
  listBankAccounts,
  getBankAccount,
  createBankAccount,
  updateBankAccount,
  clearPrimaryBankAccounts,
  listTaxRates,
  getTaxRate,
  createTaxRate,
  updateTaxRate,
  supersedeTaxRate,
  listEffectiveTaxes,
  listNumbering,
  getNumbering,
  updateNumbering,
  listCustomFields,
  getCustomField,
  createCustomField,
  updateCustomField,
  listPipelineStages,
  createPipelineStage,
  updatePipelineStage,
  deletePipelineStage,
};
