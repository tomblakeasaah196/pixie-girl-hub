/**
 * Wig subscription repository (F-1 / PD §6.23.5). Shared, business-scoped
 * tables: subscription_plans, subscriptions, subscription_billing_attempts.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (c) => (c ? c.query.bind(c) : query);

const PLAN_COLS = [
  "plan_key",
  "display_name",
  "description",
  "billing_cycle",
  "units_per_cycle",
  "price_ngn",
  "discount_pct_vs_retail",
  "selection_mode",
  "benefits",
  "is_active",
  "display_order",
];

// ── Plans ─────────────────────────────────────────────────
async function createPlan({ client, brand, input }) {
  const cols = ["business"];
  const ph = ["$1"];
  const p = [brand];
  let i = 2;
  for (const c of PLAN_COLS) {
    if (input[c] === undefined) continue;
    cols.push(c);
    ph.push(c === "benefits" ? `$${i++}::jsonb` : `$${i++}`);
    p.push(c === "benefits" ? JSON.stringify(input[c]) : input[c]);
  }
  const { rows } = await ex(client)(
    `INSERT INTO shared.subscription_plans (${cols.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}

async function listPlans({ brand, only_active }) {
  const where = ["business = $1"];
  if (only_active) where.push("is_active = true");
  const { rows } = await query(
    `SELECT * FROM shared.subscription_plans WHERE ${where.join(" AND ")}
      ORDER BY display_order, price_ngn`,
    [brand],
  );
  return rows;
}

async function getPlan({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.subscription_plans WHERE business = $1 AND plan_id = $2`,
    [brand, id],
  );
  return rows[0] || null;
}

async function updatePlan({ brand, id, patch }) {
  const keys = Object.keys(patch).filter((k) => PLAN_COLS.includes(k));
  if (keys.length === 0) return getPlan({ brand, id });
  const sets = keys.map((k, i) =>
    k === "benefits" ? `${k} = $${i + 3}::jsonb` : `${k} = $${i + 3}`,
  );
  const vals = keys.map((k) =>
    k === "benefits" ? JSON.stringify(patch[k]) : patch[k],
  );
  const { rows } = await query(
    `UPDATE shared.subscription_plans SET ${sets.join(", ")}, updated_at = now()
      WHERE business = $1 AND plan_id = $2 RETURNING *`,
    [brand, id, ...vals],
  );
  return rows[0] || null;
}

async function setPlanActive({ brand, id, is_active }) {
  const { rows } = await query(
    `UPDATE shared.subscription_plans SET is_active = $3, updated_at = now()
      WHERE business = $1 AND plan_id = $2 RETURNING *`,
    [brand, id, is_active],
  );
  return rows[0] || null;
}

// ── Subscriptions ─────────────────────────────────────────
async function createSubscription({ client, brand, sub }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.subscriptions
       (contact_id, business, plan_id, status, paystack_authorization_code,
        paystack_customer_code, next_billing_at, preferences, default_delivery_address_id)
     VALUES ($1,$2,$3,'active',$4,$5,$6,COALESCE($7,'{}')::jsonb,$8) RETURNING *`,
    [
      sub.contact_id,
      brand,
      sub.plan_id,
      sub.paystack_authorization_code || null,
      sub.paystack_customer_code || null,
      sub.next_billing_at,
      sub.preferences ? JSON.stringify(sub.preferences) : null,
      sub.default_delivery_address_id || null,
    ],
  );
  return rows[0];
}

async function getSubscription({ brand, id }) {
  const { rows } = await query(
    `SELECT s.*, p.plan_key, p.display_name AS plan_name, p.billing_cycle, p.price_ngn
       FROM shared.subscriptions s
       JOIN shared.subscription_plans p ON p.plan_id = s.plan_id
      WHERE s.business = $1 AND s.subscription_id = $2`,
    [brand, id],
  );
  return rows[0] || null;
}

async function listSubscriptions({ brand, contact_id, status }) {
  const where = ["s.business = $1"];
  const params = [brand];
  let i = 2;
  if (contact_id) {
    where.push(`s.contact_id = $${i++}`);
    params.push(contact_id);
  }
  if (status) {
    where.push(`s.status = $${i++}`);
    params.push(status);
  }
  const { rows } = await query(
    `SELECT s.*, p.plan_key, p.display_name AS plan_name
       FROM shared.subscriptions s
       JOIN shared.subscription_plans p ON p.plan_id = s.plan_id
      WHERE ${where.join(" AND ")} ORDER BY s.created_at DESC`,
    params,
  );
  return rows;
}

async function setStatus({ brand, id, status, fields = {} }) {
  const sets = ["status = $3", "updated_at = now()"];
  const params = [brand, id, status];
  let i = 4;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  const { rows } = await query(
    `UPDATE shared.subscriptions SET ${sets.join(", ")}
      WHERE business = $1 AND subscription_id = $2 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Billing (W-C) ─────────────────────────────────────────
async function claimDueForBilling({ client, brand, limit }) {
  const { rows } = await client.query(
    `WITH due AS (
       SELECT subscription_id FROM shared.subscriptions
        WHERE business = $1 AND status = 'active' AND next_billing_at <= now()
        ORDER BY next_billing_at
        FOR UPDATE SKIP LOCKED
        LIMIT $2
     )
     UPDATE shared.subscriptions s SET updated_at = now()
       FROM due WHERE s.subscription_id = due.subscription_id
     RETURNING s.*`,
    [brand, limit],
  );
  return rows;
}

async function insertBillingAttempt({ client, attempt }) {
  const q = client ? client.query.bind(client) : query;
  const { rows } = await q(
    `INSERT INTO shared.subscription_billing_attempts
       (subscription_id, amount_ngn, paystack_reference, status, failure_message, created_order_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      attempt.subscription_id,
      attempt.amount_ngn,
      attempt.paystack_reference || null,
      attempt.status,
      attempt.failure_message || null,
      attempt.created_order_id || null,
    ],
  );
  return rows[0];
}

async function advanceAfterSuccess({ client, id, interval, amount_ngn }) {
  const q = client ? client.query.bind(client) : query;
  await q(
    `UPDATE shared.subscriptions
        SET next_billing_at = next_billing_at + $2::interval,
            last_billed_at = now(),
            total_cycles_billed = total_cycles_billed + 1,
            total_amount_billed_ngn = total_amount_billed_ngn + $3,
            failed_attempts_in_row = 0,
            updated_at = now()
      WHERE subscription_id = $1`,
    [id, interval, amount_ngn],
  );
}

async function recordBillingFailure({ client, id, set_past_due }) {
  const q = client ? client.query.bind(client) : query;
  await q(
    `UPDATE shared.subscriptions
        SET failed_attempts_in_row = failed_attempts_in_row + 1,
            status = CASE WHEN $2 THEN 'past_due' ELSE status END,
            updated_at = now()
      WHERE subscription_id = $1`,
    [id, set_past_due],
  );
}

module.exports = {
  createPlan,
  claimDueForBilling,
  insertBillingAttempt,
  advanceAfterSuccess,
  recordBillingFailure,
  listPlans,
  getPlan,
  updatePlan,
  setPlanActive,
  createSubscription,
  getSubscription,
  listSubscriptions,
  setStatus,
};
