/**
 * Coupon engine (F-3 / PD §6.23.2).
 *
 * Admin CRUD over shared.coupons, plus the two checkout primitives:
 *   - validateCoupon(): pure check + discount computation (no writes), for the
 *     storefront/POS/sales "apply code" UX.
 *   - redeemCoupon(): transactional, row-locked, idempotent-per-order — records
 *     the redemption and bumps usage counters. Call from the order flow when an
 *     order carrying a coupon_code is confirmed.
 *
 * Money via decimal.js (utils/money) — never float.
 */

"use strict";

const repo = require("./coupon.repo");
const { query, transaction } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");

// ── Admin CRUD ────────────────────────────────────────────
async function createCoupon({ brand, user, request_id, input }) {
  const existing = await repo.getByCode({ brand, code: input.coupon_code });
  if (existing)
    throw new AppError(
      "COUPON_EXISTS",
      `Coupon ${input.coupon_code} already exists`,
      409,
    );
  const coupon = await transaction((client) =>
    repo.create({ client, brand, input, user_id: user.user_id }),
  );
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.coupon.create",
    target_type: "coupon",
    target_id: coupon.coupon_id,
    after: { coupon_code: coupon.coupon_code },
    request_id,
  });
  return coupon;
}

const listCoupons = ({ brand, only_active }) =>
  repo.list({ brand, only_active });

async function getCoupon({ brand, id }) {
  const c = await repo.getById({ brand, id });
  if (!c) throw new NotFoundError("Coupon");
  return c;
}

async function updateCoupon({ brand, user, request_id, id, patch }) {
  const c = await repo.update({ brand, id, patch });
  if (!c) throw new NotFoundError("Coupon");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.coupon.update",
    target_type: "coupon",
    target_id: id,
    after: patch,
    request_id,
  });
  return c;
}

async function setCouponActive({ brand, user, request_id, id, is_active }) {
  const c = await repo.setActive({ brand, id, is_active });
  if (!c) throw new NotFoundError("Coupon");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: is_active
      ? "retention.coupon.activate"
      : "retention.coupon.deactivate",
    target_type: "coupon",
    target_id: id,
    request_id,
  });
  return c;
}

// ── Validation + discount computation ─────────────────────
/**
 * Compute the NGN discount a coupon yields for a subtotal. Returns a Decimal.
 */
function computeDiscount(coupon, subtotalNgn) {
  const sub = money(subtotalNgn);
  if (coupon.discount_type === "percentage") {
    let d = sub.times(money(coupon.discount_value));
    if (
      coupon.max_discount_value !== null &&
      coupon.max_discount_value !== undefined
    ) {
      const cap = money(coupon.max_discount_value);
      if (d.gt(cap)) d = cap;
    }
    return d;
  }
  if (coupon.discount_type === "fixed_amount") {
    const d = money(coupon.discount_value);
    return d.gt(sub) ? sub : d; // never discount more than the subtotal
  }
  // free_shipping / buy_x_get_y: no line discount here (handled by the caller).
  return money(0);
}

async function firstTimeOk({ brand, contact_id }) {
  if (!contact_id) return true;
  const { rows } = await query(
    `SELECT count(*)::int AS c FROM ${brand}.sales_orders
      WHERE contact_id = $1 AND status IN ('paid','awaiting_dispatch','completed')`,
    [contact_id],
  );
  return rows[0].c === 0;
}

/**
 * Validate a coupon for a prospective order. Read-only.
 * @returns {{ valid:boolean, reason?:string, coupon?:object, discount_ngn?:string, discount_type?:string }}
 */
async function validateCoupon({
  brand,
  code,
  contact_id,
  order_subtotal_ngn,
  client,
}) {
  const coupon = client
    ? await repo.lockByCode({ client, brand, code })
    : await repo.getByCode({ brand, code });
  if (!coupon) return { valid: false, reason: "NOT_FOUND" };
  if (!coupon.is_active) return { valid: false, reason: "INACTIVE" };

  const now = Date.now();
  if (coupon.valid_from && new Date(coupon.valid_from).getTime() > now)
    return { valid: false, reason: "NOT_YET_VALID" };
  if (coupon.valid_to && new Date(coupon.valid_to).getTime() < now)
    return { valid: false, reason: "EXPIRED" };

  const sub = money(order_subtotal_ngn || 0);
  if (
    coupon.min_order_value !== null &&
    coupon.min_order_value !== undefined &&
    sub.lt(money(coupon.min_order_value))
  )
    return { valid: false, reason: "BELOW_MIN_ORDER" };

  if (
    coupon.total_usage_limit !== null &&
    coupon.total_usage_limit !== undefined &&
    coupon.total_redeemed >= coupon.total_usage_limit
  )
    return { valid: false, reason: "USAGE_LIMIT_REACHED" };

  if (contact_id) {
    const used = await repo.countCustomerRedemptions({
      client,
      coupon_id: coupon.coupon_id,
      contact_id,
    });
    if (used >= (coupon.per_customer_limit || 1))
      return { valid: false, reason: "PER_CUSTOMER_LIMIT" };
  }

  if (coupon.first_time_only && !(await firstTimeOk({ brand, contact_id })))
    return { valid: false, reason: "NOT_FIRST_TIME" };

  const discount = computeDiscount(coupon, sub);
  return {
    valid: true,
    coupon,
    discount_ngn: toCurrencyString(discount),
    discount_type: coupon.discount_type,
  };
}

/**
 * Redeem a coupon against a confirmed order. Transactional + row-locked +
 * idempotent on (coupon, reference_type, reference_id).
 */
async function redeemCoupon({
  brand,
  code,
  contact_id,
  reference_type,
  reference_id,
  order_subtotal_ngn,
  redeemed_ip,
  display_currency,
}) {
  return transaction(async (client) => {
    const result = await validateCoupon({
      brand,
      code,
      contact_id,
      order_subtotal_ngn,
      client,
    });
    if (!result.valid)
      throw new AppError(
        "COUPON_INVALID",
        `Coupon not applicable: ${result.reason}`,
        409,
      );

    // Idempotency: one redemption per order.
    if (
      await repo.redemptionExists({
        client,
        coupon_id: result.coupon.coupon_id,
        reference_type,
        reference_id,
      })
    ) {
      return { discount_ngn: result.discount_ngn, duplicate: true };
    }

    const redemption = await repo.recordRedemption({
      client,
      redemption: {
        coupon_id: result.coupon.coupon_id,
        contact_id,
        business: brand,
        reference_type,
        reference_id,
        discount_applied: result.discount_ngn,
        display_currency: display_currency || null,
        redeemed_ip: redeemed_ip || null,
      },
    });
    await repo.bumpUsage({
      client,
      coupon_id: result.coupon.coupon_id,
      discount_ngn: result.discount_ngn,
    });
    return { discount_ngn: result.discount_ngn, redemption, duplicate: false };
  });
}

module.exports = {
  createCoupon,
  listCoupons,
  getCoupon,
  updateCoupon,
  setCouponActive,
  validateCoupon,
  redeemCoupon,
};
