/**
 * AI vendor health repository — reads/writes for:
 *   - shared.ai_vendor_health_pings   (append-only ping log)
 *   - shared.ai_incidents             (failover + red-flip events)
 *   - shared.ai_vendor_credentials    (rolling health columns)
 */

"use strict";

const { query } = require("../../config/database");

async function insertPing({
  vendor,
  source,
  ok,
  latency_ms,
  http_status,
  error_code,
  error_message,
  checked_by,
}) {
  const { rows } = await query(
    `INSERT INTO shared.ai_vendor_health_pings
       (vendor, source, ok, latency_ms, http_status, error_code, error_message, checked_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING ping_id, checked_at`,
    [
      vendor,
      source,
      ok,
      latency_ms ?? null,
      http_status ?? null,
      error_code ?? null,
      error_message ?? null,
      checked_by ?? null,
    ],
  );
  return rows[0];
}

async function updateHealthState({ vendor, status, latency_ms, error }) {
  await query(
    `UPDATE shared.ai_vendor_credentials
        SET last_health_status = $2,
            last_health_at = now(),
            last_health_latency_ms = $3,
            last_health_error = $4,
            updated_at = now()
      WHERE vendor = $1`,
    [vendor, status, latency_ms ?? null, error ?? null],
  );
}

async function markTestOutcome({
  vendor,
  ok,
  latency_ms,
  error,
  user_id,
}) {
  const { rows } = await query(
    `UPDATE shared.ai_vendor_credentials
        SET last_test_ok_at = CASE WHEN $2 THEN now() ELSE last_test_ok_at END,
            last_test_latency_ms = $3,
            last_test_error = $4,
            last_test_by = $5,
            updated_at = now()
      WHERE vendor = $1
      RETURNING credential_id, vendor, last_test_ok_at, last_test_latency_ms, last_test_error`,
    [vendor, ok, latency_ms ?? null, error ?? null, user_id ?? null],
  );
  return rows[0] || null;
}

async function recentPings({ vendor, limit = 50 }) {
  const { rows } = await query(
    `SELECT ping_id, vendor, source, ok, latency_ms, http_status,
            error_code, error_message, checked_at, checked_by
       FROM shared.ai_vendor_health_pings
      WHERE ($1::text IS NULL OR vendor = $1)
      ORDER BY checked_at DESC
      LIMIT $2`,
    [vendor || null, limit],
  );
  return rows;
}

async function createIncident({
  incident_type,
  vendor,
  fallback_vendor,
  feature_key,
  business,
  severity,
  summary,
  details,
}) {
  const { rows } = await query(
    `INSERT INTO shared.ai_incidents
       (incident_type, vendor, fallback_vendor, feature_key, business,
        severity, summary, details, alert_sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::jsonb,'{}'::jsonb),now())
     RETURNING incident_id, created_at`,
    [
      incident_type,
      vendor,
      fallback_vendor ?? null,
      feature_key ?? null,
      business ?? null,
      severity || "warning",
      summary,
      details ? JSON.stringify(details) : null,
    ],
  );
  return rows[0];
}

async function resolveOpenIncidents({ vendor, incident_type }) {
  await query(
    `UPDATE shared.ai_incidents
        SET resolved_at = now()
      WHERE vendor = $1 AND incident_type = $2 AND resolved_at IS NULL`,
    [vendor, incident_type],
  );
}

async function listIncidents({ vendor, limit = 100 }) {
  const { rows } = await query(
    `SELECT incident_id, incident_type, vendor, fallback_vendor, feature_key,
            business, severity, summary, details, alert_sent_at,
            resolved_at, created_at
       FROM shared.ai_incidents
      WHERE ($1::text IS NULL OR vendor = $1)
      ORDER BY created_at DESC
      LIMIT $2`,
    [vendor || null, limit],
  );
  return rows;
}

async function countRecentFailovers({ vendor, since_minutes }) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n
       FROM shared.ai_incidents
      WHERE vendor = $1
        AND incident_type = 'failover_engaged'
        AND created_at >= now() - ($2::int || ' minutes')::interval`,
    [vendor, since_minutes],
  );
  return rows[0]?.n || 0;
}

/**
 * Success rate + call counts by vendor over a window. Powers the AI
 * Health page's success-rate meters and the "vendor status" cards.
 */
async function vendorSuccessRate({ since_hours = 24 } = {}) {
  const { rows } = await query(
    `SELECT provider AS vendor,
            COUNT(*)::int AS total_calls,
            SUM(CASE WHEN was_successful THEN 1 ELSE 0 END)::int AS successes,
            SUM(CASE WHEN was_successful THEN 0 ELSE 1 END)::int AS failures,
            ROUND(
              (SUM(CASE WHEN was_successful THEN 1 ELSE 0 END)::numeric
               / GREATEST(COUNT(*), 1)::numeric) * 100, 2
            )::float AS success_rate_pct,
            AVG(latency_ms) FILTER (WHERE was_successful)::int AS avg_latency_ms
       FROM shared.ai_usage_ledger
      WHERE occurred_at >= now() - ($1::int || ' hours')::interval
      GROUP BY provider
      ORDER BY provider`,
    [since_hours],
  );
  return rows;
}

async function recentErrors({ vendor, limit = 100 }) {
  const { rows } = await query(
    `SELECT usage_id, provider AS vendor, model, feature_key, business,
            error_code, error_message, latency_ms, occurred_at
       FROM shared.ai_usage_ledger
      WHERE was_successful = false
        AND ($1::text IS NULL OR provider = $1)
      ORDER BY occurred_at DESC
      LIMIT $2`,
    [vendor || null, limit],
  );
  return rows;
}

module.exports = {
  insertPing,
  updateHealthState,
  markTestOutcome,
  recentPings,
  createIncident,
  resolveOpenIncidents,
  listIncidents,
  countRecentFailovers,
  vendorSuccessRate,
  recentErrors,
};
