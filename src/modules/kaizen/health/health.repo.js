/**
 * Kaizen health repository — parameterised SQL only.
 * Persists health snapshots and reads recent history for trend charts.
 */

"use strict";

const { query } = require("../../../config/database");

/** Insert one snapshot per component for this tick. */
async function insertSnapshots(rows) {
  if (!rows.length) return;
  // Build a multi-row VALUES insert.
  const values = [];
  const params = [];
  let i = 1;
  for (const r of rows) {
    values.push(`($${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(r.component, r.status, r.latency_ms ?? null, JSON.stringify(r.detail || {}));
  }
  await query(
    `INSERT INTO shared.kaizen_health_snapshots (component, status, latency_ms, detail)
     VALUES ${values.join(", ")}`,
    params,
  );
}

/** Latest snapshot per component (for the /current fallback / trend seed). */
async function latestPerComponent() {
  const { rows } = await query(
    `SELECT DISTINCT ON (component)
            component, status, latency_ms, detail, captured_at
       FROM shared.kaizen_health_snapshots
      ORDER BY component, captured_at DESC`,
  );
  return rows;
}

/** Time series for one component over the last N hours. */
async function history({ component, hours = 24, limit = 1000 }) {
  const { rows } = await query(
    `SELECT captured_at, status, latency_ms, detail
       FROM shared.kaizen_health_snapshots
      WHERE component = $1
        AND captured_at > now() - ($2 || ' hours')::interval
      ORDER BY captured_at ASC
      LIMIT $3`,
    [component, String(hours), limit],
  );
  return rows;
}

async function pruneOlderThan(days = 30) {
  await query(
    `DELETE FROM shared.kaizen_health_snapshots
      WHERE captured_at < now() - ($1 || ' days')::interval`,
    [String(days)],
  );
}

module.exports = { insertSnapshots, latestPerComponent, history, pruneOlderThan };
