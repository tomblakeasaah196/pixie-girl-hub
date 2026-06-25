/**
 * Webhook log repository (H-4). Append-only persistence of inbound webhooks to
 * shared.webhook_log, with dedup on (source, external_id).
 */

"use strict";

const { query } = require("../../config/database");

/**
 * Insert a received webhook. Returns { webhook_id, duplicate }. On a dedup
 * collision (same source + external_id) returns the existing row's id with
 * duplicate=true and inserts nothing.
 */
async function insertLog(
  client,
  { source, event_type, external_id, payload, signature_valid, source_ip },
) {
  const q = client ? client.query.bind(client) : query;
  const { rows } = await q(
    `INSERT INTO shared.webhook_log
       (source, event_type, external_id, payload, signature_valid, source_ip)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)
     ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
       DO NOTHING
     RETURNING webhook_id`,
    [
      source,
      event_type || null,
      external_id || null,
      JSON.stringify(payload || {}),
      signature_valid,
      source_ip || null,
    ],
  );
  if (rows[0]) return { webhook_id: rows[0].webhook_id, duplicate: false };

  // Conflict → fetch the existing row's id.
  const { rows: ex } = await q(
    `SELECT webhook_id FROM shared.webhook_log
      WHERE source = $1 AND external_id = $2 LIMIT 1`,
    [source, external_id],
  );
  return { webhook_id: ex[0] ? ex[0].webhook_id : null, duplicate: true };
}

async function findById(id) {
  const { rows } = await query(
    `SELECT * FROM shared.webhook_log WHERE webhook_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function markProcessed(id, { error_message = null } = {}) {
  await query(
    `UPDATE shared.webhook_log
        SET processed = ($2::text IS NULL),
            processed_at = now(),
            error_message = $2,
            retry_count = retry_count + CASE WHEN $2::text IS NULL THEN 0 ELSE 1 END
      WHERE webhook_id = $1`,
    [id, error_message],
  );
}

/**
 * Replayable webhooks: verified inbound events that never completed processing
 * (processed = false). These are the ones whose outbox retries were exhausted,
 * or that arrived while a downstream consumer was down. Only signature-valid
 * rows are returned — an unverified payload is never re-driven. `maxRetries`
 * caps how many times a row will be picked up so a permanently-broken event
 * can't loop forever (pass 0/null to ignore the cap). Uses the partial index
 * idx_webhook_log_unprocessed (source, processed, received_at) WHERE processed = false.
 */
async function listReplayable({
  source = null,
  limit = 100,
  maxRetries = 25,
} = {}) {
  const { rows } = await query(
    `SELECT webhook_id, source, retry_count, received_at, error_message
       FROM shared.webhook_log
      WHERE processed = false
        AND signature_valid = true
        AND ($1::text IS NULL OR source = $1)
        AND ($2::int  IS NULL OR retry_count < $2)
      ORDER BY received_at ASC
      LIMIT $3`,
    [source, maxRetries || null, limit],
  );
  return rows;
}

module.exports = { insertLog, findById, markProcessed, listReplayable };
