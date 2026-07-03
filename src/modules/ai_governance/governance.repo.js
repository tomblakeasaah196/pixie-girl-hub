/**
 * AI Governance (V2.2 §6.31 / §8.1) — repository.
 *
 * SHARED tables: ai_feature_flags, ai_access_grants, ai_vendor_credentials,
 * ai_budget_periods, ai_usage_ledger, ai_usage_daily, ai_action_catalogue.
 * Vendor API keys are stored AES-256-GCM encrypted (encryption.service); the
 * read API never returns the ciphertext. ai_usage_ledger is append-only — its
 * insert trigger maintains budget-period totals + ai_usage_daily.
 */

"use strict";

const { query, ex } = require("../../config/database");
// ── Feature flags ──────────────────────────────────────────
async function listFlags() {
  const { rows } = await query(
    `SELECT * FROM shared.ai_feature_flags ORDER BY feature_key`,
  );
  return rows;
}
async function findFlag({ client, feature_key }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.ai_feature_flags WHERE feature_key = $1`,
    [feature_key],
  );
  return rows[0] || null;
}
async function upsertFlag({ flag, user_id }) {
  const { rows } = await query(
    `INSERT INTO shared.ai_feature_flags
       (feature_key, display_name, description, is_enabled, default_provider,
        default_model, est_cost_per_call_ngn, last_changed_by, last_changed_at)
     VALUES ($1,$2,$3,COALESCE($4,true),COALESCE($5,'deepseek'),
             COALESCE($6,'deepseek-chat'),$7,$8,now())
     ON CONFLICT (feature_key) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           description = EXCLUDED.description,
           is_enabled = EXCLUDED.is_enabled,
           default_provider = EXCLUDED.default_provider,
           default_model = EXCLUDED.default_model,
           est_cost_per_call_ngn = EXCLUDED.est_cost_per_call_ngn,
           last_changed_by = EXCLUDED.last_changed_by,
           last_changed_at = now(),
           updated_at = now()
     RETURNING *`,
    [
      flag.feature_key,
      flag.display_name,
      flag.description || null,
      flag.is_enabled === undefined ? null : flag.is_enabled,
      flag.default_provider || null,
      flag.default_model || null,
      flag.est_cost_per_call_ngn === undefined
        ? null
        : flag.est_cost_per_call_ngn,
      user_id || null,
    ],
  );
  return rows[0];
}
async function setFlagEnabled({ feature_key, is_enabled, user_id }) {
  const { rows } = await query(
    `UPDATE shared.ai_feature_flags
        SET is_enabled = $2, last_changed_by = $3, last_changed_at = now(), updated_at = now()
      WHERE feature_key = $1 RETURNING *`,
    [feature_key, is_enabled, user_id || null],
  );
  return rows[0] || null;
}

// ── Access grants ──────────────────────────────────────────
async function listGrants({ user_id, feature_key }) {
  const where = ["revoked_at IS NULL"];
  const params = [];
  let i = 1;
  if (user_id) {
    where.push(`user_id = $${i++}`);
    params.push(user_id);
  }
  if (feature_key) {
    where.push(`feature_key = $${i++}`);
    params.push(feature_key);
  }
  const { rows } = await query(
    `SELECT * FROM shared.ai_access_grants WHERE ${where.join(" AND ")} ORDER BY granted_at DESC`,
    params,
  );
  return rows;
}
async function hasGrant({ client, user_id, feature_key }) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM shared.ai_access_grants
      WHERE user_id = $1 AND feature_key = $2 AND revoked_at IS NULL LIMIT 1`,
    [user_id, feature_key],
  );
  return rows.length > 0;
}
async function grant({ g, granted_by }) {
  const { rows } = await query(
    `INSERT INTO shared.ai_access_grants (user_id, feature_key, monthly_cap_ngn, granted_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, feature_key) DO UPDATE
       SET monthly_cap_ngn = EXCLUDED.monthly_cap_ngn,
           granted_by = EXCLUDED.granted_by, granted_at = now(),
           revoked_at = NULL, revoked_reason = NULL
     RETURNING *`,
    [
      g.user_id,
      g.feature_key,
      g.monthly_cap_ngn === undefined ? null : g.monthly_cap_ngn,
      granted_by || null,
    ],
  );
  return rows[0];
}
async function revokeGrant({ grant_id, reason }) {
  const { rows } = await query(
    `UPDATE shared.ai_access_grants SET revoked_at = now(), revoked_reason = $2
      WHERE grant_id = $1 AND revoked_at IS NULL RETURNING grant_id`,
    [grant_id, reason || null],
  );
  return rows[0] || null;
}

// ── Vendor credentials (keys encrypted; never returned raw) ─
async function listVendors() {
  const { rows } = await query(
    `SELECT credential_id, vendor, display_name, endpoint_url, default_model, current_model,
            cost_per_1k_input_tokens, cost_per_1k_output_tokens, cost_per_audio_minute,
            cost_native_currency, per_vendor_monthly_cap_ngn, is_active,
            (api_key_enc IS NOT NULL) AS has_api_key, last_rotated_at, created_at, updated_at
       FROM shared.ai_vendor_credentials ORDER BY vendor`,
  );
  return rows;
}
async function getVendorRaw({ client, vendor }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.ai_vendor_credentials WHERE vendor = $1`,
    [vendor],
  );
  return rows[0] || null;
}
async function upsertVendor({ v }) {
  const { rows } = await query(
    `INSERT INTO shared.ai_vendor_credentials
       (vendor, display_name, api_key_enc, org_id_enc, endpoint_url, default_model, current_model,
        cost_per_1k_input_tokens, cost_per_1k_output_tokens, cost_per_audio_minute,
        cost_native_currency, per_vendor_monthly_cap_ngn)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,0),COALESCE($9,0),COALESCE($10,0),$11,$12)
     ON CONFLICT (vendor) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           api_key_enc = COALESCE(EXCLUDED.api_key_enc, shared.ai_vendor_credentials.api_key_enc),
           org_id_enc = COALESCE(EXCLUDED.org_id_enc, shared.ai_vendor_credentials.org_id_enc),
           endpoint_url = EXCLUDED.endpoint_url,
           default_model = EXCLUDED.default_model,
           current_model = EXCLUDED.current_model,
           cost_per_1k_input_tokens = EXCLUDED.cost_per_1k_input_tokens,
           cost_per_1k_output_tokens = EXCLUDED.cost_per_1k_output_tokens,
           cost_per_audio_minute = EXCLUDED.cost_per_audio_minute,
           cost_native_currency = EXCLUDED.cost_native_currency,
           per_vendor_monthly_cap_ngn = EXCLUDED.per_vendor_monthly_cap_ngn,
           updated_at = now()
     RETURNING credential_id, vendor, display_name, current_model`,
    [
      v.vendor,
      v.display_name,
      v.api_key_enc || null,
      v.org_id_enc || null,
      v.endpoint_url || null,
      v.default_model || null,
      v.current_model || null,
      v.cost_per_1k_input_tokens === undefined
        ? null
        : v.cost_per_1k_input_tokens,
      v.cost_per_1k_output_tokens === undefined
        ? null
        : v.cost_per_1k_output_tokens,
      v.cost_per_audio_minute === undefined ? null : v.cost_per_audio_minute,
      v.cost_native_currency || null,
      v.per_vendor_monthly_cap_ngn === undefined
        ? null
        : v.per_vendor_monthly_cap_ngn,
    ],
  );
  return rows[0];
}
async function rotateVendorKey({ vendor, api_key_enc, user_id }) {
  const { rows } = await query(
    `UPDATE shared.ai_vendor_credentials
        SET api_key_enc = $2, last_rotated_at = now(), last_rotated_by = $3, updated_at = now()
      WHERE vendor = $1 RETURNING credential_id, vendor`,
    [vendor, api_key_enc, user_id || null],
  );
  return rows[0] || null;
}
async function setVendorActive({ vendor, is_active }) {
  const { rows } = await query(
    `UPDATE shared.ai_vendor_credentials SET is_active = $2, updated_at = now()
      WHERE vendor = $1 RETURNING credential_id, vendor, is_active`,
    [vendor, is_active],
  );
  return rows[0] || null;
}

// ── Budget periods ─────────────────────────────────────────
async function activePeriod({ client }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.ai_budget_periods
      WHERE is_active = true AND CURRENT_DATE BETWEEN period_start AND period_end
      ORDER BY period_start DESC LIMIT 1`,
  );
  return rows[0] || null;
}
async function listPeriods() {
  const { rows } = await query(
    `SELECT * FROM shared.ai_budget_periods ORDER BY period_start DESC`,
  );
  return rows;
}
async function createPeriod({ p, user_id }) {
  const { rows } = await query(
    `INSERT INTO shared.ai_budget_periods
       (period_start, period_end, soft_cap_ngn, hard_cap_ngn, set_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [
      p.period_start,
      p.period_end,
      p.soft_cap_ngn,
      p.hard_cap_ngn,
      user_id || null,
    ],
  );
  return rows[0];
}
async function setCaps({ period_id, soft_cap_ngn, hard_cap_ngn }) {
  const { rows } = await query(
    `UPDATE shared.ai_budget_periods
        SET soft_cap_ngn = COALESCE($2, soft_cap_ngn),
            hard_cap_ngn = COALESCE($3, hard_cap_ngn), updated_at = now()
      WHERE period_id = $1 RETURNING *`,
    [period_id, soft_cap_ngn ?? null, hard_cap_ngn ?? null],
  );
  return rows[0] || null;
}

// ── Usage ledger (append-only; trigger maintains period + daily) ─
async function recordUsage({ client, u }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.ai_usage_ledger
       (user_id, feature_key, business, conversation_id, run_id, period_id,
        provider, model, call_type, audio_seconds, input_tokens, output_tokens,
        total_tokens, cost_native, cost_native_currency, cost_ngn, latency_ms,
        was_successful, error_code, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,0),COALESCE($11,0),
             COALESCE($12,0),COALESCE($13,0),COALESCE($14::numeric,0),$15,
             COALESCE($16::numeric,0),
             $17,COALESCE($18,true),$19,$20)
     RETURNING usage_id, cost_ngn, occurred_at`,
    [
      u.user_id || null,
      u.feature_key,
      u.business || null,
      u.conversation_id || null,
      u.run_id || null,
      u.period_id || null,
      u.provider,
      u.model,
      u.call_type,
      u.audio_seconds,
      u.input_tokens,
      u.output_tokens,
      u.total_tokens,
      u.cost_native,
      u.cost_native_currency || null,
      u.cost_ngn,
      u.latency_ms || null,
      u.was_successful === undefined ? null : u.was_successful,
      u.error_code || null,
      u.error_message || null,
    ],
  );
  return rows[0];
}
async function listUsage({
  feature_key,
  user_id,
  from,
  to,
  page = 1,
  page_size = 50,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (feature_key) {
    where.push(`feature_key = $${i++}`);
    params.push(feature_key);
  }
  if (user_id) {
    where.push(`user_id = $${i++}`);
    params.push(user_id);
  }
  if (from) {
    where.push(`occurred_at >= $${i++}`);
    params.push(from);
  }
  if (to) {
    where.push(`occurred_at <= $${i++}`);
    params.push(to);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT * FROM shared.ai_usage_ledger ${w}
      ORDER BY occurred_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return rows;
}
async function usageDaily({ from, to, feature_key, vendor }) {
  const where = [];
  const params = [];
  let i = 1;
  if (from) {
    where.push(`metric_date >= $${i++}`);
    params.push(from);
  }
  if (to) {
    where.push(`metric_date <= $${i++}`);
    params.push(to);
  }
  if (feature_key) {
    where.push(`feature_key = $${i++}`);
    params.push(feature_key);
  }
  if (vendor) {
    where.push(`vendor = $${i++}`);
    params.push(vendor);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT metric_date, feature_key, vendor,
            SUM(calls_count)::int AS calls,
            SUM(total_tokens)::bigint AS tokens,
            SUM(cost_ngn) AS cost_ngn,
            SUM(failed_calls_count)::int AS failed
       FROM shared.ai_usage_daily ${w}
      GROUP BY metric_date, feature_key, vendor
      ORDER BY metric_date DESC`,
    params,
  );
  return rows;
}

// ── Action catalogue ───────────────────────────────────────
async function listActions({ module, category, ai_enabled, is_write }) {
  const where = [];
  const params = [];
  let i = 1;
  if (module) {
    where.push(`module = $${i++}`);
    params.push(module);
  }
  if (category) {
    where.push(`category = $${i++}`);
    params.push(category);
  }
  if (ai_enabled !== undefined) {
    where.push(`ai_enabled = $${i++}`);
    params.push(ai_enabled);
  }
  if (is_write !== undefined) {
    where.push(`is_write = $${i++}`);
    params.push(is_write);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT * FROM shared.ai_action_catalogue ${w} ORDER BY module, action_key`,
    params,
  );
  return rows;
}
async function findAction({ client, action_key }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.ai_action_catalogue WHERE action_key = $1`,
    [action_key],
  );
  return rows[0] || null;
}
async function upsertAction({ a }) {
  const { rows } = await query(
    `INSERT INTO shared.ai_action_catalogue
       (action_key, title, method, route, description, module, category,
        is_write, entity_scope, payload_schema, required_permission, ai_enabled,
        min_confidence, requires_confirmation, examples)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,false),COALESCE($9,'both'),
             COALESCE($10,'{}'::jsonb),$11,COALESCE($12,false),COALESCE($13,0.80),
             COALESCE($14,true),COALESCE($15,'[]'::jsonb))
     ON CONFLICT (action_key) DO UPDATE
       SET title = EXCLUDED.title, method = EXCLUDED.method, route = EXCLUDED.route,
           description = EXCLUDED.description, module = EXCLUDED.module,
           category = EXCLUDED.category, is_write = EXCLUDED.is_write,
           entity_scope = EXCLUDED.entity_scope, payload_schema = EXCLUDED.payload_schema,
           required_permission = EXCLUDED.required_permission,
           min_confidence = EXCLUDED.min_confidence,
           requires_confirmation = EXCLUDED.requires_confirmation,
           examples = EXCLUDED.examples, updated_at = now()
     RETURNING *`,
    [
      a.action_key,
      a.title,
      a.method,
      a.route,
      a.description,
      a.module,
      a.category,
      a.is_write === undefined ? null : a.is_write,
      a.entity_scope || null,
      a.payload_schema ? JSON.stringify(a.payload_schema) : null,
      a.required_permission,
      a.ai_enabled === undefined ? null : a.ai_enabled,
      a.min_confidence === undefined ? null : a.min_confidence,
      a.requires_confirmation === undefined ? null : a.requires_confirmation,
      a.examples ? JSON.stringify(a.examples) : null,
    ],
  );
  return rows[0];
}
async function setActionEnabled({ action_key, ai_enabled }) {
  const { rows } = await query(
    `UPDATE shared.ai_action_catalogue SET ai_enabled = $2, updated_at = now()
      WHERE action_key = $1 RETURNING action_id, action_key, ai_enabled`,
    [action_key, ai_enabled],
  );
  return rows[0] || null;
}

module.exports = {
  listFlags,
  findFlag,
  upsertFlag,
  setFlagEnabled,
  listGrants,
  hasGrant,
  grant,
  revokeGrant,
  listVendors,
  getVendorRaw,
  upsertVendor,
  rotateVendorKey,
  setVendorActive,
  activePeriod,
  listPeriods,
  createPeriod,
  setCaps,
  recordUsage,
  listUsage,
  usageDaily,
  listActions,
  findAction,
  upsertAction,
  setActionEnabled,
};
