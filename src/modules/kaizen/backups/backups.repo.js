/**
 * Kaizen backups repository — parameterised SQL only.
 * Ledger (kaizen_backup_runs), destinations, and a small settings reader.
 */

"use strict";

const { query } = require("../../../config/database");

// ── Destinations ─────────────────────────────────────────────────────────────

async function listDestinations() {
  const { rows } = await query(
    `SELECT destination_id, name, kind, rclone_remote, path_prefix,
            is_default, is_active, detail, created_at, updated_at
       FROM shared.kaizen_backup_destinations
      ORDER BY is_default DESC, created_at ASC`,
  );
  return rows;
}

async function getDefaultDestination() {
  const { rows } = await query(
    `SELECT * FROM shared.kaizen_backup_destinations
      WHERE is_active AND is_default
      ORDER BY created_at ASC LIMIT 1`,
  );
  if (rows[0]) return rows[0];
  // Fall back to any active destination.
  const { rows: any } = await query(
    `SELECT * FROM shared.kaizen_backup_destinations
      WHERE is_active ORDER BY created_at ASC LIMIT 1`,
  );
  return any[0] || null;
}

async function getDestination(id) {
  const { rows } = await query(
    `SELECT * FROM shared.kaizen_backup_destinations WHERE destination_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function createDestination({ name, kind, rcloneRemote, pathPrefix, isDefault }) {
  if (isDefault) {
    await query(`UPDATE shared.kaizen_backup_destinations SET is_default = FALSE WHERE is_default`);
  }
  const { rows } = await query(
    `INSERT INTO shared.kaizen_backup_destinations
       (name, kind, rclone_remote, path_prefix, is_default)
     VALUES ($1,$2,$3,COALESCE($4,'pixiegirl-hub/backups'),COALESCE($5,FALSE))
     RETURNING *`,
    [name, kind, rcloneRemote || null, pathPrefix || null, !!isDefault],
  );
  return rows[0];
}

async function updateDestination(id, { name, rcloneRemote, pathPrefix, isDefault, isActive }) {
  if (isDefault) {
    await query(`UPDATE shared.kaizen_backup_destinations SET is_default = FALSE WHERE is_default`);
  }
  const { rows } = await query(
    `UPDATE shared.kaizen_backup_destinations
        SET name = COALESCE($2, name),
            rclone_remote = COALESCE($3, rclone_remote),
            path_prefix = COALESCE($4, path_prefix),
            is_default = COALESCE($5, is_default),
            is_active = COALESCE($6, is_active),
            updated_at = now()
      WHERE destination_id = $1
      RETURNING *`,
    [id, name || null, rcloneRemote || null, pathPrefix || null,
     isDefault ?? null, isActive ?? null],
  );
  return rows[0] || null;
}

// ── Runs (ledger) ────────────────────────────────────────────────────────────

async function createRun({ kind, destinationId, trigger, retentionClass, createdBy }) {
  const { rows } = await query(
    `INSERT INTO shared.kaizen_backup_runs
       (kind, destination_id, status, trigger, retention_class, created_by)
     VALUES ($1,$2,'running',$3,COALESCE($4,'daily'),$5)
     RETURNING *`,
    [kind, destinationId || null, trigger || "scheduled", retentionClass || null, createdBy || null],
  );
  return rows[0];
}

async function finishRun(runId, { status, sizeBytes, artifactKey, checksum, log, error, durationMs }) {
  const { rows } = await query(
    `UPDATE shared.kaizen_backup_runs
        SET status = $2,
            finished_at = now(),
            duration_ms = $3,
            size_bytes = $4,
            artifact_key = $5,
            checksum = $6,
            log = $7,
            error = $8
      WHERE run_id = $1
      RETURNING *`,
    [runId, status, durationMs ?? null, sizeBytes ?? null, artifactKey ?? null,
     checksum ?? null, log ? String(log).slice(-8000) : null, error ? String(error).slice(-4000) : null],
  );
  return rows[0] || null;
}

async function getRun(runId) {
  const { rows } = await query(
    `SELECT * FROM shared.kaizen_backup_runs WHERE run_id = $1`,
    [runId],
  );
  return rows[0] || null;
}

async function listRuns({ kind, status, page = 1, pageSize = 30 }) {
  const where = [];
  const params = [];
  let i = 1;
  if (kind) { where.push(`kind = $${i++}`); params.push(kind); }
  if (status) { where.push(`status = $${i++}`); params.push(status); }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.kaizen_backup_runs ${whereSql}`,
    params,
  );
  const { rows } = await query(
    `SELECT run_id, kind, destination_id, status, trigger, retention_class,
            started_at, finished_at, duration_ms, size_bytes, artifact_key,
            checksum, error, created_by, created_at
       FROM shared.kaizen_backup_runs
       ${whereSql}
      ORDER BY started_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return { rows, total: c[0].total };
}

/** Last successful run per kind (for the dashboard status summary). */
async function lastSuccessPerKind() {
  const { rows } = await query(
    `SELECT DISTINCT ON (kind) kind, run_id, finished_at, size_bytes, duration_ms, artifact_key
       FROM shared.kaizen_backup_runs
      WHERE status = 'success'
      ORDER BY kind, finished_at DESC`,
  );
  return rows;
}

/** Mark an artifact pruned but KEEP the run row (audit trail). */
async function markPruned(runId) {
  // Keep the run row (audit trail); only drop the now-deleted artifact pointer.
  await query(
    `UPDATE shared.kaizen_backup_runs SET artifact_key = NULL WHERE run_id = $1`,
    [runId],
  );
}

/** Logical runs whose artifacts are beyond the daily-retention window. */
async function logicalRunsToPrune({ keepDaily = 7 }) {
  const { rows } = await query(
    `SELECT run_id, artifact_key, destination_id
       FROM shared.kaizen_backup_runs
      WHERE kind IN ('logical_bundle','logical_db')
        AND status = 'success'
        AND artifact_key IS NOT NULL
      ORDER BY finished_at DESC
      OFFSET $1`,
    [keepDaily],
  );
  return rows;
}

// ── Restore drills (Phase 4) ─────────────────────────────────────────────────

async function getLatestSuccessfulLogical() {
  const { rows } = await query(
    `SELECT run_id, kind, destination_id, artifact_key, checksum, finished_at
       FROM shared.kaizen_backup_runs
      WHERE kind IN ('logical_bundle','logical_db')
        AND status = 'success'
        AND artifact_key IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1`,
  );
  return rows[0] || null;
}

async function createDrill({ backupRunId }) {
  const { rows } = await query(
    `INSERT INTO shared.kaizen_restore_drills (backup_run_id, status)
     VALUES ($1, 'running') RETURNING *`,
    [backupRunId || null],
  );
  return rows[0];
}

async function finishDrill(drillId, { status, durationMs, assertions, restoredRowCounts, error }) {
  const { rows } = await query(
    `UPDATE shared.kaizen_restore_drills
        SET status = $2, finished_at = now(), duration_ms = $3,
            assertions = $4, restored_row_counts = $5, error = $6
      WHERE drill_id = $1
      RETURNING *`,
    [drillId, status, durationMs ?? null,
     JSON.stringify(assertions || []), JSON.stringify(restoredRowCounts || {}),
     error ? String(error).slice(-4000) : null],
  );
  return rows[0] || null;
}

async function listDrills({ page = 1, pageSize = 20 } = {}) {
  const { rows: c } = await query(`SELECT count(*)::int AS total FROM shared.kaizen_restore_drills`);
  const { rows } = await query(
    `SELECT drill_id, backup_run_id, started_at, finished_at, duration_ms,
            status, assertions, restored_row_counts, error
       FROM shared.kaizen_restore_drills
      ORDER BY started_at DESC
      LIMIT $1 OFFSET $2`,
    [pageSize, (page - 1) * pageSize],
  );
  return { rows, total: c[0].total };
}

async function latestDrill() {
  const { rows } = await query(
    `SELECT drill_id, status, started_at, finished_at, duration_ms
       FROM shared.kaizen_restore_drills
      ORDER BY started_at DESC LIMIT 1`,
  );
  return rows[0] || null;
}

// ── Settings ─────────────────────────────────────────────────────────────────

async function getSetting(key, fallback = null) {
  const { rows } = await query(
    `SELECT value FROM shared.kaizen_settings WHERE key = $1`,
    [key],
  );
  return rows[0] ? rows[0].value : fallback;
}

module.exports = {
  listDestinations,
  getDefaultDestination,
  getDestination,
  createDestination,
  updateDestination,
  createRun,
  finishRun,
  getRun,
  listRuns,
  lastSuccessPerKind,
  markPruned,
  logicalRunsToPrune,
  getSetting,
  getLatestSuccessfulLogical,
  createDrill,
  finishDrill,
  listDrills,
  latestDrill,
};
