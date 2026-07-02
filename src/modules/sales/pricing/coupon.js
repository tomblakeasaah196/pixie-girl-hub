/**
 * Sales pricing — coupon application decision (F-3 / §6.23 / §6.25).
 *
 * Pure: given a validated coupon and the campaign context, decide HOW the
 * coupon applies. The caller performs the actual allocation (the allocator
 * owns the mutable per-line state) and persistence.
 *
 * Decision kinds:
 *   free_shipping  shipping is zeroed; item pricing untouched
 *   apply          allocate `requested` via the floor-respecting allocator
 *                  (stacking allowed, or no campaign discount in play)
 *   top_up         non-stacking sale where the coupon beats the sale — apply
 *                  only the difference so the total discount equals the
 *                  coupon value (with a buyer-facing notice)
 *   keep_sale      non-stacking sale where the sale already beats the coupon
 *                  — drop the coupon, record no redemption (with a notice)
 */

"use strict";

const { money } = require("../../../utils/money");

/**
 * @param {object} args
 * @param {{discount_type: string, discount_ngn?: string|number}} args.coupon
 *   The validated coupon result (couponService.validateCoupon().coupon + amounts).
 * @param {string|number} args.discount_ngn  Coupon value from validation.
 * @param {boolean} args.campaignActive      A campaign discount is in play.
 * @param {boolean} args.allowStacking       CEO setting: discounts may stack
 *                                           on already-discounted sale items.
 * @param {import('decimal.js').Decimal} args.campaignDiscountTotal
 * @param {import('decimal.js').Decimal} args.preNet
 */
function resolveCouponApplication({
  coupon,
  discount_ngn,
  campaignActive,
  allowStacking,
  campaignDiscountTotal: saleDiscountTotal,
  preNet,
}) {
  if (coupon.discount_type === "free_shipping") {
    // Free-shipping is orthogonal to item pricing — always honour it.
    return { kind: "free_shipping" };
  }

  if (campaignActive && !allowStacking) {
    // Non-stacking sale: never hard-block the buyer. Give them the BETTER
    // of (sale price already applied) vs (coupon), and tell them softly.
    let want = money(discount_ngn);
    if (want.gt(preNet)) want = preNet;
    if (want.gt(saleDiscountTotal)) {
      // Coupon beats the sale — top up by the difference so the total
      // discount equals the coupon value (floor-respecting via headroom).
      return {
        kind: "top_up",
        requested: want.minus(saleDiscountTotal),
        notice: {
          code: "COUPON_APPLIED_BEST",
          message:
            "We applied your coupon — it's a better deal than the sale price.",
        },
      };
    }
    // Sale is the better deal — drop the coupon (no redemption recorded).
    return {
      kind: "keep_sale",
      notice: {
        code: "SALE_PRICE_KEPT",
        message:
          "Your coupon wasn't applied because the sale price is already a bigger saving.",
      },
    };
  }

  let amt = money(discount_ngn);
  if (amt.gt(preNet)) amt = preNet;
  return { kind: "apply", requested: amt };
}

/** Total per-line campaign discount currently applied (pre order-level). */
function campaignDiscountTotal(built) {
  return built.reduce(
    (s, b) => s.plus(b.perUnitDiscount.times(b.li.quantity)),
    money(0),
  );
}

module.exports = { resolveCouponApplication, campaignDiscountTotal };
