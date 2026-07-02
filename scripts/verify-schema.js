#!/usr/bin/env node
/**
 * Schema verification — runs after migrate/bootstrap to confirm expected state.
 * Output is a quick health report; non-zero exit on any failure.
 *
 * Brand schemas are discovered from shared.business_config (the same source
 * the app boots from), so this works for any brand keys, not hardcoded ones.
 */

"use strict";

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Baseline counts after shared 000250 + brand template 000075
// (accounting foundation: +1 variant_costing per brand — policy Q9).
const EXPECTED_SHARED = 170;
const EXPECTED_PER_BRAND = 203;

async function countTables(schema) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`,
    [schema],
  );
  return rows[0].n;
}

async function main() {
  const { rows: brands } = await pool.query(
    `SELECT business_key FROM shared.business_config WHERE is_active = true ORDER BY business_key`,
  );
  const checks = [["shared", EXPECTED_SHARED]];
  for (const b of brands) checks.push([b.business_key, EXPECTED_PER_BRAND]);

  process.stdout.write("Schema table counts:\n");
  let ok = true;
  for (const [schema, expected] of checks) {
    const actual = await countTables(schema);
    const status = actual === expected ? "✓" : "✗";
    process.stdout.write(
      `  ${status} ${schema}: ${actual} (expected ${expected})\n`,
    );
    if (actual !== expected) ok = false;
  }
  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
