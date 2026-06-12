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
        SET processed = ($2 IS NULL),
            processed_at = now(),
            error_message = $2,
            retry_count = retry_count + CASE WHEN $2 IS NULL THEN 0 ELSE 1 END
      WHERE webhook_id = $1`,
    [id, error_message],
  );
}

module.exports = { insertLog, findById, markProcessed };
