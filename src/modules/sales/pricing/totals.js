/**
 * Sales pricing — totals, VAT, line snapshots, deposit policy (§6.2).
 *
 * Pure: folds the built lines + allocated order-level discounts into the
 * persistable line rows and the order totals. Tax is computed on the
 * post-discount base per line; a line's own product VAT overrides the
 * brand default; non-taxable contexts (services flagged, exempt products)
 * tax at 0.
 */

"use strict";

const { money, toCurrencyString } = require("../../../utils/money");

/**
 * @param {object} args
 * @param {Array} args.built
 * @param {Array<import('decimal.js').Decimal>} args.extraShareByIdx
 * @param {import('decimal.js').Decimal} args.defaultVat
 * @returns {{subtotal, discountTotal, taxTotal, lineRows: Array<object>}}
 */
function computeTotalsAndLines({ built, extraShareByIdx, defaultVat }) {
  let subtotal = money(0),
    discountTotal = money(0),
    taxTotal = money(0);
  const lineRows = [];
  built.forEach((b, idx) => {
    const qty = b.li.quantity;
    const gross = b.unit.times(qty);
    const lineDiscount = b.perUnitDiscount
      .times(qty)
      .plus(extraShareByIdx[idx]);
    const taxable = b.ctx.taxable !== false;
    const rate = taxable
      ? b.ctx.product_vat !== null && b.ctx.product_vat !== undefined
        ? money(b.ctx.product_vat)
        : defaultVat
      : money(0);
    const taxableBase = gross.minus(lineDiscount);
    const tax = taxableBase.times(rate);
    const lineTotal = taxableBase.plus(tax);
    subtotal = subtotal.plus(gross);
    discountTotal = discountTotal.plus(lineDiscount);
    taxTotal = taxTotal.plus(tax);
    lineRows.push({
      product_id: b.ctx.product_id,
      variant_id: b.li.variant_id,
      // Snapshot overrides let a caller (e.g. a styled-product checkout line)
      // record the styled name/label/SKU instead of the base variant's.
      product_name_snapshot: b.li.product_name_snapshot ?? b.ctx.product_name,
      variant_label_snapshot: b.li.variant_label_snapshot ?? b.ctx.variant_name,
      sku_snapshot: b.li.sku_snapshot ?? b.ctx.sku,
      quantity: qty,
      unit_price_ngn: toCurrencyString(b.unit),
      unit_cost_ngn: b.ctx.cost_price_ngn,
      line_discount_ngn: toCurrencyString(lineDiscount),
      // Portion from resolveDiscount only (percentage / fixed / price-override).
      // Used for the per-line "campaign" breakdown row so that order-level
      // discounts (coupon, points, bundle, deal) are not double-counted there.
      _campaign_resolve_discount_ngn: toCurrencyString(
        b.perUnitDiscount.times(qty),
      ),
      tax_rate: rate.toFixed(4),
      tax_amount_ngn: toCurrencyString(tax),
      line_total_ngn: toCurrencyString(lineTotal),
      display_order: idx,
      notes: b.li.notes,
      // Stylist Studio (PR3): what the line sells. Default 'product', but
      // 'service' when it carries a service offering, so the deposit-met
      // auto-open opens a job only for styling work.
      line_kind:
        b.li.line_kind ||
        (b.li.service_offering_id
          ? "service"
          : b.li.styled_id
            ? "styled"
            : "product"),
      service_offering_id: b.li.service_offering_id || null,
      styled_id: b.li.styled_id || null,
    });
  });
  return { subtotal, discountTotal, taxTotal, lineRows };
}

/**
 * Payment model + deposit policy (V2.2 §6.2, Flexi Pay D1/D6).
 *
 * CONFIG-DRIVEN since the 2026-07-10 owner session: the policy comes from
 * business_config.installment_settings (the Sales → Payments tab) plus the
 * BUYER's explicit payment_plan choice — never from per-product
 * payment_model columns (those are dormant; one config switch governs all
 * products).
 *
 *   plan 'full'        → full_payment_only (no deposit machinery)
 *   plan 'instalment'  → custom order  → deposit_triggered at
 *                        custom_order_deposit_pct (production unlocks there)
 *                      → stock order   → layaway; the snapshotted deposit is
 *                        the MINIMUM FIRST PAYMENT (min_first_payment_pct),
 *                        locked on the order so a later config change never
 *                        moves the goalposts on an existing plan.
 *
 * @param {object} args
 * @param {object} args.installmentSettings  business_config.installment_settings ({} when absent).
 * @param {object} args.input                createOrder input (payment_plan, is_custom_order, required_deposit_pct override).
 * @param {import('decimal.js').Decimal} args.total
 */
function computeDepositPolicy({ installmentSettings, input, total }) {
  const s = installmentSettings || {};
  const paymentPlan =
    input.payment_plan === "instalment" ? "instalment" : "full";
  // Custom orders are ALWAYS deposit_triggered regardless of plan: the
  // deposit threshold is what unlocks production / opens the Studio job
  // (order.deposit_met), and a full payment clears it trivially.
  if (input.is_custom_order) {
    const pct = money(
      input.required_deposit_pct ??
        s.custom_order_deposit_pct ??
        s.default_deposit_pct_for_deposit_triggered ??
        50,
    );
    return {
      paymentPlan,
      paymentModel: "deposit_triggered",
      requiredDepositPct: pct,
      requiredDepositNgn: total.times(pct).dividedBy(100),
    };
  }
  if (paymentPlan === "full") {
    return {
      paymentPlan,
      paymentModel: "full_payment_only",
      requiredDepositPct: null,
      requiredDepositNgn: null,
    };
  }
  const pct = money(input.required_deposit_pct ?? s.min_first_payment_pct ?? 30);
  return {
    paymentPlan,
    paymentModel: "layaway",
    requiredDepositPct: pct,
    requiredDepositNgn: total.times(pct).dividedBy(100),
  };
}

module.exports = { computeTotalsAndLines, computeDepositPolicy };
