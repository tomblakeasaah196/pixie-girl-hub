#!/usr/bin/env node
"use strict";

/**
 * Outstanding balance — the live collection queue, per brand.
 *
 * Repeatable form of the production audit that drove the Sales → Orders
 * **Outstanding Balance** view. It answers two questions the raw database total
 * cannot:
 *
 *   1. Which ACTIVE customers owe us money?  (`balance_due_ngn > 0` on an order
 *      that is not draft / cancel-requested / cancelled / refunded / failed) —
 *      split into part-paid debtors and the ₦0-paid orders still on the slow
 *      lane.
 *   2. Why doesn't that match `SELECT SUM(balance_due_ngn) WHERE balance > 0`?
 *      Because the raw total is dominated by cancelled ₦0-paid history. Those
 *      rows KEEP their totals and balances (nothing here writes) — they are
 *      simply not receivables. In the audited snapshot: 46 raw rows /
 *      ₦25,512,175 vs 3 live orders / ₦1,738,000, with 43 cancelled orders
 *      holding ₦23,774,175.
 *
 * Same predicate as `sales.repo.listOrders({ outstanding_balance: true })` and
 * `sales.repo.collectionsSummary`, so the CLI, the API and the Sales UI cannot
 * disagree. Read-only.
 *
 * Usage:
 *   node scripts/report-outstanding-balance.js               # summary + table
 *   node scripts/report-outstanding-balance.js --csv out.csv # + live queue CSV
 *   npm run report:outstanding
 */

const fs = require("fs");
const { Pool } = require("pg");
require("dotenv").config();

// Lifecycle states that are not live collection work — mirrors
// COLLECTION_EXCLUDED_STATES in src/modules/sales/order-status.js.
const DEAD_STATES = [
  "draft",
  "cancellation_requested",
  "cancelled",
  "refunded",
  "failed",
];
const DEAD_SQL = `(${DEAD_STATES.map((s) => `'${s}'`).join(",")})`;

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const ngn = (v) =>
  `₦${Number(v || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;

async function getBrands() {
  const { rows } = await pool.query(
    `SELECT business_key FROM shared.business_config WHERE is_active = true ORDER BY business_key`,
  );
  return rows.map((r) => r.business_key);
}

/** One row per brand: live queue, its split, and the excluded/raw reconciliation. */
async function summaryFor(brand) {
  const { rows } = await pool.query(
    `WITH s AS (
       SELECT so.balance_due_ngn, so.amount_paid_ngn,
              (so.status NOT IN ${DEAD_SQL}) AS is_live
         FROM ${brand}.sales_orders so
     )
     SELECT
       count(*) FILTER (WHERE is_live AND balance_due_ngn > 0)::int AS live_orders,
       COALESCE(SUM(balance_due_ngn) FILTER (WHERE is_live AND balance_due_ngn > 0),0) AS live_balance,
       count(*) FILTER (WHERE is_live AND balance_due_ngn > 0 AND amount_paid_ngn > 0)::int AS part_paid_orders,
       COALESCE(SUM(balance_due_ngn) FILTER (WHERE is_live AND balance_due_ngn > 0 AND amount_paid_ngn > 0),0) AS part_paid_balance,
       count(*) FILTER (WHERE is_live AND balance_due_ngn > 0 AND COALESCE(amount_paid_ngn,0) = 0)::int AS zero_paid_orders,
       COALESCE(SUM(balance_due_ngn) FILTER (WHERE is_live AND balance_due_ngn > 0 AND COALESCE(amount_paid_ngn,0) = 0),0) AS zero_paid_balance,
       count(*) FILTER (WHERE NOT is_live AND balance_due_ngn > 0)::int AS dead_orders,
       COALESCE(SUM(balance_due_ngn) FILTER (WHERE NOT is_live AND balance_due_ngn > 0),0) AS dead_balance,
       count(*) FILTER (WHERE balance_due_ngn > 0)::int AS raw_orders,
       COALESCE(SUM(balance_due_ngn) FILTER (WHERE balance_due_ngn > 0),0) AS raw_balance
       FROM s`,
  );
  return rows[0];
}

/** The live queue itself — who to chase, oldest first. */
async function queueFor(brand) {
  const { rows } = await pool.query(
    `SELECT so.order_number, so.status, so.sales_channel, so.payment_plan,
            so.total_ngn, so.amount_paid_ngn, so.balance_due_ngn,
            COALESCE(so.placed_at, so.created_at)::date AS placed,
            EXTRACT(DAY FROM now() - COALESCE(so.placed_at, so.created_at))::int AS age_days,
            c.display_name AS customer, c.primary_phone AS phone
       FROM ${brand}.sales_orders so
       LEFT JOIN shared.contacts c ON c.contact_id = so.contact_id
      WHERE so.balance_due_ngn > 0
        AND so.status NOT IN ${DEAD_SQL}
      ORDER BY COALESCE(so.placed_at, so.created_at) ASC`,
  );
  return rows;
}

async function main() {
  const csvIdx = process.argv.indexOf("--csv");
  const csvPath = csvIdx > -1 ? process.argv[csvIdx + 1] : null;

  const brands = await getBrands();
  const csvRows = [];
  let liveTotal = 0;
  let liveOrders = 0;

  for (const brand of brands) {
    const s = await summaryFor(brand);
    const queue = await queueFor(brand);
    liveTotal += Number(s.live_balance);
    liveOrders += s.live_orders;

    // eslint-disable-next-line no-console
    console.log(`\n── ${brand} ${"─".repeat(Math.max(0, 56 - brand.length))}`);
    // eslint-disable-next-line no-console
    console.log(
      `  LIVE OUTSTANDING   ${String(s.live_orders).padStart(4)} orders   ${ngn(s.live_balance)}`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `    part-paid        ${String(s.part_paid_orders).padStart(4)} orders   ${ngn(s.part_paid_balance)}`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `    ₦0 paid (slow lane) ${String(s.zero_paid_orders).padStart(2)} orders   ${ngn(s.zero_paid_balance)}`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `  NOT COLLECTABLE    ${String(s.dead_orders).padStart(4)} orders   ${ngn(s.dead_balance)}   (draft/cancel-requested/cancelled/refunded/failed — history, untouched)`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `  RAW balance > 0    ${String(s.raw_orders).padStart(4)} orders   ${ngn(s.raw_balance)}`,
    );
    const reconciled =
      Number(s.live_balance) + Number(s.dead_balance) === Number(s.raw_balance);
    // eslint-disable-next-line no-console
    console.log(
      `  reconciliation     live + not-collectable = raw  ${reconciled ? "✓" : "✗ MISMATCH"}`,
    );
    if (!reconciled) {
      // eslint-disable-next-line no-console
      console.error(
        `  !! ${brand}: live (${s.live_balance}) + dead (${s.dead_balance}) <> raw (${s.raw_balance})`,
      );
    }

    if (queue.length) {
      // eslint-disable-next-line no-console
      console.table(
        queue.map((r) => ({
          order: r.order_number,
          stage: r.status,
          channel: r.sales_channel,
          plan: r.payment_plan || "—",
          total_ngn: r.total_ngn,
          paid_ngn: r.amount_paid_ngn,
          owed_ngn: r.balance_due_ngn,
          placed: String(r.placed).slice(0, 10),
          age_days: r.age_days,
          customer: r.customer || "—",
          phone: r.phone || "—",
        })),
      );
    } else {
      // eslint-disable-next-line no-console
      console.log("  (nothing outstanding — every active order is settled)");
    }

    for (const r of queue) csvRows.push({ brand, ...r });
  }

  // eslint-disable-next-line no-console
  console.log(
    `\n== All brands: ${liveOrders} live orders, ${ngn(liveTotal)} outstanding ==\n`,
  );

  if (csvPath) {
    const header =
      "brand,order_number,status,sales_channel,payment_plan,total_ngn,amount_paid_ngn,balance_due_ngn,placed,age_days,customer,phone";
    const lines = csvRows.map((r) =>
      [
        r.brand,
        r.order_number,
        r.status,
        r.sales_channel,
        r.payment_plan || "",
        r.total_ngn,
        r.amount_paid_ngn,
        r.balance_due_ngn,
        String(r.placed).slice(0, 10),
        r.age_days,
        JSON.stringify(r.customer || ""),
        JSON.stringify(r.phone || ""),
      ].join(","),
    );
    fs.writeFileSync(csvPath, [header, ...lines].join("\n") + "\n");
    // eslint-disable-next-line no-console
    console.log(`CSV written to ${csvPath}`);
  }

  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
