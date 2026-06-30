#!/usr/bin/env node
/**
 * Schema verification — runs after migrate/bootstrap to confirm expected state.
 * Output is a quick health report; non-zero exit on any failure.
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

const EXPECTED = {
  shared: 112,
  // +7 brand tables from Stylist Studio (migrations/template 000067–000072):
  // styled_product_bom, service_job_time_logs, service_job_materials,
  // service_job_references, wig_custody_ledger, customer_assets, studio_config.
  "valid-brand-key-1": 170,
  "valid-brand-key-2": 170,
};

async function main() {
  const out = {};
  for (const schema of Object.keys(EXPECTED)) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`,
      [schema],
    );
    out[schema] = rows[0].n;
  }
  process.stdout.write("Schema table counts:");
  let ok = true;
  for (const [schema, expected] of Object.entries(EXPECTED)) {
    const actual = out[schema];
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
