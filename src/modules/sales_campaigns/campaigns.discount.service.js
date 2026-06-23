/**
 * Sales Campaigns — DISCOUNT ENGINE (V2.2 §6.22 + §6.23 + §6.25).
 *
 * Single source of truth for campaign pricing. POS, storefront checkout
 * and the public order form all call `resolveDiscount()` — the discount is
 * NEVER trusted from the client.
 *
 * Stacking rule (locked, per pd §6.23):
 *   - Stacking is CEO-configurable (business_config.allow_discount_stacking).
 *     When OFF, the campaign discount is mutually exclusive with
 *     coupon/loyalty on sale items (caller applies the single best).
 *   - The Pricing-engine minimum-margin floor (§6.25) is a HARD cap no
 *     combination may breach: the engine clamps each line up to its floor.
 *     This runs regardless of the stacking toggle.
 *   - Coupons remain usable; loyalty points are still earned (handled by
 *     retention on the resulting order).
 *
 * The engine is pure given its inputs (no checkout-module coupling): the
 * caller supplies the cart, the contact's eligibility flags, the stacking
 * toggle, any already-applied discount per line, and a margin-floor lookup.
 */

"use strict";

const repo = require("./campaigns.repo");
const main = require("./campaigns.service");
const { money, toCurrencyString } = require("../../utils/money");
const { AppError } = require("../../utils/errors");

/**
 * @param {object} args
 * @param {string} args.brand
 * @param {object} args.campaignRef        full campaign row OR { campaign_id } OR { slug }
 * @param {object} args.cart               { items: [{ product_id, category_id?, unit_price_ngn, quantity }] }
 * @param {object} [args.contact]          { contact_id, is_first_time?, segment_ids?: [] }
 * @param {boolean} [args.allowStacking]   from business_config (default false)
 * @param {object} [args.alreadyAppliedNgnByProduct] per-product discount already applied (for floor math)
 * @param {(item) => Promise<number|string|null>} [args.getMarginFloor]  per-unit NGN floor; null = no floor
 * @returns {Promise<DiscountResult>}
 */
async function resolveDiscount({
  brand,
  campaignRef,
  cart,
  contact = {},
  allowStacking = false,
  alreadyAppliedNgnByProduct = {},
  getMarginFloor = null,
}) {
  const campaign = await loadCampaign(brand, campaignRef);
  const items = (cart && cart.items) || [];

  const notEligible = (reason) => ({
    eligible: false,
    reason,
    campaign_id: campaign && campaign.campaign_id,
    slug: campaign && campaign.slug,
    lines: [],
    total_discount_ngn: "0.00",
    clamped: false,
    mutually_exclusive: !allowStacking,
  });

  if (!campaign) return notEligible("campaign_not_found");
  if (main.resolveState(campaign) !== "live") return notEligible("not_live");

  // ── Eligibility ──────────────────────────────────────────
  const subtotal = items.reduce(
    (acc, it) => acc.plus(money(it.unit_price_ngn).times(it.quantity)),
    money(0),
  );
  if (
    campaign.min_order_value_ngn !== null &&
    campaign.min_order_value_ngn !== undefined &&
    subtotal.lt(money(campaign.min_order_value_ngn))
  ) {
    return notEligible("below_min_order_value");
  }
  if (campaign.first_time_buyers_only && !contact.is_first_time) {
    return notEligible("not_first_time_buyer");
  }
  if (
    campaign.customer_segment_id &&
    !(contact.segment_ids || []).includes(campaign.customer_segment_id)
  ) {
    return notEligible("not_in_segment");
  }
  if (
    campaign.total_usage_limit !== null &&
    campaign.total_usage_limit !== undefined &&
    campaign.total_usage_count >= campaign.total_usage_limit
  ) {
    return notEligible("usage_limit_reached");
  }

  // ── Scope: which items the campaign applies to ───────────
  const links = await repo.listProducts({
    brand,
    campaign_id: campaign.campaign_id,
  });
  const includedProducts = new Set();
  const includedCategories = new Set();
  const excludedProducts = new Set();
  const excludedCategories = new Set();
  const priceOverride = new Map(); // product_id → campaign_price_ngn
  for (const l of links) {
    if (l.include_exclude === "include") {
      if (l.product_id) includedProducts.add(l.product_id);
      if (l.category_id) includedCategories.add(l.category_id);
      if (
        l.product_id &&
        l.campaign_price_ngn !== null &&
        l.campaign_price_ngn !== undefined
      )
        priceOverride.set(l.product_id, l.campaign_price_ngn);
    } else {
      if (l.product_id) excludedProducts.add(l.product_id);
      if (l.category_id) excludedCategories.add(l.category_id);
    }
  }

  const inScope = (it) => {
    if (it.product_id && excludedProducts.has(it.product_id)) return false;
    if (it.category_id && excludedCategories.has(it.category_id)) return false;
    if (campaign.product_scope === "all") return true;
    if (campaign.product_scope === "specific_products") {
      return (
        (it.product_id && includedProducts.has(it.product_id)) ||
        (it.category_id && includedCategories.has(it.category_id))
      );
    }
    if (campaign.product_scope === "specific_categories") {
      return it.category_id && includedCategories.has(it.category_id);
    }
    return false;
  };

  const scopedItems = items.filter(inScope);
  if (scopedItems.length === 0 && campaign.discount_type !== "free_shipping") {
    return notEligible("no_eligible_items");
  }

  // ── Compute raw per-line discount ────────────────────────
  const scopedSubtotal = scopedItems.reduce(
    (acc, it) => acc.plus(money(it.unit_price_ngn).times(it.quantity)),
    money(0),
  );

  let free_shipping = false;
  const lines = [];

  for (const it of scopedItems) {
    const unit = money(it.unit_price_ngn);
    let perUnitDiscount = money(0);

    // discount_value is now optional (a campaign can be a pure landing/preorder
    // shell — migration 000050). A percentage/fixed type with a NULL value used
    // to throw inside money() and surface as INTERNAL_ERROR at checkout; treat a
    // missing value as "no top-level discount" instead.
    const hasDiscountValue =
      campaign.discount_value !== null &&
      campaign.discount_value !== undefined;

    if (priceOverride.has(it.product_id)) {
      const override = money(priceOverride.get(it.product_id));
      perUnitDiscount = unit.minus(override);
    } else if (!hasDiscountValue) {
      perUnitDiscount = money(0);
    } else {
      switch (campaign.discount_type) {
        case "percentage":
          perUnitDiscount = unit.times(money(campaign.discount_value));
          break;
        case "fixed_amount": {
          // Distribute a single fixed amount across the scoped subtotal,
          // proportional to each line's contribution.
          const fixed = money(campaign.discount_value);
          const cappedFixed = fixed.gt(scopedSubtotal) ? scopedSubtotal : fixed;
          const lineTotal = unit.times(it.quantity);
          const share = scopedSubtotal.gt(0)
            ? lineTotal.dividedBy(scopedSubtotal)
            : money(0);
          perUnitDiscount = cappedFixed
            .times(share)
            .dividedBy(it.quantity || 1);
          break;
        }
        case "free_shipping":
          free_shipping = true;
          perUnitDiscount = money(0);
          break;
        case "buy_x_get_y":
        case "bundle":
          // V1: driven by per-product campaign_price_ngn overrides only.
          perUnitDiscount = money(0);
          break;
        default:
          perUnitDiscount = money(0);
      }
    }

    if (perUnitDiscount.lt(0)) perUnitDiscount = money(0);
    lines.push({
      product_id: it.product_id || null,
      category_id: it.category_id || null,
      quantity: it.quantity,
      unit_price_ngn: toCurrencyString(unit),
      _unit: unit,
      _perUnitDiscount: perUnitDiscount,
    });
  }

  // ── Margin-floor clamp (hard cap; runs regardless of stacking) ──
  let clamped = false;
  for (const line of lines) {
    let perUnit = line._perUnitDiscount;
    if (getMarginFloor) {
      const floorRaw = await getMarginFloor({
        product_id: line.product_id,
        category_id: line.category_id,
      });
      if (floorRaw !== null && floorRaw !== undefined) {
        const floor = money(floorRaw);
        // Account for any discount already applied (coupon/loyalty) so the
        // COMBINED price never dips below floor.
        const alreadyPerUnit = money(
          alreadyAppliedNgnByProduct[line.product_id] || 0,
        );
        const maxTotalDiscount = line._unit.minus(floor);
        const allowedCampaign = maxTotalDiscount.minus(alreadyPerUnit);
        if (perUnit.gt(allowedCampaign)) {
          perUnit = allowedCampaign.lt(0) ? money(0) : allowedCampaign;
          clamped = true;
        }
      }
    }
    line._perUnitDiscount = perUnit;
  }

  // ── Finalise ─────────────────────────────────────────────
  let total = money(0);
  for (const line of lines) {
    const lineDiscount = line._perUnitDiscount.times(line.quantity);
    total = total.plus(lineDiscount);
    line.line_discount_ngn = toCurrencyString(lineDiscount);
    line.discounted_unit_price_ngn = toCurrencyString(
      line._unit.minus(line._perUnitDiscount),
    );
    delete line._unit;
    delete line._perUnitDiscount;
  }

  return {
    eligible: true,
    reason: null,
    campaign_id: campaign.campaign_id,
    slug: campaign.slug,
    discount_type: campaign.discount_type,
    free_shipping,
    lines,
    total_discount_ngn: toCurrencyString(total),
    clamped,
    mutually_exclusive: !allowStacking,
  };
}

async function loadCampaign(brand, ref) {
  if (!ref) return null;
  if (ref.campaign_id && ref.status) return ref; // already a full row
  if (ref.campaign_id) return repo.findById({ brand, id: ref.campaign_id });
  if (ref.slug) return repo.findBySlug({ brand, slug: ref.slug });
  return null;
}

/**
 * Record a completed campaign order against the rollups + usage cap.
 * Call from the checkout/order service inside its order transaction.
 */
async function recordUsage({
  client,
  brand,
  campaign_id,
  revenue_ngn,
  discount_ngn,
}) {
  if (!campaign_id) return;
  await repo.incrementCounters({
    client,
    brand,
    id: campaign_id,
    deltas: {
      total_usage_count: 1,
      total_orders: 1,
      total_revenue_ngn: Number(toCurrencyString(revenue_ngn || 0)),
      total_discount_given_ngn: Number(toCurrencyString(discount_ngn || 0)),
    },
  });
}

module.exports = { resolveDiscount, recordUsage };

// Keep AppError referenced for future strict-mode eligibility errors.
void AppError;
