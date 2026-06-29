#!/usr/bin/env node
/**
 * Seed default expense categories per brand.
 *
 * Both the Expenses module and the Cash Request module read their category
 * list from {brand}.expense_categories (per V2.2 6.32: "Same category set as
 * expense_categories"). A freshly bootstrapped brand has an EMPTY
 * expense_categories table, so both category dropdowns render blank. This
 * seeds a sensible default set so the dropdowns are populated out of the box;
 * admins can add/disable more from the UI ("New category").
 *
 * Idempotent: ON CONFLICT (category_key) DO NOTHING, so re-running never
 * duplicates and never overwrites admin edits. Safe after bootstrap.
 *
 *   node scripts/seed-expense-categories.js
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
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const BRANDS = ["pixiegirl", "faitlynhair"];

// key, display_name, description
const CATEGORIES = [
  ["office_supplies", "Office Supplies", "Stationery, consumables, office goods"],
  ["travel_local", "Travel - Local", "In-country transport and travel"],
  ["travel_international", "Travel - International", "Overseas travel and trips"],
  ["marketing_ads", "Marketing - Ads", "Paid advertising spend"],
  ["marketing_influencer", "Marketing - Influencer", "Influencer and UGC fees"],
  ["stylist_fees", "Stylist Fees", "Stylist and service-provider payments"],
  ["bank_charges", "Bank Charges", "Bank fees, transfer and gateway charges"],
  ["customs_duty", "Customs / Duty", "Import duty, customs and clearing"],
  ["logistics_3pl", "Logistics / 3PL", "Courier, shipping and fulfilment"],
  ["vendor_deposit", "Vendor Deposit", "Deposits and advances to suppliers"],
  ["staff_reimbursement", "Staff Reimbursement", "Out-of-pocket staff expenses"],
  ["utilities", "Utilities", "Electricity, internet, water, phone"],
  ["rent", "Rent", "Premises and equipment rent"],
  ["equipment", "Equipment", "Tools, devices and equipment purchases"],
  ["petty_cash", "Petty Cash", "Petty cash top-ups and small spend"],
  ["event_logistics", "Event / Logistics", "Events, shoots and logistics"],
  ["emergency", "Emergency", "Urgent unplanned spend"],
  ["other", "Other", "Uncategorised expenses"],
];

async function seedBrand(client, brand) {
  let inserted = 0;
  for (let i = 0; i < CATEGORIES.length; i++) {
    const [key, display, description] = CATEGORIES[i];
    const r = await client.query(
      `INSERT INTO ${brand}.expense_categories
         (category_key, display_name, description, display_order, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (category_key) DO NOTHING`,
      [key, display, description, i],
    );
    inserted += r.rowCount;
  }
  process.stdout.write(
    `  ${brand}: ${inserted} new (of ${CATEGORIES.length}) categories\n`,
  );
}

async function main() {
  const client = await pool.connect();
  try {
    process.stdout.write("Seeding expense categories...\n");
    for (const brand of BRANDS) {
      await seedBrand(client, brand);
    }
    process.stdout.write("Done.\n");
  } catch (err) {
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
