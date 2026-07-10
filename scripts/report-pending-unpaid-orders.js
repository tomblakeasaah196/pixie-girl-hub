#!/usr/bin/env node
"use strict";

/**
 * Review list for the Flexi Pay cleanup (plan D10/Q23): every pending order
 * with ₦0 paid, per brand — the population the abandoned-checkout sweep will
 * nudge/expire once deployed. Run it BEFORE deploy for the client to eyeball,
 * and after to confirm the backlog drained.
 *
 * Usage:
 *   node scripts/report-pending-unpaid-orders.js            # table to stdout
 *   node scripts/report-pending-unpaid-orders.js --csv out.csv
 */

const fs = require("fs");
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

async function getBrands() {
  const { rows } = await pool.query(
    `SELECT business_key FROM shared.business_config WHERE is_active = true ORDER BY business_key`,
  );
  return rows.map((r) => r.business_key);
}

async function main() {
  const csvIdx = process.argv.indexOf("--csv");
  const csvPath = csvIdx > -1 ? process.argv[csvIdx + 1] : null;

  const brands = await getBrands();
  const all = [];
  for (const brand of brands) {
    const { rows } = await pool.query(
      `SELECT so.order_number,
              so.sales_channel,
              so.payment_plan,
              so.total_ngn,
              so.created_at::date AS placed,
              EXTRACT(DAY FROM now() - so.created_at)::int AS age_days,
              c.display_name AS customer,
              c.phone
         FROM ${brand}.sales_orders so
         LEFT JOIN shared.contacts c ON c.contact_id = so.contact_id
        WHERE so.status = 'pending_payment'
          AND so.amount_paid_ngn = 0
        ORDER BY so.created_at`,
    );
    for (const r of rows) all.push({ brand, ...r });
  }

  if (!all.length) {
    console.warn("No pending ₦0-paid orders — backlog is clean.");
  } else {
    console.warn(`\n${all.length} pending orders with ₦0 paid:\n`);
    // eslint-disable-next-line no-console
    console.table(
      all.map((r) => ({
        brand: r.brand,
        order: r.order_number,
        channel: r.sales_channel,
        plan: r.payment_plan,
        total_ngn: r.total_ngn,
        placed: String(r.placed).slice(0, 10),
        age_days: r.age_days,
        customer: r.customer || "—",
        phone: r.phone || "—",
      })),
    );
  }

  if (csvPath) {
    const header =
      "brand,order_number,sales_channel,payment_plan,total_ngn,placed,age_days,customer,phone";
    const lines = all.map((r) =>
      [
        r.brand,
        r.order_number,
        r.sales_channel,
        r.payment_plan,
        r.total_ngn,
        String(r.placed).slice(0, 10),
        r.age_days,
        JSON.stringify(r.customer || ""),
        JSON.stringify(r.phone || ""),
      ].join(","),
    );
    fs.writeFileSync(csvPath, [header, ...lines].join("\n") + "\n");
    console.warn(`CSV written to ${csvPath}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
