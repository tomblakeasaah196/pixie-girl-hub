/**
 * Sales Campaigns v2 — PRICING ENGINE (scoped to campaigns).
 *
 * Implements the V2.2 §6.25 Pricing-Engine spec adjacent to the campaign
 * builder: goal-seek margin → price, charm rounding, the quantity-tier
 * ladder, and the escalating cart upsell ladder Faith asked for. Hard
 * floor enforcement runs at every layer — the engine REFUSES to return
 * a number below `pricing_floors.min_price` (or category default).
 *
 * Pure given inputs: cost vault row + freight + fee schedule + target
 * margin → price. Callers do the I/O. The /praxis/suggest-pricing
 * endpoint composes this engine with the LLM (campaigns.praxis.service)
 * so Praxis NEVER finalises a number that breaches the floor.
 */

"use strict";

const Decimal = require("decimal.js");

const { AppError } = require("../../utils/errors");

const PRECISION = 4;
Decimal.set({ precision: 24, rounding: Decimal.ROUND_HALF_UP });

function d(value) {
  if (value === null || value === undefined || value === "") return new Decimal(0);
  return new Decimal(value);
}

function toStr(value, places = 2) {
  return d(value).toFixed(places);
}

// ── Goal-seek margin → price ─────────────────────────────
/**
 * Solve for the published price that yields a target net margin.
 *
 *   net_margin = (price − cost − freight − gateway_fee_grossup) / price
 *   ⇒ price   = (cost + freight) / (1 − target_margin − fee_pct)
 *
 * Then add a discount-loss assumption (so the price after the campaign
 * discount still hits the target). Clamp to floor.
 */
function goalSeekPrice({
  cost_ngn,
  freight_ngn = 0,
  target_margin_pct,
  discount_loss_pct = 0,
  gateway_fee_pct = 0,
  gateway_fee_fixed = 0,
  floor_ngn = null,
} = {}) {
  const cost = d(cost_ngn);
  const freight = d(freight_ngn);
  const target = d(target_margin_pct);
  const lossPct = d(discount_loss_pct);
  const feePct = d(gateway_fee_pct);
  const feeFixed = d(gateway_fee_fixed);

  if (target.gte(1)) {
    throw new AppError(
      "INVALID_MARGIN",
      "target_margin_pct must be < 1.0 (i.e. < 100%)",
      400,
    );
  }
  if (target.add(feePct).gte(1)) {
    throw new AppError(
      "INFEASIBLE_PRICING",
      "target margin + gateway fee % exceeds 100% — no price can satisfy this",
      400,
    );
  }

  const denom = d(1).minus(target).minus(feePct);
  const numerator = cost.plus(freight).plus(feeFixed);
  let price = numerator.div(denom);

  // After-discount price ≈ price × (1 − loss_pct). The target margin should
  // hold AFTER the discount, so divide back up.
  if (lossPct.gt(0) && lossPct.lt(1)) {
    price = price.div(d(1).minus(lossPct));
  }

  if (floor_ngn !== null && floor_ngn !== undefined) {
    const floor = d(floor_ngn);
    if (price.lt(floor)) price = floor;
  }

  return price.toFixed(PRECISION);
}

// ── Charm rounding ───────────────────────────────────────
/**
 * Round a price to a "charm" ending (₦149,000 / ₦147,990 / round up to
 * nearest 1k). Always rechecks the floor.
 *
 * @param {object} args
 * @param {string|number} args.price_ngn
 * @param {"thousand_up"|"k_minus_one"|"nine_ninety"|"round_50"} args.strategy
 * @param {string|number} [args.floor_ngn]
 */
function charmRound({ price_ngn, strategy = "thousand_up", floor_ngn = null }) {
  const price = d(price_ngn);
  let rounded;

  switch (strategy) {
    case "thousand_up": {
      // Round UP to nearest 1,000.
      rounded = price.div(1000).ceil().times(1000);
      break;
    }
    case "k_minus_one": {
      // ₦149,000 → ₦148,990 (round to thousand minus 10).
      rounded = price.div(1000).ceil().times(1000).minus(10);
      break;
    }
    case "nine_ninety": {
      // Round UP to next thousand minus 10 (e.g. ₦147,990, ₦148,990).
      rounded = price.div(1000).floor().plus(1).times(1000).minus(10);
      break;
    }
    case "round_50": {
      rounded = price.div(50).round().times(50);
      break;
    }
    default:
      throw new AppError("UNKNOWN_STRATEGY", `Unknown rounding strategy '${strategy}'`, 400);
  }

  let belowFloor = false;
  if (floor_ngn !== null && floor_ngn !== undefined) {
    const floor = d(floor_ngn);
    if (rounded.lt(floor)) {
      belowFloor = true;
      rounded = floor;
    }
  }

  return { rounded_ngn: rounded.toFixed(2), below_floor: belowFloor };
}

// ── Quantity-tier ladder reconciliation ──────────────────
/**
 * Given a cart and the campaign's tier ladder, return:
 *   - selected_tier        (the tier the cart currently qualifies for, if any)
 *   - next_tier            (the tier the customer would reach by adding 1 more)
 *   - applied_discount_ngn (the ₦ saving currently applied)
 *
 * Tier rule: pick the highest tier whose min_quantity ≤ cart.total_quantity.
 * Fixed-₦ amounts (not percent). Reads tiers in DESC order of min_quantity.
 *
 * Floor enforcement: tiers must respect each line's floor — the caller
 * (cart engine) clamps and propagates `clamped: true` if so.
 */
function applyQuantityTier({ cart, tiers }) {
  const totalQty = cart.items.reduce((a, it) => a + Number(it.quantity || 0), 0);
  const sorted = [...tiers].sort((a, b) => b.min_quantity - a.min_quantity);

  let selected = null;
  for (const tier of sorted) {
    if (totalQty >= tier.min_quantity) {
      selected = tier;
      break;
    }
  }
  const upcoming = sorted
    .slice()
    .sort((a, b) => a.min_quantity - b.min_quantity)
    .find((t) => t.min_quantity > totalQty);

  return {
    cart_total_quantity: totalQty,
    selected_tier: selected,
    next_tier: upcoming || null,
    applied_discount_ngn: selected ? d(selected.fixed_discount_ngn).toFixed(2) : "0.00",
  };
}

// ── Cart upsell ladder ───────────────────────────────────
/**
 * Pick the NEXT rung the customer hasn't yet been offered. The caller
 * passes the list of upsell rungs (rows of sales_campaign_cart_upsells)
 * and the set of upsell_ids already shown in this cart session.
 *
 * Returns the highest-priority unmet rung, or null if no rung applies.
 */
function pickNextCartUpsell({ cart, upsells, shown_ids = new Set() }) {
  const totalQty = cart.items.reduce((a, it) => a + Number(it.quantity || 0), 0);
  const totalValue = cart.items.reduce(
    (a, it) => a.plus(d(it.unit_price_ngn).times(it.quantity || 0)),
    new Decimal(0),
  );

  const candidates = upsells
    .filter((u) => u.is_active !== false && !shown_ids.has(u.upsell_id))
    .sort((a, b) => a.rung - b.rung);

  for (const c of candidates) {
    if (c.trigger_type === "cart_qty" && c.min_cart_qty !== null && c.min_cart_qty !== undefined) {
      if (totalQty >= c.min_cart_qty) return c;
    } else if (c.trigger_type === "cart_value" && c.min_cart_value_ngn !== null && c.min_cart_value_ngn !== undefined) {
      if (totalValue.gte(d(c.min_cart_value_ngn))) return c;
    } else if (c.trigger_type === "specific_bundle" && c.trigger_bundle_id) {
      const hasBundle = cart.items.some((it) => it.bundle_id === c.trigger_bundle_id);
      if (hasBundle) return c;
    }
  }
  return null;
}

// ── Pre-order pricing ────────────────────────────────────
/**
 * Faith's spec:
 *   preorder_price = sale_price + (regular_price − sale_price) × discount_loss_pct
 */
function computePreorderPrice({
  regular_price_ngn,
  sale_price_ngn,
  discount_loss_pct = 0.7,
  floor_ngn = null,
}) {
  const regular = d(regular_price_ngn);
  const sale = d(sale_price_ngn);
  const loss = d(discount_loss_pct);
  const lost = regular.minus(sale).times(loss);
  let preorder = sale.plus(lost);
  let belowFloor = false;
  if (floor_ngn !== null && floor_ngn !== undefined) {
    const floor = d(floor_ngn);
    if (preorder.lt(floor)) {
      belowFloor = true;
      preorder = floor;
    }
  }
  return { preorder_price_ngn: preorder.toFixed(2), below_floor: belowFloor };
}

// ── Validation helper for Praxis-suggested numbers ───────
/**
 * Throws AppError if any of the suggested prices breaches its floor.
 * Used by the praxis service before recording any draft.
 */
function assertAboveFloor(items) {
  const breaches = items.filter(
    (it) =>
      it.floor_ngn !== null &&
      it.floor_ngn !== undefined &&
      d(it.proposed_price_ngn).lt(d(it.floor_ngn)),
  );
  if (breaches.length) {
    throw new AppError(
      "BELOW_PRICE_FLOOR",
      "One or more proposed prices fall below the configured pricing floor",
      409,
      { breaches },
    );
  }
}

module.exports = {
  goalSeekPrice,
  charmRound,
  applyQuantityTier,
  pickNextCartUpsell,
  computePreorderPrice,
  assertAboveFloor,
  toStr,
};
