#!/usr/bin/env node
"use strict";

/**
 * wipe-catalogue.js — reset the catalogue so it can be re-imported cleanly.
 *
 * WHAT IT CLEARS (per brand):
 *   • Base products      → SOFT-deleted (is_deleted = true)
 *   • Styled products    → SOFT-deleted (is_deleted = true)
 *   • Collections        → HARD-deleted (cascades members + rules)
 *   • Bundles            → HARD-deleted (cascades bundle components)
 *   • Services           → HARD-deleted (shared.service_offerings for the brand)
 *
 * WHY THE SPLIT:
 *   products + styled_products carry PARTIAL unique indexes on
 *   (code/slug) WHERE is_deleted = false, and the importers only match LIVE
 *   rows — so a soft delete frees every name and re-import creates fresh
 *   records. It's reversible and avoids the deep variant FK web
 *   (stock/pricing/partners) a hard delete would trip on.
 *   Collections/bundles/services have FULL unique slug/code, so they must be
 *   removed to re-import without collisions; their inbound refs cascade only to
 *   their own children. Each hard delete runs inside a SAVEPOINT, so if an
 *   unexpected foreign key blocks one entity it's reported and skipped rather
 *   than aborting the whole run.
 *
 *   Order history (orders/invoices/quotes) is NOT touched — those references
 *   are ON DELETE SET NULL.
 *
 * USAGE:
 *   node scripts/wipe-catalogue.js                         # DRY RUN, all brands
 *   node scripts/wipe-catalogue.js --brand=pixiegirl       # DRY RUN, one brand
 *   node scripts/wipe-catalogue.js --brand=pixiegirl --yes # APPLY
 *   node scripts/wipe-catalogue.js --brand=all --yes       # APPLY, both brands
 *
 * ALWAYS BACK UP FIRST:
 *   pg_dump "$DATABASE_URL" -Fc -f backup_$(date +%F).dump
 */

const { Pool } = require("pg");
require("dotenv").config();

const VALID_BRANDS = ["pixiegirl", "faitlynhair"];

function getArg(name) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq === -1 ? true : hit.slice(eq + 1);
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function count(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return Number(rows[0].n);
}

async function snapshot(client, brand) {
  return {
    base: await count(
      client,
      `SELECT count(*) n FROM ${brand}.products WHERE is_deleted = false`,
    ),
    styled: await count(
      client,
      `SELECT count(*) n FROM ${brand}.styled_products WHERE is_deleted = false`,
    ),
    collections: await count(
      client,
      `SELECT count(*) n FROM ${brand}.product_collections`,
    ),
    bundles: await count(
      client,
      `SELECT count(*) n FROM ${brand}.bundle_offers`,
    ),
    services: await count(
      client,
      `SELECT count(*) n FROM shared.service_offerings WHERE business = $1`,
      [brand],
    ),
  };
}

/** Run a destructive statement inside a savepoint so one FK block doesn't
 *  abort the whole brand. Returns rows affected, or -1 if blocked. */
async function guarded(client, label, sql, params = []) {
  await client.query("SAVEPOINT sp");
  try {
    const res = await client.query(sql, params);
    await client.query("RELEASE SAVEPOINT sp");
    return res.rowCount;
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT sp");
    console.log(`    ⚠ ${label} skipped — ${err.message}`);
    return -1;
  }
}

async function wipeBrand(client, brand, apply) {
  console.log(`\n── ${brand} ──`);
  const before = await snapshot(client, brand);
  console.log(
    `  live now:  base=${before.base}  styled=${before.styled}  ` +
      `collections=${before.collections}  bundles=${before.bundles}  services=${before.services}`,
  );
  if (!apply) {
    console.log("  (dry run — nothing changed; pass --yes to apply)");
    return;
  }

  // Soft delete the stock-bearing + styled records (frees names for re-import).
  const baseDel = await guarded(
    client,
    "base products",
    `UPDATE ${brand}.products SET is_deleted = true, updated_at = now() WHERE is_deleted = false`,
  );
  const styledDel = await guarded(
    client,
    "styled products",
    `UPDATE ${brand}.styled_products SET is_deleted = true, updated_at = now() WHERE is_deleted = false`,
  );
  // Hard delete merchandising entities (full unique slug/code).
  const colDel = await guarded(
    client,
    "collections",
    `DELETE FROM ${brand}.product_collections`,
  );
  const bunDel = await guarded(
    client,
    "bundles",
    `DELETE FROM ${brand}.bundle_offers`,
  );
  const svcDel = await guarded(
    client,
    "services",
    `DELETE FROM shared.service_offerings WHERE business = $1`,
    [brand],
  );

  console.log(
    `  cleared:   base=${baseDel}  styled=${styledDel}  ` +
      `collections=${colDel}  bundles=${bunDel}  services=${svcDel}`,
  );
}

async function main() {
  const apply = !!getArg("yes");
  let brandArg = getArg("brand") || "all";
  if (brandArg === true) brandArg = "all";
  const brands =
    brandArg === "all" ? VALID_BRANDS : [String(brandArg).toLowerCase()];

  for (const b of brands) {
    if (!VALID_BRANDS.includes(b)) {
      console.error(`Unknown brand "${b}". Use: ${VALID_BRANDS.join(", ")} or all.`);
      process.exit(1);
    }
  }

  console.log(
    apply
      ? "⚠ APPLYING catalogue wipe (back up first: pg_dump ... -Fc -f backup.dump)"
      : "DRY RUN — counts only. Re-run with --yes to apply.",
  );

  const client = await pool.connect();
  try {
    for (const brand of brands) {
      await client.query("BEGIN");
      await wipeBrand(client, brand, apply);
      await client.query(apply ? "COMMIT" : "ROLLBACK");
    }
    console.log(`\n${apply ? "✓ Done." : "✓ Dry run complete."}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("\n✗ Failed — rolled back. No changes committed.");
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
