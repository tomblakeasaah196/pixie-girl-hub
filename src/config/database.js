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
 */
async function query(text, params = []) {
  if (!pool) throw new Error("db pool not initialised");
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
 * Acquire a client, BEGIN, run callback, COMMIT (or ROLLBACK on throw).
 * Use this for any operation that must be atomic across statements,
 * including setting RLS context via `SET LOCAL app.current_business`.
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
 * Set the current_business GUC on a client (used inside a transaction).
 * RLS policies key off this. Must be called before any RLS-protected query.
 *
 * @param {import('pg').PoolClient} client
 * @param {'valid-brand-key-1'|'valid-brand-key-2'} business
 * @param {string} userId
 */
async function setSessionContext(client, business, userId) {
  await client.query(`SET LOCAL app.current_business = $1`, [business]);
  await client.query(`SET LOCAL app.current_user_id = $1`, [userId]);
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
  setSessionContext,
  closeDatabase,
};
