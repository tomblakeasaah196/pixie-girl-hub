/**
 * Kaizen errors repository — parameterised SQL only. No business logic, no
 * events. Operates on shared.kaizen_error_groups + shared.kaizen_error_occurrences.
 *
 * The upsert path uses INSERT ... ON CONFLICT (fingerprint) DO UPDATE so a
 * burst of the same error under concurrency can never create duplicate groups.
 * It returns enough state (was_insert, prev_status) for the service to decide
 * whether this occurrence is a brand-new group or a regression (auto-reopen).
 */

"use strict";

const { query, transaction } = require("../../../config/database");

/**
 * Upsert a group by fingerprint and insert the occurrence, atomically.
 * Returns { group, was_insert, was_reopened }.
 */
async function upsertGroupAndOccurrence({ group, occurrence }) {
  return transaction(async (client) => {
    // Upsert the group. xmax = 0 on the returned row ⇒ it was an INSERT.
    const { rows } = await client.query(
      `INSERT INTO shared.kaizen_error_groups
         (fingerprint, title, error_code, source, route_pattern, http_status,
          severity, status, occurrence_count, first_seen_at, last_seen_at, sample)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'open',1, now(), now(), $8)
       ON CONFLICT (fingerprint) DO UPDATE SET
         occurrence_count = shared.kaizen_error_groups.occurrence_count + 1,
         last_seen_at     = now(),
         sample           = EXCLUDED.sample,
         http_status      = COALESCE(EXCLUDED.http_status, shared.kaizen_error_groups.http_status),
         route_pattern    = COALESCE(EXCLUDED.route_pattern, shared.kaizen_error_groups.route_pattern),
         -- Escalate severity if this occurrence is worse than what we've seen.
         severity = CASE
             WHEN EXCLUDED.severity = 'critical' THEN 'critical'
             ELSE shared.kaizen_error_groups.severity
           END,
         -- AUTO-REOPEN: a resolved group that recurs flips back to open.
         status = CASE
             WHEN shared.kaizen_error_groups.status = 'resolved' THEN 'open'
             ELSE shared.kaizen_error_groups.status
           END,
         reopened_at = CASE
             WHEN shared.kaizen_error_groups.status = 'resolved' THEN now()
             ELSE shared.kaizen_error_groups.reopened_at
           END,
         reopen_count = shared.kaizen_error_groups.reopen_count
             + CASE WHEN shared.kaizen_error_groups.status = 'resolved' THEN 1 ELSE 0 END,
         updated_at = now()
       RETURNING *,
         (xmax = 0) AS was_insert,
         (status = 'open' AND reopened_at IS NOT NULL
            AND reopened_at >= now() - interval '2 seconds') AS was_reopened`,
      [
        group.fingerprint,
        group.title,
        group.error_code || null,
        group.source,
        group.route_pattern || null,
        group.http_status || null,
        group.severity,
        JSON.stringify(group.sample || {}),
      ],
    );
    const saved = rows[0];

    await client.query(
      `INSERT INTO shared.kaizen_error_occurrences
         (group_id, request_id, route, method, http_status, brand, user_ref,
          message, stack, context)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        saved.group_id,
        occurrence.request_id || null,
        occurrence.route || null,
        occurrence.method || null,
        occurrence.http_status || null,
        occurrence.brand || null,
        occurrence.user_ref || null,
        occurrence.message || null,
        occurrence.stack || null,
        JSON.stringify(occurrence.context || {}),
      ],
    );

    return {
      group: saved,
      was_insert: saved.was_insert === true,
      was_reopened: saved.was_reopened === true,
    };
  });
}

// ── Browse ──────────────────────────────────────────────────────────────────

async function listGroups({ status, severity, source, q, limit, offset }) {
  const where = [];
  const params = [];
  let i = 1;
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  if (severity) {
    where.push(`severity = $${i++}`);
    params.push(severity);
  }
  if (source) {
    where.push(`source = $${i++}`);
    params.push(source);
  }
  if (q) {
    where.push(`(title ILIKE $${i} OR route_pattern ILIKE $${i} OR error_code ILIKE $${i})`);
    params.push(`%${q}%`);
    i++;
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total FROM shared.kaizen_error_groups ${whereSql}`,
    params,
  );
  const total = countRows[0].total;

  const { rows } = await query(
    `SELECT group_id, fingerprint, title, error_code, source, route_pattern,
            http_status, severity, status, occurrence_count,
            first_seen_at, last_seen_at, resolved_at, reopened_at, reopen_count
       FROM shared.kaizen_error_groups
       ${whereSql}
      ORDER BY last_seen_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset],
  );
  return { rows, total };
}

/** Same filter as listGroups but returns ALL matching rows (for export). */
async function listGroupsForExport({ status, severity, source, q, cap = 1000 }) {
  const { rows } = await listGroups({
    status,
    severity,
    source,
    q,
    limit: cap,
    offset: 0,
  });
  return rows;
}

async function getGroup(groupId) {
  const { rows } = await query(
    `SELECT * FROM shared.kaizen_error_groups WHERE group_id = $1 LIMIT 1`,
    [groupId],
  );
  return rows[0] || null;
}

async function listOccurrences({ groupId, limit, offset }) {
  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM shared.kaizen_error_occurrences WHERE group_id = $1`,
    [groupId],
  );
  const { rows } = await query(
    `SELECT occurrence_id, occurred_at, request_id, route, method, http_status,
            brand, user_ref, message, stack, context
       FROM shared.kaizen_error_occurrences
      WHERE group_id = $1
      ORDER BY occurred_at DESC
      LIMIT $2 OFFSET $3`,
    [groupId, limit, offset],
  );
  return { rows, total: countRows[0].total };
}

// ── Lifecycle (resolve / ignore / reopen) ────────────────────────────────────

async function setStatusMany({ groupIds, status, note, resolvedBy }) {
  const { rows } = await query(
    `UPDATE shared.kaizen_error_groups
        SET status = $2,
            resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE resolved_at END,
            resolved_by = CASE WHEN $2 = 'resolved' THEN $3::uuid ELSE resolved_by END,
            resolution_note = CASE WHEN $2 = 'resolved' THEN $4 ELSE resolution_note END,
            updated_at = now()
      WHERE group_id = ANY($1::uuid[])
      RETURNING group_id, status`,
    [groupIds, status, resolvedBy || null, note || null],
  );
  return rows;
}

async function reopenMany(groupIds) {
  const { rows } = await query(
    `UPDATE shared.kaizen_error_groups
        SET status = 'open', reopened_at = now(),
            reopen_count = reopen_count + 1, updated_at = now()
      WHERE group_id = ANY($1::uuid[])
      RETURNING group_id, status`,
    [groupIds],
  );
  return rows;
}

// ── Retention (called by the maintenance tick, Phase 5) ──────────────────────

async function pruneOccurrences({ olderThanDays = 30, keepPerGroup = 200 }) {
  // Age-based delete.
  await query(
    `DELETE FROM shared.kaizen_error_occurrences
      WHERE occurred_at < now() - ($1 || ' days')::interval`,
    [String(olderThanDays)],
  );
  // Cap per group (keep the most recent N).
  await query(
    `DELETE FROM shared.kaizen_error_occurrences o
      USING (
        SELECT occurrence_id,
               row_number() OVER (PARTITION BY group_id ORDER BY occurred_at DESC) AS rn
          FROM shared.kaizen_error_occurrences
      ) ranked
     WHERE o.occurrence_id = ranked.occurrence_id AND ranked.rn > $1`,
    [keepPerGroup],
  );
}

module.exports = {
  upsertGroupAndOccurrence,
  listGroups,
  listGroupsForExport,
  getGroup,
  listOccurrences,
  setStatusMany,
  reopenMany,
  pruneOccurrences,
};
