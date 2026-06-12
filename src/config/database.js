/**
 * PostgreSQL connection pool.
 *
 * Single pg.Pool instance shared across the app. All queries should go
 * through one of:
 *   - db.query(sql, params)              — quick one-shot, no transaction
 *   - db.transaction(async (client) => …) — multi-statement transaction
 *
 * Per V2.2 §8 — no ORM. Plain pg with parameterised queries.
 * Per V2.2 §3 — every connection sets `app.current_business` GUC so
 *               RLS policies (once enabled) can filter by entity.
 */

"use strict";

const { Pool } = require("pg");
const { registerType } = require("pgvector/pg");
const { config } = require("./env");
const { logger } = require("./logger");
const requestContext = require("./request-context");

let pool = null;

async function initDatabase() {
  pool = new Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    min: config.DB_POOL_MIN,
    max: config.DB_POOL_MAX,
    ssl: config.DB_SSL ? { rejectUnauthorized: false } : false,
    statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Register pgvector type so SELECTs return Float32Array instead of strings
  pool.on("connect", async (client) => {
    try {
      await registerType(client);
    } catch (e) {
      // pgvector extension might not be present in test envs; degrade gracefully
      logger.warn({ err: e }, "pgvector type registration skipped");
    }
  });

  pool.on("error", (err) => {
    logger.error({ err }, "pg pool error");
  });

  // Smoke-test the connection at boot
  const { rows } = await pool.query(
    "SELECT NOW() AS now, current_database() AS db",
  );
  logger.info({ db: rows[0].db, now: rows[0].now }, "database smoke test ok");

  return pool;
}

function getPool() {
  if (!pool)
    throw new Error("db pool not initialised — call initDatabase() first");
  return pool;
}

/**
 * Run a one-shot query. For multi-statement work that must share a
 * transaction or set per-connection GUCs (e.g. RLS context), use
 * `transaction()` instead.
 *
 * H-1 read-side RLS: `pool.query()` checks out an arbitrary pooled connection
 * with no `app.current_business` set, so RLS does NOT filter one-shot reads
 * (write paths via `transaction()` already set the GUC). When
 * `RLS_READ_ENFORCE` is on AND a brand context is ambient, the read is routed
 * through a minimal transaction so the local GUC applies and RLS filters it.
 * No ambient brand (worker/cron/cross-brand) → fast pool path, unchanged.
 */
async function query(text, params = []) {
  if (!pool) throw new Error("db pool not initialised");

  if (config.RLS_READ_ENFORCE && requestContext.getBrand()) {
    return queryWithContext(text, params);
  }

  const started = Date.now();
  try {
    const res = await pool.query(text, params);
    const ms = Date.now() - started;
    if (ms > 500) {
      logger.warn({ ms, sql: text.slice(0, 200) }, "slow query");
    }
    return res;
  } catch (err) {
    logger.error({ err, sql: text.slice(0, 200) }, "query failed");
    throw err;
  }
}

/**
 * One-shot read on a context-bound connection (H-1 read-side). Wraps the single
 * statement in a transaction so `set_config(..., is_local := true)` persists for
 * the SELECT, then commits. Only reached when RLS_READ_ENFORCE is on and a brand
 * context is ambient.
 */
async function queryWithContext(text, params = []) {
  const client = await pool.connect();
  const started = Date.now();
  try {
    await client.query("BEGIN");
    await applySessionContext(client, {
      brand: requestContext.getBrand(),
      userId: requestContext.getUserId(),
    });
    const res = await client.query(text, params);
    await client.query("COMMIT");
    const ms = Date.now() - started;
    if (ms > 500) {
      logger.warn({ ms, sql: text.slice(0, 200) }, "slow query (rls read)");
    }
    return res;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      logger.error({ rollbackErr }, "rollback failed (rls read)");
    }
    logger.error({ err, sql: text.slice(0, 200) }, "query failed (rls read)");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Set the RLS/audit GUCs on a client *for the current transaction* (R-1).
 *
 * Uses `set_config(name, value, is_local := true)` rather than `SET LOCAL name
 * = $1` because the `SET` command does NOT accept bind parameters — the old
 * parameterised `SET LOCAL` form would have thrown at runtime (it was never
 * actually called, which is exactly why RLS was inert). `is_local := true`
 * scopes the value to the open transaction, so it auto-resets on COMMIT/
 * ROLLBACK and never leaks across pooled connections.
 *
 * Only applies values that are present, so a brandless context (workers,
 * crons, CEO cross-brand) leaves the GUC unset → RLS treats it as "no filter".
 *
 * @param {import('pg').PoolClient} client
 * @param {{ brand?: string|null, userId?: string|null }} ctx
 */
async function applySessionContext(client, ctx) {
  if (!ctx) return;
  if (ctx.brand) {
    await client.query(`SELECT set_config('app.current_business', $1, true)`, [
      ctx.brand,
    ]);
  }
  if (ctx.userId) {
    await client.query(`SELECT set_config('app.current_user_id', $1, true)`, [
      String(ctx.userId),
    ]);
  }
}

/** Back-compat alias (was a broken parameterised `SET LOCAL`). */
async function setSessionContext(client, business, userId) {
  await applySessionContext(client, { brand: business, userId });
}

/**
 * Acquire a client, BEGIN, run callback, COMMIT (or ROLLBACK on throw).
 * Use this for any operation that must be atomic across statements.
 *
 * RLS/audit context (R-1): immediately after BEGIN this reads the ambient
 * request context (set by brand-context middleware, or by `brandTransaction`)
 * and applies `app.current_business` / `app.current_user_id` so the RLS
 * policies from migration 000200 actually filter. No ambient context → GUCs
 * stay unset → cross-brand "no filter" (the worker/cron path).
 *
 * @template T
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function transaction(fn) {
  if (!pool) throw new Error("db pool not initialised");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await applySessionContext(client, {
      brand: requestContext.getBrand(),
      userId: requestContext.getUserId(),
    });
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      logger.error({ rollbackErr }, "rollback failed");
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Explicit brand-scoped transaction choke point (R-1) for code paths WITHOUT
 * an ambient request context — e.g. worker/cron handlers that fan out per
 * brand, or the outbox dispatcher replaying a committed event. Binds the
 * context for the duration so both the GUC and any nested `transaction()`/
 * `query()` see the same brand.
 *
 * @template T
 * @param {string} brand
 * @param {string|null} userId
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function brandTransaction(brand, userId, fn) {
  return requestContext.run({ brand, userId }, () => transaction(fn));
}

async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  initDatabase,
  getPool,
  query,
  transaction,
  brandTransaction,
  setSessionContext,
  applySessionContext,
  closeDatabase,
};
