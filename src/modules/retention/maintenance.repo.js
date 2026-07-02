/**
 * Maintenance plans repository (Module 6.23 — Faitlyn salon maintenance
 * subscriptions). Per-brand tables {brand}.maintenance_plans +
 * maintenance_subscriptions. Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");
const COLS = [
  "plan_key",
  "display_name",
  "description",
  "billing_cycle",
  "price_ngn",
  "included_services",
  "extra_service_discount_pct",
  "benefits",
  "is_active",
  "display_order",
];
const JSON_COLS = new Set(["included_services", "benefits"]);

async function listPlans({ brand }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "maintenance_plans")} ORDER BY display_order, created_at`,
  );
  return rows;
}

async function createPlan({ brand, input }) {
  const f = [];
  const ph = [];
  const p = [];
  let i = 1;
  for (const c of COLS) {
    if (input[c] === undefined) continue;
    f.push(c);
    ph.push(JSON_COLS.has(c) ? `$${i++}::jsonb` : `$${i++}`);
    p.push(JSON_COLS.has(c) ? JSON.stringify(input[c]) : input[c]);
  }
  const { rows } = await query(
    `INSERT INTO ${t(brand, "maintenance_plans")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}

async function updatePlan({ brand, id, patch }) {
  const keys = Object.keys(patch).filter((k) => COLS.includes(k));
  if (keys.length === 0) {
    const { rows } = await query(
      `SELECT * FROM ${t(brand, "maintenance_plans")} WHERE plan_id = $1`,
      [id],
    );
    return rows[0] || null;
  }
  const sets = keys.map((k, idx) =>
    JSON_COLS.has(k) ? `${k} = $${idx + 2}::jsonb` : `${k} = $${idx + 2}`,
  );
  const vals = keys.map((k) => (JSON_COLS.has(k) ? JSON.stringify(patch[k]) : patch[k]));
  const { rows } = await query(
    `UPDATE ${t(brand, "maintenance_plans")} SET ${sets.join(", ")}, updated_at = now()
      WHERE plan_id = $1 RETURNING *`,
    [id, ...vals],
  );
  return rows[0] || null;
}

async function listSubscriptions({ brand, limit = 100 }) {
  const { rows } = await query(
    `SELECT s.*, p.display_name AS plan_name, c.first_name, c.display_name AS contact_name
       FROM ${t(brand, "maintenance_subscriptions")} s
       JOIN ${t(brand, "maintenance_plans")} p ON p.plan_id = s.plan_id
       LEFT JOIN shared.contacts c ON c.contact_id = s.contact_id
      ORDER BY s.created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

module.exports = { listPlans, createPlan, updatePlan, listSubscriptions };
