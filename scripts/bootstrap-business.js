#!/usr/bin/env node
"use strict";

/**
 * Provision a brand-new business (per-brand schema) end-to-end.
 *
 *   1. Validate the business key (safe Postgres identifier) + document prefix
 *   2. Ensure the schema + business_config row don't already exist
 *   3. Render every migrations/template/*.sql.template ({{BUSINESS}} -> key)
 *   4. In ONE transaction: CREATE SCHEMA -> INSERT business_config -> apply
 *      each template (tables, indexes, triggers, per-business seed data)
 *   5. On any failure: ROLLBACK + DROP SCHEMA so a retry is clean
 *
 * Everything per-business lives in the template folder + the 000035 seed, so a
 * new business is fully functional (document numbering, chart of accounts, the
 * current fiscal period, a default stock location, etc.) with no hardcoding.
 *
 * CLI:
 *   # founding brands (defaults baked in — keeps the npm scripts working):
 *   node scripts/bootstrap-business.js pixiegirl
 *   node scripts/bootstrap-business.js faitlynhair
 *
 *   # any new business:
 *   node scripts/bootstrap-business.js \
 *     --key watches --display-name "Hub Watches" \
 *     --legal-name "Hub Watches Ltd" --prefix WTC \
 *     [--currency NGN] [--vat-rate 0.075] [--wht-rate 0.05]
 *
 * Programmatic (e.g. POST /business-setup/businesses with provision=true):
 *   const { bootstrap } = require("../scripts/bootstrap-business");
 *   await bootstrap({ key, display_name, legal_name, document_prefix }, pool);
 *   // then registerBrand(key) (src/config/brands) so it goes live w/o restart.
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config();

const TEMPLATE_DIR = path.join(__dirname, "..", "migrations", "template");

// Safe Postgres schema-key guard — MUST match src/config/brands.js BRAND_KEY_RE
// so a key this script admits is also one the running app will accept + can
// safely interpolate as `<key>.table`.
const BRAND_KEY_RE = /^[a-z][a-z0-9_]{1,62}$/;
const PREFIX_RE = /^[A-Z]{2,5}$/;
const RESERVED_KEYS = new Set([
  "shared",
  "public",
  "pg_catalog",
  "information_schema",
  "template",
  "templates",
  "admin",
  "system",
  "postgres",
]);

// Founding brands — defaults so the positional CLI (and the db:bootstrap:* npm
// scripts) keep working without flags. New businesses supply their own metadata.
const KNOWN_BRANDS = {
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

function validateKey(key) {
  if (!key || typeof key !== "string") throw new Error("business key is required");
  if (!BRAND_KEY_RE.test(key))
    throw new Error(
      "business key must be lowercase, start with a letter, contain only [a-z0-9_], and be 2-63 chars",
    );
  if (RESERVED_KEYS.has(key))
    throw new Error(`business key '${key}' is reserved`);
}

function validatePrefix(prefix) {
  if (!prefix || !PREFIX_RE.test(prefix))
    throw new Error("document prefix must be 2-5 uppercase letters (e.g. PXG)");
}

/** Load + render every per-business template ({{BUSINESS}} -> key), sorted. */
function renderTemplates(key) {
  const files = fs
    .readdirSync(TEMPLATE_DIR)
    .filter((f) => f.endsWith(".sql.template"))
    .sort();
  if (!files.length) throw new Error(`No templates found in ${TEMPLATE_DIR}`);
  return files.map((name) => ({
    name,
    sql: fs
      .readFileSync(path.join(TEMPLATE_DIR, name), "utf-8")
      .replace(/\{\{BUSINESS\}\}/g, key),
  }));
}

/**
 * Bootstrap a business. `pool` is a pg Pool the caller owns (the app's pool when
 * provisioning in-process, or a throwaway one from the CLI). Returns a summary.
 */
async function bootstrap(opts, pool) {
  const key = opts.key;
  validateKey(key);
  validatePrefix(opts.document_prefix);
  if (!opts.display_name) throw new Error("display_name is required");
  if (!opts.legal_name) throw new Error("legal_name is required");

  // Render up front so a bad/missing template file fails before we touch the DB.
  const templates = renderTemplates(key);

  const client = await pool.connect();
  try {
    const { rows: schemaRows } = await client.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
      [key],
    );
    if (schemaRows.length) throw new Error(`Schema '${key}' already exists`);

    const { rows: cfgRows } = await client.query(
      `SELECT 1 FROM shared.business_config WHERE business_key = $1`,
      [key],
    );
    if (cfgRows.length)
      throw new Error(`business_config for '${key}' already exists`);

    await client.query("BEGIN");

    // key is validated above -> safe to interpolate as an identifier.
    await client.query(`CREATE SCHEMA ${key}`);

    await client.query(
      `INSERT INTO shared.business_config
         (business_key, display_name, legal_name, document_prefix,
          trading_currency, settlement_currency, vat_rate, wht_rate)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7)`,
      [
        key,
        opts.display_name,
        opts.legal_name,
        opts.document_prefix,
        opts.currency || "NGN",
        opts.vat_rate ?? 0.075,
        opts.wht_rate ?? 0.05,
      ],
    );

    for (const t of templates) {
      try {
        await client.query(t.sql);
      } catch (err) {
        throw new Error(`template ${t.name}: ${err.message}`);
      }
    }

    await client.query("COMMIT");

    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`,
      [key],
    );
    return { business_key: key, tables: rows[0].n, templates: templates.length };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    // Best-effort cleanup so a retry starts clean (the txn is already rolled back).
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${key} CASCADE`);
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

// ── CLI ─────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[k] = true;
      else {
        out[k] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const USAGE = `
Usage:
  node scripts/bootstrap-business.js <key>                  # founding brand (defaults)
  node scripts/bootstrap-business.js --key <key> --display-name <name> \\
       --legal-name <legal> --prefix <PREFIX> [--currency NGN] \\
       [--vat-rate 0.075] [--wht-rate 0.05]

Founding brands (no flags needed): ${Object.keys(KNOWN_BRANDS).join(", ")}
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = args.key || args._[0];
  if (!key || args.help) {
    process.stdout.write(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  const known = KNOWN_BRANDS[key] || {};
  const opts = {
    key,
    display_name: args["display-name"] || known.display_name,
    legal_name: args["legal-name"] || known.legal_name,
    document_prefix: args.prefix || known.document_prefix,
    currency: args.currency,
    vat_rate: args["vat-rate"] ? parseFloat(args["vat-rate"]) : undefined,
    wht_rate: args["wht-rate"] ? parseFloat(args["wht-rate"]) : undefined,
  };

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });

  try {
    process.stdout.write(`Bootstrapping ${key}...\n`);
    const res = await bootstrap(opts, pool);
    process.stdout.write(
      `\n✔ '${res.business_key}' bootstrapped — ${res.templates} templates, ${res.tables} tables.\n` +
        `  It is active in shared.business_config; the app picks it up on next boot ` +
        `(or call registerBrand to go live without a restart).\n`,
    );
  } catch (err) {
    process.stderr.write(`\n✗ Bootstrap failed: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) main();

module.exports = {
  bootstrap,
  validateKey,
  validatePrefix,
  renderTemplates,
  KNOWN_BRANDS,
  BRAND_KEY_RE,
};
