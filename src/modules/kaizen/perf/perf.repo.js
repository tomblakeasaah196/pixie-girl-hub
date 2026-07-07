/**
 * Kaizen perf repository — parameterised SQL only. Writes 1-minute rollups and
 * reads dashboard aggregates from shared.kaizen_perf_rollups.
 *
 * Note on percentiles: we cannot exactly re-aggregate p95 across rollups, so the
 * dashboard uses a request-weighted average of the per-window p95 as a close
 * approximation, and exposes max_ms for the true worst case.
 */

"use strict";

const { query } = require("../../../config/database");

async function insertRollups(rows) {
  if (!rows.length) return;
  const values = [];
  const params = [];
  let i = 1;
  for (const r of rows) {
    values.push(
      `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`,
    );
    params.push(
      r.window_start,
      r.window_end,
      r.route_pattern,
      r.method,
      r.req_count,
      r.err_count,
      r.p50_ms,
      r.p95_ms,
      r.p99_ms,
      r.max_ms,
    );
  }
  await query(
    `INSERT INTO shared.kaizen_perf_rollups
       (window_start, window_end, route_pattern, method, req_count, err_count,
        p50_ms, p95_ms, p99_ms, max_ms)
     VALUES ${values.join(", ")}`,
    params,
  );
}

/** Overall figures + top slow routes over the last N hours. */
async function summary({ hours = 24 }) {
  const { rows: totals } = await query(
    `SELECT
        COALESCE(sum(req_count), 0)::bigint                         AS total_requests,
        COALESCE(sum(err_count), 0)::bigint                         AS total_errors,
        CASE WHEN sum(req_count) > 0
             THEN round(sum(p95_ms::numeric * req_count) / sum(req_count))
             ELSE NULL END                                          AS p95_weighted_ms,
        max(max_ms)                                                 AS max_ms
       FROM shared.kaizen_perf_rollups
      WHERE window_start > now() - ($1 || ' hours')::interval`,
    [String(hours)],
  );

  const { rows: slow } = await query(
    `SELECT route_pattern, method,
            sum(req_count)::bigint AS req_count,
            sum(err_count)::bigint AS err_count,
            CASE WHEN sum(req_count) > 0
                 THEN round(sum(p95_ms::numeric * req_count) / sum(req_count))
                 ELSE NULL END     AS p95_ms,
            max(max_ms)            AS max_ms
       FROM shared.kaizen_perf_rollups
      WHERE window_start > now() - ($1 || ' hours')::interval
      GROUP BY route_pattern, method
      HAVING sum(req_count) > 0
      ORDER BY p95_ms DESC NULLS LAST
      LIMIT 15`,
    [String(hours)],
  );

  const t = totals[0];
  const windowMinutes = hours * 60;
  const throughputPerMin = windowMinutes
    ? +(Number(t.total_requests) / windowMinutes).toFixed(2)
    : 0;
  const errorRate =
    Number(t.total_requests) > 0
      ? +((Number(t.total_errors) / Number(t.total_requests)) * 100).toFixed(2)
      : 0;

  return {
    hours,
    total_requests: Number(t.total_requests),
    total_errors: Number(t.total_errors),
    error_rate_pct: errorRate,
    throughput_per_min: throughputPerMin,
    p95_ms: t.p95_weighted_ms != null ? Number(t.p95_weighted_ms) : null,
    max_ms: t.max_ms != null ? Number(t.max_ms) : null,
    slow_routes: slow.map((r) => ({
      route_pattern: r.route_pattern,
      method: r.method,
      req_count: Number(r.req_count),
      err_count: Number(r.err_count),
      p95_ms: r.p95_ms != null ? Number(r.p95_ms) : null,
      max_ms: r.max_ms != null ? Number(r.max_ms) : null,
    })),
  };
}

/** Per-window series for one route pattern (for a trend chart). */
async function routeSeries({ pattern, hours = 24 }) {
  const { rows } = await query(
    `SELECT window_start, req_count, err_count, p50_ms, p95_ms, p99_ms, max_ms
       FROM shared.kaizen_perf_rollups
      WHERE route_pattern = $1
        AND window_start > now() - ($2 || ' hours')::interval
      ORDER BY window_start ASC
      LIMIT 2000`,
    [pattern, String(hours)],
  );
  return rows;
}

async function pruneOlderThan(days = 90) {
  await query(
    `DELETE FROM shared.kaizen_perf_rollups
      WHERE window_start < now() - ($1 || ' days')::interval`,
    [String(days)],
  );
}

module.exports = { insertRollups, summary, routeSeries, pruneOlderThan };
