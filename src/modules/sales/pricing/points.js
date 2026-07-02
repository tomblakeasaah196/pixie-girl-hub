/**
 * Sales pricing — loyalty points redemption maths (§6.23.3).
 *
 * Pure: "Apply points as a discount at checkout (e.g., 100 points = ₦1,000
 * off). The conversion rate is configurable." Converts the requested points
 * at naira_per_point and shrinks the redemption to fit the remaining
 * margin-floor headroom — only the points actually applied are deducted.
 *
 * Balance sufficiency is the caller's check (it needs the loyalty state row
 * and throws INSUFFICIENT_POINTS).
 */

"use strict";

const { money } = require("../../../utils/money");

/**
 * @param {object} args
 * @param {number} args.points              Whole points the buyer asked to redeem (>0).
 * @param {string|number} args.nairaPerPoint  loyalty_settings.naira_per_point (default ₦10).
 * @param {import('decimal.js').Decimal} args.headroomAvailable  Remaining floor headroom.
 * @returns {{ usePts: number, value: import('decimal.js').Decimal }}
 *   Points to deduct and their ₦ value; usePts is 0 when nothing fits.
 */
function computePointsRedemption({ points, nairaPerPoint, headroomAvailable }) {
  const rate = money(nairaPerPoint || 10);
  let usePts = points;
  let value = rate.times(usePts);
  if (value.gt(headroomAvailable) && rate.gt(money(0))) {
    usePts = Math.floor(Number(headroomAvailable.dividedBy(rate).toString()));
    value = rate.times(usePts);
  }
  return { usePts, value };
}

module.exports = { computePointsRedemption };
