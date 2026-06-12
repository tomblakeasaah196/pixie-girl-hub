/**
 * Coupon engine repository (F-3 / PD §6.23.2). Operates on the shared
 * coupons / coupon_redemptions tables (business-scoped).
 */

"use strict";

const { query } = require("../../config/database");

const ex = (c) => (c ? c.query.bind(c) : query);

const COUPON_COLS = [
  "coupon_code",
  "display_name",
  "description",
  "discount_type",
  "discount_value",
  "currency",
  "min_order_value",
  "max_discount_value",
  "applies_to_products",
  "applies_to_categories",
  "customer_segment_id",
  "first_time_only",
  "valid_from",
  "valid_to",
  "total_usage_limit",
  "per_customer_limit",
  "is_single_use",
  "is_active",
  "metadata",
];

async function create({ client, brand, input, user_id }) {
  const cols = [
    "business",
    ...COUPON_COLS.filter((c) => input[c] !== undefined),
    "created_by",
  ];
  const vals = [
    brand,
    ...COUPON_COLS.filter((c) => input[c] !== undefined).map((c) => input[c]),
    user_id || null,
  ];
  const ph = vals.map((_, i) => `$${i + 1}`);
  const { rows } = await ex(client)(
    `INSERT INTO shared.coupons (${cols.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    vals,
  );
  return rows[0];
}

async function list({ brand, only_active }) {
  const where = ["business = $1"];
  if (only_active) where.push("is_active = true");
  const { rows } = await query(
    `SELECT * FROM shared.coupons WHERE ${where.join(" AND ")} ORDER BY created_at DESC`,
    [brand],
  );
  return rows;
}

async function getByCode({ client, brand, code }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.coupons WHERE business = $1 AND coupon_code = $2`,
    [brand, code],
  );
  return rows[0] || null;
}

/** Lock the coupon row for the duration of a redemption tx (usage-limit safety). */
async function lockByCode({ client, brand, code }) {
  const { rows } = await client.query(
    `SELECT * FROM shared.coupons
      WHERE business = $1 AND coupon_code = $2 FOR UPDATE`,
    [brand, code],
  );
  return rows[0] || null;
}

async function getById({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM shared.coupons WHERE business = $1 AND coupon_id = $2`,
    [brand, id],
  );
  return rows[0] || null;
}

async function update({ brand, id, patch }) {
  const keys = Object.keys(patch).filter((k) => COUPON_COLS.includes(k));
  if (keys.length === 0) return getById({ brand, id });
  const sets = keys.map((k, i) => `${k} = $${i + 3}`);
  const { rows } = await query(
    `UPDATE shared.coupons SET ${sets.join(", ")}, updated_at = now()
      WHERE business = $1 AND coupon_id = $2 RETURNING *`,
    [brand, id, ...keys.map((k) => patch[k])],
  );
  return rows[0] || null;
}

async function setActive({ brand, id, is_active }) {
  const { rows } = await query(
    `UPDATE shared.coupons SET is_active = $3, updated_at = now()
      WHERE business = $1 AND coupon_id = $2 RETURNING *`,
    [brand, id, is_active],
  );
  return rows[0] || null;
}

async function countCustomerRedemptions({ client, coupon_id, contact_id }) {
  if (!contact_id) return 0;
  const { rows } = await ex(client)(
    `SELECT count(*)::int AS c FROM shared.coupon_redemptions
      WHERE coupon_id = $1 AND contact_id = $2`,
    [coupon_id, contact_id],
  );
  return rows[0].c;
}

async function redemptionExists({
  client,
  coupon_id,
  reference_type,
  reference_id,
}) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM shared.coupon_redemptions
      WHERE coupon_id = $1 AND reference_type = $2 AND reference_id = $3 LIMIT 1`,
    [coupon_id, reference_type, reference_id],
  );
  return rows.length > 0;
}

async function recordRedemption({ client, redemption }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.coupon_redemptions
       (coupon_id, contact_id, business, reference_type, reference_id,
        discount_applied, display_currency, display_discount, redeemed_ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      redemption.coupon_id,
      redemption.contact_id || null,
      redemption.business,
      redemption.reference_type,
      redemption.reference_id,
      redemption.discount_applied,
      redemption.display_currency || null,
      redemption.display_discount || null,
      redemption.redeemed_ip || null,
    ],
  );
  return rows[0];
}

async function bumpUsage({ client, coupon_id, discount_ngn }) {
  await ex(client)(
    `UPDATE shared.coupons
        SET total_redeemed = total_redeemed + 1,
            total_discount_given = total_discount_given + $2,
            updated_at = now()
      WHERE coupon_id = $1`,
    [coupon_id, discount_ngn],
  );
}

module.exports = {
  create,
  list,
  getByCode,
  lockByCode,
  getById,
  update,
  setActive,
  countCustomerRedemptions,
  redemptionExists,
  recordRedemption,
  bumpUsage,
};
