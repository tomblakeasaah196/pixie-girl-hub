/**
 * Sales pricing — per-unit margin-floor clamp (§6.25).
 *
 * Pure, mutating stage: caps each line's per-unit campaign discount so the
 * discounted unit price never drops below the variant's min_price. Lines
 * without a floor (services, floor-less variants) pass through untouched.
 * Runs BEFORE the allocator is created (preNet uses the clamped values).
 */

"use strict";

const { money } = require("../../../utils/money");

function clampToMarginFloor(built) {
  for (const b of built) {
    if (b.ctx.min_price_ngn !== null && b.ctx.min_price_ngn !== undefined) {
      const floor = money(b.ctx.min_price_ngn);
      const maxDiscount = b.unit.minus(floor);
      if (b.perUnitDiscount.gt(maxDiscount))
        b.perUnitDiscount = maxDiscount.lt(0) ? money(0) : maxDiscount;
    }
  }
  return built;
}

module.exports = { clampToMarginFloor };
