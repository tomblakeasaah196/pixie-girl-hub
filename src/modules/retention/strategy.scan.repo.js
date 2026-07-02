/**
 * Scan queries for the retention strategy engine's scheduled triggers
 * (Module 6.23). The daily scanner uses these to find the contacts that
 * should enter time-based strategies (birthday, anniversary, win-back,
 * inactivity, reorder, renewal, points-expiring) and to expire stale points.
 *
 * Inactivity-style triggers fire on the day a customer *crosses* the
 * threshold (last order exactly N days ago), so a strategy enrols a customer
 * once rather than every day they remain lapsed.
 */

"use strict";

const { query, transaction } = require("../../config/database");
const { t: tbl } = require("../../config/brands");
const COUNTED = "('draft','cancelled','refunded','cancellation_requested')";

async function birthdaysToday({ brand, limit = 1000 }) {
  const { rows } = await query(
    `SELECT contact_id FROM shared.contacts
      WHERE business = $1 AND date_of_birth IS NOT NULL
        AND EXTRACT(MONTH FROM date_of_birth) = EXTRACT(MONTH FROM now())
        AND EXTRACT(DAY FROM date_of_birth) = EXTRACT(DAY FROM now())
      LIMIT $2`,
    [brand, limit],
  );
  return rows.map((r) => r.contact_id);
}

async function signupAnniversariesToday({ brand, limit = 1000 }) {
  const { rows } = await query(
    `SELECT contact_id FROM shared.contacts
      WHERE business = $1
        AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM now())
        AND EXTRACT(DAY FROM created_at) = EXTRACT(DAY FROM now())
        AND created_at < date_trunc('year', now())
      LIMIT $2`,
    [brand, limit],
  );
  return rows.map((r) => r.contact_id);
}

/** Contacts whose most recent counted order was exactly `days` days ago. */
async function lapsedExactlyNDaysAgo({ brand, days, limit = 1000 }) {
  const { rows } = await query(
    `SELECT contact_id FROM (
        SELECT contact_id, MAX(placed_at)::date AS last_day
          FROM ${tbl(brand, "sales_orders")}
         WHERE placed_at IS NOT NULL AND status NOT IN ${COUNTED}
         GROUP BY contact_id
     ) o
      WHERE o.last_day = (now()::date - ($1 || ' days')::interval)
      LIMIT $2`,
    [String(days), limit],
  );
  return rows.map((r) => r.contact_id);
}

/** Active wig subscriptions due to renew in `days` days. */
async function subscriptionsRenewingInDays({ brand, days, limit = 1000 }) {
  const { rows } = await query(
    `SELECT contact_id FROM shared.subscriptions
      WHERE business = $1 AND status = 'active'
        AND next_billing_at::date = (now()::date + ($2 || ' days')::interval)
      LIMIT $3`,
    [brand, String(days), limit],
  );
  return rows.map((r) => r.contact_id);
}

/**
 * Carts abandoned by a known customer (active, no activity for `hours`, not
 * already flagged). Marks abandoned_at in the same statement so each cart
 * fires the trigger at most once, and returns the contacts to enrol.
 */
async function abandonedCarts({ brand, hours = 1, limit = 500 }) {
  const { rows } = await query(
    `WITH due AS (
        SELECT cart_id FROM shared.carts
         WHERE business = $1 AND status = 'active' AND contact_id IS NOT NULL
           AND abandoned_at IS NULL
           AND last_interaction_at < now() - ($2 || ' hours')::interval
         ORDER BY last_interaction_at
         LIMIT $3
     )
     UPDATE shared.carts c SET abandoned_at = now()
       FROM due WHERE c.cart_id = due.cart_id
     RETURNING c.contact_id`,
    [brand, String(hours), limit],
  );
  return rows.map((r) => r.contact_id).filter(Boolean);
}

/** Contacts with earned points expiring in `days` days. */
async function pointsExpiringInDays({ brand, days, limit = 1000 }) {
  const { rows } = await query(
    `SELECT DISTINCT contact_id FROM shared.loyalty_ledger
      WHERE business = $1 AND points > 0 AND expires_at IS NOT NULL
        AND expires_at::date = (now()::date + ($2 || ' days')::interval)
      LIMIT $3`,
    [brand, String(days), limit],
  );
  return rows.map((r) => r.contact_id);
}

/**
 * Expire earned points whose expires_at has passed and that haven't already
 * been expired. Conservative: each expired earn writes a matching negative
 * 'expired' row (linked via reverses_ledger_id) capped at the current balance,
 * so a balance can never go negative and a row is processed at most once.
 */
async function expireDuePoints({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT ledger_id, contact_id, points FROM shared.loyalty_ledger l
      WHERE l.business = $1 AND l.points > 0 AND l.expires_at IS NOT NULL
        AND l.expires_at < now()
        AND NOT EXISTS (
          SELECT 1 FROM shared.loyalty_ledger x
           WHERE x.reverses_ledger_id = l.ledger_id AND x.transaction_type = 'expired'
        )
      ORDER BY l.expires_at
      LIMIT $2`,
    [brand, limit],
  );

  let expired = 0;
  for (const row of rows) {
    await transaction(async (client) => {
      const { rows: sRows } = await client.query(
        `SELECT current_balance FROM shared.customer_loyalty_state
          WHERE contact_id = $1 AND business = $2 FOR UPDATE`,
        [row.contact_id, brand],
      );
      const balance = sRows[0] ? Number(sRows[0].current_balance) : 0;
      const amount = Math.min(Number(row.points), balance);
      if (amount <= 0) {
        // Nothing left to expire, but still mark this row processed.
        await client.query(
          `INSERT INTO shared.loyalty_ledger
             (contact_id, business, transaction_type, points, reverses_ledger_id, notes)
           VALUES ($1,$2,'expired',0,$3,'points already redeemed')`,
          [row.contact_id, brand, row.ledger_id],
        );
        return;
      }
      await client.query(
        `INSERT INTO shared.loyalty_ledger
           (contact_id, business, transaction_type, points, reverses_ledger_id, notes)
         VALUES ($1,$2,'expired',$3,$4,'points expired')`,
        [row.contact_id, brand, -amount, row.ledger_id],
      );
      expired += 1;
    });
  }
  return expired;
}

module.exports = {
  birthdaysToday,
  signupAnniversariesToday,
  lapsedExactlyNDaysAgo,
  subscriptionsRenewingInDays,
  pointsExpiringInDays,
  abandonedCarts,
  expireDuePoints,
};
