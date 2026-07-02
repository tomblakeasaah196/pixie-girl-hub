/**
 * Weighted-average variant costing (ratified accounting policy Q9).
 *
 * Pure functions only. The service layer locks the variant_costing row
 * (FOR UPDATE), applies the movement through applyMovementToCosting, and
 * persists the result inside the SAME transaction as the stock movement —
 * so the average can never drift from the movement ledger, and two
 * concurrent receipts serialise on the row lock.
 *
 * Rules:
 *   - reserve / release_reserve are soft locks, transfers are internal
 *     location moves: none of them change the variant-level quantity or
 *     cost, so they are exempt.
 *   - Inflows WITH a unit cost reweight the average:
 *       new_avg = (qty·avg + in_qty·cost) / (qty + in_qty)
 *   - Inflows WITHOUT a cost (found stock, customer returns) enter at the
 *     current average — quantity rises, average unchanged.
 *   - Outflows relieve at the current average — average unchanged.
 *   - Quantity is clamped at zero so movements that predate costing
 *     cannot drive the weight negative; the next costed receipt then
 *     restarts the average from its own unit cost.
 */

"use strict";

const { money } = require("../../utils/money");

const COSTING_EXEMPT = new Set([
  "reserve",
  "release_reserve",
  "transfer_in",
  "transfer_out",
]);

/** True when the movement type has no variant-level costing effect. */
function isCostingExempt(movement_type) {
  return COSTING_EXEMPT.has(movement_type);
}

const qty2 = (d) => d.toDecimalPlaces(2).toFixed(2);
const cost4 = (d) => d.toDecimalPlaces(4).toFixed(4);

function hasCost(value) {
  return value !== null && value !== undefined && String(value) !== "";
}

/**
 * Apply one stock movement to the variant's costing state.
 *
 * @param {{qty_tracked?: string|number, avg_cost_ngn?: string|number}|null} current
 * @param {{movement_type: string, quantity: number, unit_cost_ngn?: string|number|null}} movement
 * @returns {{qty_tracked: string, avg_cost_ngn: string}|null} new state, or
 *          null when the movement is costing-exempt.
 */
function applyMovementToCosting(current, movement) {
  if (isCostingExempt(movement.movement_type)) return null;

  const qty0 = money(current?.qty_tracked ?? 0);
  const avg0 = money(current?.avg_cost_ngn ?? 0);
  const delta = money(movement.quantity);

  if (delta.gt(0)) {
    // Negative/zero history means the weight is meaningless — restart it.
    const base = qty0.gt(0) ? qty0 : money(0);
    const newQty = base.plus(delta);
    if (!hasCost(movement.unit_cost_ngn)) {
      return { qty_tracked: qty2(newQty), avg_cost_ngn: cost4(avg0) };
    }
    const cost = money(movement.unit_cost_ngn);
    const newAvg = base.gt(0)
      ? base.times(avg0).plus(delta.times(cost)).div(newQty)
      : cost;
    return { qty_tracked: qty2(newQty), avg_cost_ngn: cost4(newAvg) };
  }

  // Outflow: relieve at the current average, clamp the weight at zero.
  const newQty = qty0.plus(delta);
  return {
    qty_tracked: qty2(newQty.lt(0) ? money(0) : newQty),
    avg_cost_ngn: cost4(avg0),
  };
}

module.exports = { isCostingExempt, applyMovementToCosting };
