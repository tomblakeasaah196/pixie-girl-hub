#!/usr/bin/env node
/**
 * Apply the 15 shared-schema migrations in order.
 *   node scripts/migrate-shared.js
 *
 * These create:
 *   - shared schema with 107 tables (cross-brand identity, contacts,
 *     intercompany, audit, AI, storefront content, etc.)
 *   - All shared triggers + indexes + initial seed data
 *
 * Per-brand schemas are bootstrapped separately via bootstrap-business.js.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const MIG_DIR = path.join(__dirname, "..", "migrations");

async function ensureTrackingTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS shared.schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied(client) {
  const { rows } = await client.query(
    `SELECT filename FROM shared.schema_migrations`,
  );
  return new Set(rows.map((r) => r.filename));
}

async function main() {
  const client = await pool.connect();
  try {
    // Ensure shared schema exists before the tracking table
    await client.query(`CREATE SCHEMA IF NOT EXISTS shared`);
    await ensureTrackingTable(client);

    const applied = await getApplied(client);

    const files = fs
      .readdirSync(MIG_DIR)
      .filter((f) => /^\d{6}_.+\.sql$/.test(f))
      .sort();

    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      process.stdout.write(
        `Nothing to migrate. ${applied.size} migration(s) already applied.\n`,
      );
      return;
    }

    process.stdout.write(
      `${applied.size} already applied. Running ${pending.length} pending migration(s)…\n`,
    );

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIG_DIR, file), "utf-8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          `INSERT INTO shared.schema_migrations (filename) VALUES ($1)`,
          [file],
        );
        await client.query("COMMIT");
        process.stdout.write(`  ✓ ${file}\n`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  ✗ ${file}: ${err.message}`);
        throw err;
      }
    }

    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = 'shared'`,
    );
    process.stdout.write(`\nDone. shared schema has ${rows[0].n} tables.\n`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
