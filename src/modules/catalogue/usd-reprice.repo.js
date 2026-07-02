/**
 * USD bulk-reprice (Catalogue → Config "Apply USD exchange rate") — repository.
 * Parameterised SQL only.
 *
 * One admin-entered NGN-per-USD rate recomputes every USD price in the catalogue
 * from its NGN value, in a single transaction. Each run snapshots the prior USD
 * values (per table + pk) into catalogue_usd_reprice_runs so the last apply can
 * be undone. Services live in shared.service_offerings but are tagged by
 * `business`, so they are repriced for the active brand only.
 *
 * The rounding math is expressed once, in SQL (`roundExpr`), and mirrored in JS
 * by usd-reprice.service.js#roundUsd (used for the preview + unit tests). Keep
 * the two in sync.
 */

"use strict";

const { ex } = require("../../config/database");
const { assertBrand: brandSchema } = require("../../config/brands");
/**
 * Every USD column in the catalogue, mapped to the NGN column it derives from.
 * `schema: "shared"` + `brandScoped` means the table is shared but tagged by a
 * `business` column (services); everything else lives in the brand schema.
 */
const TABLES = [
  {
    key: "variants",
    table: "product_variants",
    pk: "variant_id",
    cols: {
      price_storefront_usd: "price_storefront_ngn",
      price_pos_usd: "price_pos_ngn",
      price_wholesale_usd: "price_wholesale_ngn",
      price_partner_usd: "price_partner_ngn",
      compare_at_price_usd: "compare_at_price_ngn",
    },
  },
  {
    key: "styled",
    table: "styled_products",
    pk: "styled_id",
    cols: {
      retail_price_usd: "retail_price_ngn",
      compare_at_price_usd: "compare_at_price_ngn",
    },
  },
  {
    key: "styled_variants",
    table: "styled_product_variants",
    pk: "styled_variant_id",
    cols: {
      price_override_usd: "price_override_ngn",
      compare_at_price_usd: "compare_at_price_ngn",
    },
  },
  {
    key: "size_tiers",
    table: "styled_size_tiers",
    pk: "tier_id",
    cols: { premium_usd: "premium_ngn" },
  },
  {
    key: "lace_sizes",
    table: "styled_lace_sizes",
    pk: "lace_id",
    cols: { premium_usd: "premium_ngn" },
  },
  {
    key: "colours",
    table: "styled_product_colours",
    pk: "colour_id",
    cols: { premium_usd: "premium_ngn" },
  },
  {
    key: "bundles",
    table: "bundle_offers",
    pk: "bundle_id",
    cols: { bundle_price_usd: "bundle_price_ngn" },
  },
  {
    key: "services",
    table: "service_offerings",
    pk: "service_id",
    schema: "shared",
    brandScoped: true,
    cols: {
      base_price_usd: "base_price_ngn",
      compare_at_price_usd: "compare_at_price_ngn",
    },
  },
];

const tableRef = (brand, def) =>
  def.schema ? `${def.schema}.${def.table}` : `${brandSchema(brand)}.${def.table}`;

/**
 * SQL expression that converts an NGN column to USD at the given rate
 * (a bound parameter placeholder, e.g. "$1") under the chosen rounding mode.
 * MUST mirror service.roundUsd.
 *   exact       → 2 decimal places (half-up)
 *   whole       → nearest whole dollar
 *   ninety_nine → charm price: floor + .99 (matches utils/money.charmRound USD)
 */
function roundExpr(ngnCol, rate, rounding) {
  const x = `(${ngnCol}::numeric / ${rate})`;
  if (rounding === "whole") return `ROUND(${x}, 0)`;
  if (rounding === "ninety_nine") return `(FLOOR(${x}) + 0.99)`;
  return `ROUND(${x}, 2)`;
}

/** WHERE clause selecting rows with at least one non-null NGN source (the rows a
 *  run would touch), optionally scoped to the active brand for shared tables. */
function affectedWhere(def, brandParamIdx) {
  const ngnCols = [...new Set(Object.values(def.cols))];
  const anyNotNull = ngnCols.map((c) => `${c} IS NOT NULL`).join(" OR ");
  let w = `(${anyNotNull})`;
  if (def.brandScoped) w += ` AND business = $${brandParamIdx}`;
  return w;
}

/** Per-section count of rows a run would change, plus the total. */
async function counts({ client, brand }) {
  const run = ex(client);
  const out = {};
  let total = 0;
  for (const def of TABLES) {
    const params = def.brandScoped ? [brand] : [];
    const { rows } = await run(
      `SELECT count(*)::int AS n FROM ${tableRef(brand, def)}
        WHERE ${affectedWhere(def, 1)}`,
      params,
    );
    out[def.key] = rows[0].n;
    total += rows[0].n;
  }
  out.total = total;
  return out;
}

/** A small, representative sample (styled products with a retail anchor) for the
 *  preview: name + current NGN/USD so the caller can show before → after. */
async function sampleStyled({ client, brand, limit = 5 }) {
  const { rows } = await ex(client)(
    `SELECT name, retail_price_ngn, retail_price_usd
       FROM ${brandSchema(brand)}.styled_products
      WHERE retail_price_ngn IS NOT NULL AND is_deleted = false
      ORDER BY created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

/**
 * Apply the rate across every table in one pass. For each table: snapshot the
 * prior USD values of the rows about to change (flattened JSON for an easy
 * set-based undo), then UPDATE. Returns the combined snapshot + per-table counts.
 * Runs inside the caller's transaction (client required).
 */
async function applyAll({ client, brand, rate, rounding }) {
  const run = ex(client);
  const snapshot = [];
  const changed = {};
  let total = 0;

  for (const def of TABLES) {
    const ref = tableRef(brand, def);
    const usdCols = Object.keys(def.cols);
    // rate is $1; brand (for shared tables) is $2.
    const brandParamIdx = 2;
    const where = affectedWhere(def, brandParamIdx);
    const params = def.brandScoped ? [rate, brand] : [rate];

    // 1. Snapshot prior USD values (flattened: { pk, <usd_col>: <prev>, … }).
    const snapSelect = usdCols
      .map((c) => `'${c}', ${c}`)
      .join(", ");
    const { rows: snapRows } = await run(
      `SELECT COALESCE(json_agg(json_build_object(
                'pk', ${def.pk}::text, ${snapSelect})), '[]'::json) AS rows
         FROM ${ref}
        WHERE ${affectedWhere(def, 1)}`,
      def.brandScoped ? [brand] : [],
    );
    const rowsSnap = snapRows[0].rows;

    // 2. Recompute each USD column from its NGN source (leave USD untouched
    //    where the NGN source is null — there is nothing to convert).
    const sets = Object.entries(def.cols)
      .map(
        ([usd, ngn]) =>
          `${usd} = CASE WHEN ${ngn} IS NULL THEN ${usd} ELSE ${roundExpr(
            ngn,
            "$1",
            rounding,
          )} END`,
      )
      .join(", ");
    const res = await run(
      `UPDATE ${ref} SET ${sets} WHERE ${where}`,
      params,
    );

    changed[def.key] = res.rowCount;
    total += res.rowCount;
    if (res.rowCount > 0) {
      snapshot.push({
        key: def.key,
        table: def.table,
        schema: def.schema || brand,
        pk: def.pk,
        usd_cols: usdCols,
        rows: rowsSnap,
      });
    }
  }

  changed.total = total;
  return { snapshot, counts: changed, rows_changed: total };
}

/** Insert the run record (rate, scope, rows changed, snapshot for undo). */
async function insertRun({
  client,
  brand,
  rate,
  rounding,
  scope,
  rows_changed,
  snapshot,
  applied_by,
}) {
  const { rows } = await ex(client)(
    `INSERT INTO ${brandSchema(brand)}.catalogue_usd_reprice_runs
       (rate, rounding, scope, rows_changed, snapshot, applied_by)
     VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6)
     RETURNING run_id, applied_at`,
    [
      rate,
      rounding,
      JSON.stringify(scope || {}),
      rows_changed,
      JSON.stringify(snapshot || []),
      applied_by || null,
    ],
  );
  return rows[0];
}

/** Persist the last applied rate on the catalogue config (banner + prefill). */
async function setConfigRate({ client, brand, rate, user_id }) {
  await ex(client)(
    `INSERT INTO ${brandSchema(brand)}.catalogue_config
       (singleton, usd_fx_rate, usd_fx_rate_applied_at, usd_fx_rate_applied_by)
     VALUES (true, $1, now(), $2)
     ON CONFLICT (singleton) DO UPDATE SET
       usd_fx_rate = EXCLUDED.usd_fx_rate,
       usd_fx_rate_applied_at = EXCLUDED.usd_fx_rate_applied_at,
       usd_fx_rate_applied_by = EXCLUDED.usd_fx_rate_applied_by`,
    [rate, user_id || null],
  );
}

/** The most recent run that hasn't been undone (the one Undo would revert). */
async function latestRun({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT run_id, rate, rounding, rows_changed, snapshot, applied_at, applied_by
       FROM ${brandSchema(brand)}.catalogue_usd_reprice_runs
      WHERE is_undone = false
      ORDER BY applied_at DESC
      LIMIT 1`,
  );
  return rows[0] || null;
}

/** Restore every snapshotted USD value (set-based per table via json_to_recordset). */
async function restoreSnapshot({ client, brand, snapshot }) {
  const run = ex(client);
  let restored = 0;
  for (const entry of snapshot || []) {
    const ref = entry.schema
      ? `${entry.schema}.${entry.table}`
      : `${brandSchema(brand)}.${entry.table}`;
    const cols = entry.usd_cols || [];
    if (!cols.length) continue;
    const sets = cols.map((c) => `${c} = s."${c}"`).join(", ");
    const recordCols = ["pk text", ...cols.map((c) => `"${c}" numeric`)].join(
      ", ",
    );
    const res = await run(
      `UPDATE ${ref} AS t SET ${sets}
         FROM json_to_recordset($1::json) AS s(${recordCols})
        WHERE t.${entry.pk}::text = s.pk`,
      [JSON.stringify(entry.rows || [])],
    );
    restored += res.rowCount;
  }
  return restored;
}

/** Mark a run undone (so Undo can't double-apply). */
async function markUndone({ client, brand, run_id, user_id }) {
  await ex(client)(
    `UPDATE ${brandSchema(brand)}.catalogue_usd_reprice_runs
        SET is_undone = true, undone_at = now(), undone_by = $2
      WHERE run_id = $1`,
    [run_id, user_id || null],
  );
}

/** Config rate + last run summary for the GET status endpoint. */
async function status({ client, brand }) {
  const run = ex(client);
  const { rows: cfg } = await run(
    `SELECT usd_fx_rate, usd_fx_rate_applied_at, usd_fx_rate_applied_by
       FROM ${brandSchema(brand)}.catalogue_config WHERE singleton = true`,
  );
  const { rows: last } = await run(
    `SELECT r.run_id, r.rate, r.rounding, r.rows_changed, r.applied_at,
            r.is_undone, u.email AS applied_by_email
       FROM ${brandSchema(brand)}.catalogue_usd_reprice_runs r
       LEFT JOIN shared.users u ON u.user_id = r.applied_by
      ORDER BY r.applied_at DESC
      LIMIT 1`,
  );
  return {
    config: cfg[0] || null,
    last_run: last[0] || null,
  };
}

module.exports = {
  TABLES,
  roundExpr,
  counts,
  sampleStyled,
  applyAll,
  insertRun,
  setConfigRate,
  latestRun,
  restoreSnapshot,
  markUndone,
  status,
};
