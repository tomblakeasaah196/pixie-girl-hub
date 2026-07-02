/**
 * Sales pricing — order-level discount allocator (§6.25 margin floor).
 *
 * Pure state machine over the built line array. Owns the three per-line
 * ledgers the order-level discount stages share:
 *
 *   preNetByIdx     line value after the per-unit campaign discount, pre-VAT
 *   headroomByIdx   how far each line may still be discounted before hitting
 *                   the variant's min_price floor (consumed as stages apply)
 *   extraShareByIdx the order-level discount allocated to each line so far
 *                   (feeds the per-line discount + tax base in totals.js)
 *
 * Two allocation modes, matching the two owner policies:
 *   - applyOrderDiscount:      floor-RESPECTING (coupon, points, bundle) —
 *     allocates proportionally to remaining headroom, so a stacked discount
 *     can never sell a line below its min_price.
 *   - applyFloorFreeDiscount:  floor-IGNORING (campaign deal ladder — owner
 *     decision, CONFORMANCE_GAPS G-1) — allocates against each line's full
 *     remaining net value down to ₦0, because the buyer already saw a
 *     floor-free quote and the charge must match it.
 *
 * Both use largest-remainder rounding: proportional shares are rounded to
 * 2dp and the LAST line absorbs the rounding remainder, so the allocated
 * total always equals the applied amount exactly.
 */

"use strict";

const { money, toCurrencyString } = require("../../../utils/money");

/**
 * @param {Array<{unit: import('decimal.js').Decimal,
 *                perUnitDiscount: import('decimal.js').Decimal,
 *                li: {quantity: number},
 *                ctx: {min_price_ngn?: string|number|null}}>} built
 *   Line array AFTER the margin-floor clamp (margin-floor.js) — preNet is
 *   computed from the clamped per-unit discounts.
 */
function createDiscountAllocator(built) {
  const preNetByIdx = built.map((b) =>
    b.unit.minus(b.perUnitDiscount).times(b.li.quantity),
  );
  const preNet = preNetByIdx.reduce((a, n) => a.plus(n), money(0));

  // §6.25 floor: each line's headroom above its variant min_price. Order-
  // level discounts (coupon, points) may only consume this headroom, so a
  // stacked discount can never sell below floor. Mutated as each is applied.
  const headroomByIdx = built.map((b, idx) => {
    if (b.ctx.min_price_ngn === null || b.ctx.min_price_ngn === undefined)
      return preNetByIdx[idx];
    const floorNet = money(b.ctx.min_price_ngn).times(b.li.quantity);
    const hr = preNetByIdx[idx].minus(floorNet);
    return hr.lt(0) ? money(0) : hr;
  });

  // Combined order-level discount added to each line's discount.
  const extraShareByIdx = built.map(() => money(0));

  const headroomLeft = () =>
    headroomByIdx.reduce((a, n) => a.plus(n), money(0));

  // Apply an order-level discount proportionally to remaining headroom; pre-
  // VAT (totals.js taxes the post-discount base). Returns the amount
  // actually applied (capped at available headroom).
  const applyOrderDiscount = (requested) => {
    const avail = headroomLeft();
    const amt = requested.gt(avail) ? avail : requested;
    if (amt.lte(money(0))) return money(0);
    let allocated = money(0);
    built.forEach((b, idx) => {
      const last = idx === built.length - 1;
      const share = last
        ? amt.minus(allocated)
        : avail.gt(money(0))
          ? money(
              toCurrencyString(amt.times(headroomByIdx[idx]).dividedBy(avail)),
            )
          : money(0);
      extraShareByIdx[idx] = extraShareByIdx[idx].plus(share);
      headroomByIdx[idx] = headroomByIdx[idx].minus(share);
      allocated = allocated.plus(share);
    });
    return amt;
  };

  // Floor-IGNORING allocation (campaign deal ladder). Remaining net per line
  // = full line value minus whatever the floor-respecting discounts already
  // removed. May consume all of it, down to ₦0 (never negative). Does NOT
  // touch headroomByIdx — nothing floor-respecting runs after it.
  const applyFloorFreeDiscount = (requested) => {
    const netByIdx = built.map((b, idx) => {
      const net = preNetByIdx[idx].minus(extraShareByIdx[idx]);
      return net.lt(money(0)) ? money(0) : net;
    });
    const availNet = netByIdx.reduce((a, n) => a.plus(n), money(0));
    const amt = requested.gt(availNet) ? availNet : requested;
    if (amt.lte(money(0))) return money(0);
    let allocated = money(0);
    built.forEach((b, idx) => {
      const last = idx === built.length - 1;
      const share = last
        ? amt.minus(allocated)
        : availNet.gt(money(0))
          ? money(toCurrencyString(amt.times(netByIdx[idx]).dividedBy(availNet)))
          : money(0);
      extraShareByIdx[idx] = extraShareByIdx[idx].plus(share);
      allocated = allocated.plus(share);
    });
    return amt;
  };

  return {
    preNet,
    preNetByIdx,
    extraShareByIdx,
    headroomLeft,
    applyOrderDiscount,
    applyFloorFreeDiscount,
  };
}

module.exports = { createDiscountAllocator };
