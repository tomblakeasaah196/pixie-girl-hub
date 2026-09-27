/**
 * USD pricing engine — the ONE place a dollar figure for a sale is computed
 * (owner decision, Sept 2026: "product USD prices come from the catalogue").
 *
 * Every surface that shows or charges dollars — website cart + checkout,
 * campaign quote + checkout, pay links for Quick Sale / staff-switched orders —
 * runs the same rules, so what a buyer sees is what Nomba receives:
 *
 *   • A product sold at its catalogue price costs its CATALOGUE USD PRICE
 *     (the USD column "Apply USD exchange rate" or a manual edit wrote — e.g.
 *     $249.99, cents and all).
 *   • A product sold BELOW (or above) its list price — a campaign price, a
 *     staff override — keeps the same proportion in dollars:
 *     catalogue USD × (price charged ÷ catalogue ₦).
 *   • A product with no catalogue USD price converts its Naira price at the
 *     catalogue ₦/$ rate, rounded UP to a whole dollar (the owner's standing
 *     10.29 → $11 rule, and what the storefront already displays).
 *   • Order-level adjustments on the goods (deal/coupon discounts, points,
 *     VAT) scale at the goods' own dollar ratio, so "10% off" is 10% in USD.
 *   • Delivery converts at the catalogue rate, rounded up to a whole dollar.
 *
 * The result is locked on the order (display_total = the USD total,
 * fx_rate_used = total_ngn ÷ usd_total — the order's effective ₦ per $), so
 * pay links charge and the Nomba webhook credits against that one figure.
 *
 * The ₦/$ rate is the catalogue tool's usd_fx_rate (currency.service).
 */

"use strict";

const { query } = require("../config/database");
const { assertBrand } = require("../config/brands");
const currencyService = require("./currency.service");
const { money, toCurrencyString, Decimal } = require("../utils/money");

const positive = (v) =>
  v !== null && v !== undefined && v !== "" && Number(v) > 0;

/** The catalogue ₦/$ rate (NGN per $1) — the one rate for USD. Null if unset. */
async function catalogueRate(brand) {
  return currencyService.systemFxRate({ brand, currency: "USD" });
}

/**
 * USD unit price for one line (a Decimal), or null when it cannot be priced
 * (no catalogue USD price AND no rate). See the module header for the rules.
 *
 * @param {object} a
 * @param {number|string} a.unit_ngn       the Naira unit price actually charged
 * @param {number|string} [a.catalogue_ngn] the item's catalogue Naira price
 * @param {number|string} [a.catalogue_usd] the item's catalogue USD price
 * @param {number} [a.rate]                the catalogue ₦/$ rate
 */
function lineUsd({ unit_ngn, catalogue_ngn, catalogue_usd, rate }) {
  const ngn = money(unit_ngn || 0);
  if (ngn.lte(0)) return money(0);
  if (positive(catalogue_usd) && positive(catalogue_ngn)) {
    const listNgn = money(catalogue_ngn);
    const listUsd = money(catalogue_usd);
    if (ngn.eq(listNgn)) return listUsd;
    return listUsd
      .times(ngn)
      .dividedBy(listNgn)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
  if (!positive(rate)) return null;
  return ngn.dividedBy(money(rate)).ceil();
}

/**
 * The dollar figure for a whole order (or cart).
 *
 * @param {object} a
 * @param {Array<{unit_ngn, quantity, catalogue_ngn?, catalogue_usd?}>} a.lines
 *        goods lines at the Naira unit price charged, BEFORE order-level
 *        discounts
 * @param {number|string} a.total_ngn    the order total in Naira
 * @param {number|string} [a.delivery_ngn] the delivery fee inside total_ngn
 * @param {number} a.rate                the catalogue ₦/$ rate
 * @returns {null | {
 *   lines: Array<object>, goods_usd: string, adjustments_usd: string,
 *   delivery_usd: string, usd_total: string, fx_rate: string|null }}
 *   null when some line (or the delivery) cannot be priced without a rate.
 */
function orderUsd({ lines, total_ngn, delivery_ngn = 0, rate }) {
  let goodsUsd = money(0);
  let goodsNgn = money(0);
  const priced = [];
  for (const l of lines || []) {
    const qty = Number(l.quantity) || 1;
    const unit = lineUsd({ ...l, rate });
    if (unit === null) return null;
    goodsUsd = goodsUsd.plus(unit.times(qty));
    goodsNgn = goodsNgn.plus(money(l.unit_ngn || 0).times(qty));
    priced.push({ ...l, unit_price_usd: toCurrencyString(unit) });
  }

  const delivery = money(delivery_ngn || 0);
  let deliveryUsd = money(0);
  if (delivery.gt(0)) {
    if (!positive(rate)) return null;
    deliveryUsd = delivery.dividedBy(money(rate)).ceil();
  }

  // Whatever the total holds beyond goods + delivery (discounts < 0, VAT > 0)
  // scales at the goods' own $/₦ ratio; with no goods, at the catalogue rate.
  const other = money(total_ngn || 0).minus(goodsNgn).minus(delivery);
  let adjustmentsUsd = money(0);
  if (!other.eq(0)) {
    let ratio = null;
    if (goodsNgn.gt(0)) ratio = goodsUsd.dividedBy(goodsNgn);
    else if (positive(rate)) ratio = money(1).dividedBy(money(rate));
    if (ratio === null) return null;
    adjustmentsUsd = other
      .times(ratio)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  let total = goodsUsd.plus(adjustmentsUsd).plus(deliveryUsd);
  if (total.lt(0)) total = money(0);
  const totalNgn = money(total_ngn || 0);
  return {
    lines: priced,
    goods_usd: toCurrencyString(goodsUsd),
    adjustments_usd: toCurrencyString(adjustmentsUsd),
    delivery_usd: toCurrencyString(deliveryUsd),
    usd_total: toCurrencyString(total),
    // The order's effective ₦ per $1: pay links divide by it, the webhook
    // multiplies by it, so a full payment of usd_total settles total_ngn.
    fx_rate:
      total.gt(0) && totalNgn.gt(0)
        ? totalNgn.dividedBy(total).toDecimalPlaces(6).toFixed(6)
        : null,
  };
}

// ── Catalogue (₦, $) pairs ────────────────────────────────────────────────
// Each returns { catalogue_ngn, catalogue_usd } (either may be null).

/** A styled variant as the composer (styled_variants.listVariants) returns it,
 *  or the styled product's own anchor price when bought unstyled. */
function pairFromStyled({ styled, variant, unstyled }) {
  if (unstyled || !variant)
    return {
      catalogue_ngn: styled ? styled.retail_price_ngn : null,
      catalogue_usd: styled ? styled.retail_price_usd : null,
    };
  return {
    catalogue_ngn: variant.effective_price_ngn,
    catalogue_usd: variant.effective_price_usd,
  };
}

/** A fixed-price bundle's own USD price. Other pricing models have no single
 *  catalogue USD figure, so they convert at the rate. */
async function bundlePair({ brand, bundle_id }) {
  assertBrand(brand);
  const { rows } = await query(
    `SELECT pricing_model, bundle_price_ngn, bundle_price_usd
       FROM ${brand}.bundle_offers WHERE bundle_id = $1`,
    [bundle_id],
  );
  const b = rows[0];
  if (!b || b.pricing_model !== "fixed_bundle_price")
    return { catalogue_ngn: null, catalogue_usd: null };
  return {
    catalogue_ngn: b.bundle_price_ngn,
    catalogue_usd: b.bundle_price_usd,
  };
}

/**
 * A base/retail variant's channel pair. `unit_ngn` (when given) picks the
 * channel whose Naira price it matches — a Quick Sale line sold at the POS
 * price takes the POS USD twin — else the storefront pair.
 */
async function variantPair({ brand, variant_id, unit_ngn }) {
  assertBrand(brand);
  const { rows } = await query(
    `SELECT price_storefront_ngn, price_storefront_usd,
            price_pos_ngn, price_pos_usd
       FROM ${brand}.product_variants WHERE variant_id = $1`,
    [variant_id],
  );
  const v = rows[0];
  if (!v) return { catalogue_ngn: null, catalogue_usd: null };
  const pairs = [
    { catalogue_ngn: v.price_storefront_ngn, catalogue_usd: v.price_storefront_usd },
    { catalogue_ngn: v.price_pos_ngn, catalogue_usd: v.price_pos_usd },
  ].filter((p) => positive(p.catalogue_ngn) && positive(p.catalogue_usd));
  if (!pairs.length) return { catalogue_ngn: null, catalogue_usd: null };
  if (unit_ngn !== undefined && unit_ngn !== null) {
    const exact = pairs.find((p) => money(p.catalogue_ngn).eq(money(unit_ngn)));
    if (exact) return exact;
  }
  return pairs[0];
}

/** A styled product's anchor pair (order lines don't record the variant). */
async function styledPair({ brand, styled_id }) {
  assertBrand(brand);
  const { rows } = await query(
    `SELECT retail_price_ngn, retail_price_usd
       FROM ${brand}.styled_products WHERE styled_id = $1`,
    [styled_id],
  );
  const s = rows[0];
  return s
    ? { catalogue_ngn: s.retail_price_ngn, catalogue_usd: s.retail_price_usd }
    : { catalogue_ngn: null, catalogue_usd: null };
}

/** A service offering's pair. */
async function servicePair({ service_id }) {
  const { rows } = await query(
    `SELECT base_price_ngn, base_price_usd
       FROM shared.service_offerings WHERE service_id = $1`,
    [service_id],
  );
  const s = rows[0];
  return s
    ? { catalogue_ngn: s.base_price_ngn, catalogue_usd: s.base_price_usd }
    : { catalogue_ngn: null, catalogue_usd: null };
}

/**
 * Dollar figure for an EXISTING order, from its stored lines — used when an
 * order first turns USD after placement (a Quick Sale, a staff switch). Order
 * lines keep the styled product but not the exact size/lace/colour variant, so
 * a styled line scales from the product's anchor pair (premiums in proportion).
 */
async function orderUsdFromLines({ brand, order, rate }) {
  const lines = [];
  for (const l of order.lines || []) {
    let pair = { catalogue_ngn: null, catalogue_usd: null };
    if (l.line_kind === "service" && l.service_offering_id)
      pair = await servicePair({ service_id: l.service_offering_id });
    else if (l.styled_id)
      pair = await styledPair({ brand, styled_id: l.styled_id });
    else if (l.variant_id)
      pair = await variantPair({
        brand,
        variant_id: l.variant_id,
        unit_ngn: l.unit_price_ngn,
      });
    lines.push({ unit_ngn: l.unit_price_ngn, quantity: l.quantity, ...pair });
  }
  return orderUsd({
    lines,
    total_ngn: order.total_ngn,
    delivery_ngn: order.shipping_fee_ngn,
    rate,
  });
}

module.exports = {
  catalogueRate,
  lineUsd,
  orderUsd,
  pairFromStyled,
  bundlePair,
  variantPair,
  styledPair,
  servicePair,
  orderUsdFromLines,
};
