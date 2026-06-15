#!/usr/bin/env node
"use strict";

/**
 * Repair a per-business schema by applying any template migrations that
 * haven't been run yet.
 *
 * Safe to run repeatedly — it checks which tables already exist in the
 * schema and only runs templates whose "sentinel" tables are missing.
 *
 * Usage:
 *   node scripts/repair-business-schema.js pixiegirl
 *   node scripts/repair-business-schema.js faitlynhair
 *   node scripts/repair-business-schema.js pixiegirl faitlynhair   (multiple)
 *   node scripts/repair-business-schema.js --all                   (every brand)
 *
 * What it does:
 *   1. Reads every migrations/template/*.sql.template in order
 *   2. Substitutes {{BUSINESS}} with the brand key
 *   3. For each template, finds the first CREATE TABLE statement to use as
 *      a sentinel — if that table already exists, the template is skipped
 *   4. Otherwise runs the template inside a savepoint so one failure doesn't
 *      roll back the whole repair
 */

const fs = require("fs/promises");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();

const TEMPLATE_DIR = path.join(__dirname, "..", "migrations", "template");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function getExistingBrands() {
  const { rows } = await pool.query(
    "SELECT business_key FROM shared.business_config ORDER BY business_key",
  );
  return rows.map((r) => r.business_key);
}

async function getExistingTables(client, schema) {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
    [schema],
  );
  return new Set(rows.map((r) => r.table_name));
}

function render(sql, business) {
  return sql.replace(/\{\{BUSINESS\}\}/g, business);
}

function findSentinel(sql) {
  // First "CREATE TABLE {{BUSINESS}}.table_name" or "CREATE TABLE biz.table_name"
  const m = sql.match(/CREATE TABLE (?:\{\{BUSINESS\}\}|\w+)\.(\w+)/i);
  return m ? m[1] : null;
}

async function repairBusiness(business) {
  console.log(`\n── Repairing schema: ${business} ──`);

  const files = (await fs.readdir(TEMPLATE_DIR))
    .filter((f) => f.endsWith(".sql.template"))
    .sort();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existingTables = await getExistingTables(client, business);

    let applied = 0;
    let skipped = 0;

    for (const file of files) {
      const raw = await fs.readFile(path.join(TEMPLATE_DIR, file), "utf8");
      const sql = render(raw, business);
      const sentinel = findSentinel(raw);

      if (sentinel && existingTables.has(sentinel)) {
        console.log(`  SKIP  ${file} (${sentinel} exists)`);
        skipped++;
        continue;
      }

      try {
        await client.query(`SAVEPOINT repair_${applied}`);
        await client.query(sql);
        await client.query(`RELEASE SAVEPOINT repair_${applied}`);
        console.log(`  APPLY ${file}${sentinel ? ` (created ${sentinel}…)` : ""}`);
        applied++;
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT repair_${applied}`);
        console.error(`  ERROR ${file}: ${err.message}`);
      }
    }

    await client.query("COMMIT");
    console.log(`  Done: ${applied} applied, ${skipped} skipped`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`  FATAL for ${business}: ${err.message}`);
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node scripts/repair-business-schema.js <business_key> [...]");
    console.error("       node scripts/repair-business-schema.js --all");
    process.exit(1);
  }

  let businesses;
  if (args.includes("--all")) {
    businesses = await getExistingBrands();
    console.log(`Repairing all ${businesses.length} brands: ${businesses.join(", ")}`);
  } else {
    businesses = args.filter((a) => !a.startsWith("--"));
  }

  for (const biz of businesses) {
    await repairBusiness(biz);
  }

  await pool.end();
  console.log("\nRepair complete.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
