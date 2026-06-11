/**
 * Transactional outbox (H-2 / R-2) — the durable, atomic, post-commit
 * replacement for emitting domain events mid-transaction.
 *
 * Producer side:
 *   `enqueue(client, { business, event_type, payload, dedup_key })`
 *   writes a row to `shared.event_outbox` using the caller's transaction
 *   client, so the event commits atomically with the business row. Nothing is
 *   visible to a consumer until COMMIT.
 *
 * Consumer side (runs in the worker — see src/jobs/worker.js):
 *   `dispatchDue()` claims committed rows with FOR UPDATE SKIP LOCKED (so
 *   multiple pollers/processes partition the work), invokes every handler
 *   registered for the event_type, and marks the row done / retried with
 *   exponential backoff. Handlers therefore see only committed state and get
 *   at-least-once delivery — which is why consumers must be idempotent.
 *
 * Handlers register with `register(event_type, fn)`. Keep the in-process
 * EventEmitter for soft realtime fan-out (socket pushes) where loss is fine;
 * route every stateful/financial consumer through here.
 */

"use strict";

const { query, transaction } = require("../../config/database");
const requestContext = require("../../config/request-context");
const { logger } = require("../../config/logger");

// ── Handler registry ──────────────────────────────────────
/** @type {Map<string, Array<{name:string, fn:(payload:any, meta:object)=>Promise<void>}>>} */
const registry = new Map();

/**
 * Register a durable, **named** handler for an event type. The name identifies
 * the handler for per-row progress tracking, so a retry skips handlers that
 * already succeeded. Names must be unique per event type. Handlers must still
 * be idempotent (a handler can succeed-with-side-effect then the process dies
 * before its name is persisted → it re-runs).
 */
function register(eventType, name, handler) {
  const arr = registry.get(eventType) || [];
  if (arr.some((h) => h.name === name)) return; // guard double-registration
  arr.push({ name, fn: handler });
  registry.set(eventType, arr);
}

function getHandlers(eventType) {
  return registry.get(eventType) || [];
}

// ── Producer ──────────────────────────────────────────────
/**
 * Enqueue an event inside the caller's transaction.
 * @param {import('pg').PoolClient} client  the open transaction client (required for atomicity)
 * @param {{ business:string, event_type:string, payload:object, dedup_key?:string|null }} evt
 */
async function enqueue(
  client,
  { business, event_type, payload, dedup_key = null },
) {
  if (!client)
    throw new Error(
      "outbox.enqueue requires the transaction client for atomicity",
    );
  await client.query(
    `INSERT INTO shared.event_outbox (business, event_type, payload, dedup_key)
       VALUES ($1, $2, $3::jsonb, $4)
     ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
    [business, event_type, JSON.stringify(payload || {}), dedup_key],
  );
}

// ── Consumer / dispatcher ─────────────────────────────────
const STALE_PROCESSING_MINUTES = 5;
const MAX_BACKOFF_SECONDS = 3600;

/** Reset rows wedged in 'processing' by a crashed worker back to pending. */
async function reclaimStale() {
  await query(
    `UPDATE shared.event_outbox
        SET status = 'pending', updated_at = now()
      WHERE status = 'processing'
        AND updated_at < now() - ($1 || ' minutes')::interval`,
    [String(STALE_PROCESSING_MINUTES)],
  );
}

/** Atomically claim a batch of due rows (FOR UPDATE SKIP LOCKED). */
async function claimBatch(limit) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `WITH due AS (
         SELECT event_id
           FROM shared.event_outbox
          WHERE status = 'pending' AND next_attempt_at <= now()
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT $1
       )
       UPDATE shared.event_outbox o
          SET status = 'processing', attempts = attempts + 1, updated_at = now()
         FROM due
        WHERE o.event_id = due.event_id
       RETURNING o.*`,
      [limit],
    );
    return rows;
  });
}

async function markDone(eventId, completed) {
  await query(
    `UPDATE shared.event_outbox
        SET status = 'done', processed_at = now(), updated_at = now(),
            completed_handlers = $2
      WHERE event_id = $1`,
    [eventId, completed],
  );
}

async function markRetry(row, err, completed) {
  const exhausted = row.attempts >= row.max_attempts;
  const backoff = Math.min(
    MAX_BACKOFF_SECONDS,
    2 ** Math.min(row.attempts, 16) * 5,
  );
  await query(
    `UPDATE shared.event_outbox
        SET status = $2,
            last_error = $3,
            updated_at = now(),
            completed_handlers = $5,
            next_attempt_at = now() + ($4 || ' seconds')::interval
      WHERE event_id = $1`,
    [
      row.event_id,
      exhausted ? "failed" : "pending",
      String((err && err.message) || err).slice(0, 1000),
      String(backoff),
      completed,
    ],
  );
  logger.error(
    {
      event_id: row.event_id,
      type: row.event_type,
      attempts: row.attempts,
      exhausted,
    },
    "outbox handler failed",
  );
}

async function processRow(row) {
  const handlers = getHandlers(row.event_type);
  const done = new Set(row.completed_handlers || []);
  let firstErr = null;

  // Re-establish brand context so each handler's transactions set the RLS/audit
  // GUCs for the originating brand (the dispatcher itself has none). Run every
  // not-yet-done handler independently and collect failures, so one failing
  // consumer neither blocks nor re-triggers the others.
  await requestContext.run({ brand: row.business, userId: null }, async () => {
    for (const h of handlers) {
      if (done.has(h.name)) continue;
      try {
        await h.fn(row.payload, {
          business: row.business,
          event_id: row.event_id,
        });
        done.add(h.name);
      } catch (err) {
        if (!firstErr) firstErr = err;
        logger.error(
          { event_id: row.event_id, handler: h.name, err: err.message },
          "outbox consumer failed",
        );
      }
    }
  });

  const completed = [...done];
  if (firstErr) await markRetry(row, firstErr, completed);
  else await markDone(row.event_id, completed);
}

let dispatching = false;

/**
 * Drain due outbox rows. Safe to call from multiple processes/pollers (the
 * claim uses SKIP LOCKED). Re-entrancy-guarded within a process so overlapping
 * ticks don't pile up.
 * @returns {Promise<number>} rows processed this tick
 */
async function dispatchDue({ limit = 50 } = {}) {
  if (dispatching) return 0;
  dispatching = true;
  try {
    await reclaimStale();
    const rows = await claimBatch(limit);
    for (const row of rows) {
      await processRow(row);
    }
    return rows.length;
  } finally {
    dispatching = false;
  }
}

module.exports = { register, getHandlers, enqueue, dispatchDue };
