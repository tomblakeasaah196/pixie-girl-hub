/**
 * Kaizen alerts repository — parameterised SQL only.
 * Rules (kaizen_alert_rules) + alerts (kaizen_alerts).
 */

"use strict";

const { query } = require("../../../config/database");

// ── Rules ────────────────────────────────────────────────────────────────────

async function listRules() {
  const { rows } = await query(
    `SELECT rule_id, name, condition_type, threshold, channels, enabled, updated_at
       FROM shared.kaizen_alert_rules
      ORDER BY name ASC`,
  );
  return rows;
}

async function getRuleByType(conditionType) {
  const { rows } = await query(
    `SELECT * FROM shared.kaizen_alert_rules WHERE condition_type = $1 LIMIT 1`,
    [conditionType],
  );
  return rows[0] || null;
}

async function updateRule(ruleId, { enabled, threshold, channels }) {
  const { rows } = await query(
    `UPDATE shared.kaizen_alert_rules
        SET enabled   = COALESCE($2, enabled),
            threshold = COALESCE($3, threshold),
            channels  = COALESCE($4, channels),
            updated_at = now()
      WHERE rule_id = $1
      RETURNING *`,
    [ruleId, enabled ?? null, threshold ? JSON.stringify(threshold) : null, channels || null],
  );
  return rows[0] || null;
}

// ── Alerts ───────────────────────────────────────────────────────────────────

/** Is there a live alert with this dedupe_key inside the window (minutes)? */
async function findRecentByDedupe(dedupeKey, windowMin) {
  if (!dedupeKey) return null;
  const { rows } = await query(
    `SELECT alert_id FROM shared.kaizen_alerts
      WHERE dedupe_key = $1
        AND created_at > now() - ($2 || ' minutes')::interval
      ORDER BY created_at DESC LIMIT 1`,
    [dedupeKey, String(windowMin)],
  );
  return rows[0] || null;
}

async function createAlert({ ruleId, kind, severity, title, body, sourceRef, dedupeKey, channelsSent }) {
  const { rows } = await query(
    `INSERT INTO shared.kaizen_alerts
       (rule_id, kind, severity, title, body, source_ref, dedupe_key, channels_sent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [ruleId || null, kind, severity, title, body || null, sourceRef || null,
     dedupeKey || null, JSON.stringify(channelsSent || {})],
  );
  return rows[0];
}

async function listAlerts({ status, page = 1, pageSize = 30 }) {
  const where = [];
  const params = [];
  let i = 1;
  if (status) { where.push(`status = $${i++}`); params.push(status); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.kaizen_alerts ${whereSql}`,
    params,
  );
  const { rows } = await query(
    `SELECT alert_id, rule_id, kind, severity, title, body, source_ref, status,
            channels_sent, acknowledged_by, acknowledged_at, created_at
       FROM shared.kaizen_alerts
       ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { rows, total: c[0].total };
}

async function acknowledge(alertId, operatorId) {
  const { rows } = await query(
    `UPDATE shared.kaizen_alerts
        SET status = 'acknowledged', acknowledged_by = $2, acknowledged_at = now()
      WHERE alert_id = $1 AND status = 'active'
      RETURNING alert_id, status`,
    [alertId, operatorId],
  );
  return rows[0] || null;
}

async function activeCount() {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM shared.kaizen_alerts WHERE status = 'active'`,
  );
  return rows[0].n;
}

async function pruneOlderThan(days = 90) {
  await query(
    `DELETE FROM shared.kaizen_alerts
      WHERE status != 'active' AND created_at < now() - ($1 || ' days')::interval`,
    [String(days)],
  );
}

module.exports = {
  listRules,
  getRuleByType,
  updateRule,
  findRecentByDedupe,
  createAlert,
  listAlerts,
  acknowledge,
  activeCount,
  pruneOlderThan,
};
