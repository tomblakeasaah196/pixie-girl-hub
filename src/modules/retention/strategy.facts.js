/**
 * Customer "facts" builder for the retention strategy engine (Module 6.23).
 *
 * Produces a flat, JSON-serialisable object describing a customer at a point
 * in time. It powers two things:
 *   1. Condition evaluation (strategy.conditions) — trigger + step predicates.
 *   2. Email templating — {{first_name}}, {{points_balance}}, … tokens.
 *
 * The snapshot is stored on the enrolment row (`context`) so a multi-day
 * journey evaluates against consistent data and is fully auditable.
 */

"use strict";

const { query } = require("../../config/database");
const { VALID } = require("../../config/brands");

const ex = (c) => (c ? c.query.bind(c) : query);
const t = (brand, tbl) => {
  if (!VALID.has(brand)) throw new Error(`Invalid brand: ${brand}`);
  return `${brand}.${tbl}`;
};

// Orders that count toward spend / recency: placed and not voided.
const COUNTED_ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "awaiting_dispatch",
  "in_production",
  "with_stylist",
  "ready_for_dispatch",
  "dispatched",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "completed",
];

function daysBetween(from, to = new Date()) {
  if (!from) return null;
  const ms = to.getTime() - new Date(from).getTime();
  return Math.floor(ms / 86_400_000);
}

/**
 * @param {{ brand:string, contact_id?:string|null, event?:object, client?:object }} args
 * @returns {Promise<object>} flat facts
 */
async function build({ brand, contact_id, event = {}, client }) {
  const facts = {
    brand,
    brand_name: brandName(brand),
    contact_id: contact_id || null,
    // event context is always available under `event.*` and merged shallowly.
    event,
    ...flattenEvent(event),
  };
  if (!contact_id) return facts;

  const run = ex(client);

  // Contact identity.
  const { rows: cRows } = await run(
    `SELECT contact_id, first_name, display_name, email, primary_phone,
            date_of_birth, created_at
       FROM shared.contacts WHERE contact_id = $1 AND business = $2`,
    [contact_id, brand],
  );
  const c = cRows[0];
  if (c) {
    facts.first_name = c.first_name || c.display_name || "there";
    facts.display_name = c.display_name || c.first_name || "";
    facts.email = c.email || null;
    facts.phone = c.primary_phone || null;
    facts.date_of_birth = c.date_of_birth || null;
    facts.days_since_signup = daysBetween(c.created_at);
    const bday = birthdayFlags(c.date_of_birth);
    facts.is_birthday_today = bday.today;
    facts.birthday_month = bday.month;
    facts.birthday_day = bday.day;
  } else {
    facts.first_name = "there";
  }

  // Loyalty state (shared).
  const { rows: lRows } = await run(
    `SELECT s.current_balance, s.lifetime_earned, s.lifetime_redeemed,
            ti.tier_key, ti.tier_name
       FROM shared.customer_loyalty_state s
       LEFT JOIN shared.loyalty_tiers ti ON ti.tier_id = s.current_tier_id
      WHERE s.contact_id = $1 AND s.business = $2`,
    [contact_id, brand],
  );
  const l = lRows[0] || {};
  facts.points_balance = Number(l.current_balance || 0);
  facts.lifetime_points = Number(l.lifetime_earned || 0);
  facts.points_redeemed = Number(l.lifetime_redeemed || 0);
  facts.tier_key = l.tier_key || null;
  facts.tier_name = l.tier_name || null;
  facts.tier = { key: l.tier_key || null, name: l.tier_name || null };

  // Tags (membership primitive).
  const { rows: tagRows } = await run(
    `SELECT tag_name FROM shared.contact_tags WHERE contact_id = $1 AND business = $2`,
    [contact_id, brand],
  );
  facts.tags = tagRows.map((r) => r.tag_name);

  // Order aggregates (brand schema).
  const { rows: oRows } = await run(
    `SELECT COUNT(*)::int AS order_count,
            COALESCE(SUM(total_ngn), 0)::numeric AS lifetime_spend,
            MAX(placed_at) AS last_order_at
       FROM ${t(brand, "sales_orders")}
      WHERE contact_id = $1 AND placed_at IS NOT NULL
        AND status = ANY($2)`,
    [contact_id, COUNTED_ORDER_STATUSES],
  );
  const o = oRows[0] || {};
  facts.order_count = Number(o.order_count || 0);
  facts.lifetime_spend = Number(o.lifetime_spend || 0);
  facts.has_ordered = facts.order_count > 0;
  facts.last_order_at = o.last_order_at || null;
  facts.days_since_last_order = o.last_order_at
    ? daysBetween(o.last_order_at)
    : null;

  return facts;
}

function brandName(brand) {
  return brand === "pixiegirl"
    ? "Pixie Girl"
    : brand === "faitlynhair"
      ? "Faitlyn Hair"
      : brand;
}

function birthdayFlags(dob) {
  if (!dob) return { today: false, month: null, day: null };
  const d = new Date(dob);
  const now = new Date();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return {
    today: now.getUTCMonth() + 1 === month && now.getUTCDate() === day,
    month,
    day,
  };
}

/** Promote common event fields to top level so conditions can use them plainly. */
function flattenEvent(event) {
  if (!event || typeof event !== "object") return {};
  const out = {};
  if (event.order_total_ngn !== null && event.order_total_ngn !== undefined)
    out.order_total = Number(event.order_total_ngn);
  if (event.total_ngn !== null && event.total_ngn !== undefined)
    out.order_total = Number(event.total_ngn);
  if (event.tier_key) out.event_tier_key = event.tier_key;
  return out;
}

module.exports = { build, COUNTED_ORDER_STATUSES, brandName };
