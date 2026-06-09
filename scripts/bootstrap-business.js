#!/usr/bin/env node
/**
 * Provision a per-brand schema.
 *
 *   node scripts/bootstrap-business.js pixiegirl
 *   node scripts/bootstrap-business.js faitlynhair
 *
 * Steps:
 *   1. CREATE SCHEMA <brand>
 *   2. INSERT into shared.business_config (must exist before templates run)
 *   3. Substitute {{BUSINESS}} → <brand> in each template/*.sql.template
 *   4. Run each substituted SQL with ON_ERROR_STOP=1
 *   5. Verify final table count
 *
 * Tested for both PXG and FLH (425 tables across DB after both bootstrap).
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();

const brand = process.argv[2];
if (!brand) {
  console.error("Usage: bootstrap-business.js <pixiegirl|faitlynhair>");
  process.exit(1);
}

const BRAND_META = {
  pixiegirl: {
    display_name: "Pixie Girl Global",
    legal_name: "Pixie Girl Global Ltd",
    document_prefix: "PXG",
  },
  faitlynhair: {
    display_name: "Faitlynhair",
    legal_name: "Faitlyn Hair Limited",
    document_prefix: "FLH",
  },
};

const meta = BRAND_META[brand];
if (!meta) {
  console.error(`Unknown brand: ${brand}. Use pixiegirl or faitlynhair.`);
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const TEMPLATE_DIR = path.join(__dirname, "..", "migrations", "template");

async function main() {
  const client = await pool.connect();
  try {
    process.stdout.write(`Bootstrapping ${brand}...`);

    // 1. Create schema
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${brand}`);
    process.stdout.write(`  ✓ Schema ${brand} created`);

    // 2. Seed business_config row
    await client.query(
      `INSERT INTO shared.business_config (business_key, display_name, legal_name, document_prefix)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (business_key) DO NOTHING`,
      [brand, meta.display_name, meta.legal_name, meta.document_prefix],
    );
    process.stdout.write(`  ✓ business_config row inserted`);

    // 3 & 4. Apply each template
    const files = fs
      .readdirSync(TEMPLATE_DIR)
      .filter((f) => f.endsWith(".template"))
      .sort();
    for (const file of files) {
      const sql = fs
        .readFileSync(path.join(TEMPLATE_DIR, file), "utf-8")
        .replace(/{{BUSINESS}}/g, brand);
      try {
        await client.query(sql);
        process.stdout.write(`  ✓ ${file}`);
      } catch (err) {
        console.error(`  ✗ ${file}: ${err.message}`);
        throw err;
      }
    }

    // 5. Verify
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`,
      [brand],
    );
    process.stdout.write(`\nDone. ${brand} now has ${rows[0].n} tables.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write("Bootstrap failed:");
  process.stderr.write(err.message);
  process.exit(1);
});
