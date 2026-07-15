/**
 * Sales pricing — bundle verification + discount amount (F-2 / §6.23.4).
 *
 * Pure: verifies the bundle's core components are all present in the cart,
 * then computes the discount on the component subtotal. Quantity-based
 * models (buy_x_get_y, tiered_qty) are delegated to the injected
 * `quantityBundleDiscount` (retention/bundle.service) so this module stays
 * dependency-free; that function is itself pure maths.
 */

"use strict";

const { money } = require("../../../utils/money");
const { AppError } = require("../../../utils/errors");

function isComponentOf(components) {
  return (b) =>
    components.some((c) => {
      if (c.variant_id) return b.li.variant_id === c.variant_id;
      // Styled/base components match on the resolved base product id. A styled
      // component pins only styled_id (product_id/variant_id null); the repo
      // resolves it to match_product_id so it lines up with the base-variant
      // line the checkout actually submits.
      const productId = c.product_id || c.match_product_id;
      return productId ? b.ctx.product_id === productId : false;
    });
}

/** Throws BUNDLE_INCOMPLETE unless every core component is in the cart. */
function assertBundleComplete(bundle, built) {
  const components = bundle.components || [];
  for (const comp of components.filter((c) => c.role === "core" || !c.role)) {
    // Styled components carry no product_id/variant_id, only styled_id; the
    // repo resolves them to match_product_id (the base product the styled
    // component sells as) so a bundle of styled items no longer falsely reads
    // as "components missing" at Place Order.
    const compProductId = comp.product_id || comp.match_product_id;
    const have = built.reduce((q, b) => {
      const match = comp.variant_id
        ? b.li.variant_id === comp.variant_id
        : compProductId
          ? b.ctx.product_id === compProductId
          : false;
      return match ? q + b.li.quantity : q;
    }, 0);
    if (have < (comp.quantity || 1))
      throw new AppError(
        "BUNDLE_INCOMPLETE",
        "Bundle components missing from the order",
        409,
      );
  }
}

/**
 * Discount amount for a verified bundle (floor handling is the allocator's
 * job — this only computes the requested amount).
 *
 * @param {object} args
 * @param {object} args.bundle
 * @param {Array}  args.built
 * @param {Array<import('decimal.js').Decimal>} args.preNetByIdx
 * @param {(args: object) => import('decimal.js').Decimal} args.quantityBundleDiscount
 * @returns {import('decimal.js').Decimal}
 */
function computeBundleDiscount({
  bundle,
  built,
  preNetByIdx,
  quantityBundleDiscount,
}) {
  const components = bundle.components || [];
  const isComponent = isComponentOf(components);
  const compSubtotal = built.reduce(
    (s, b, idx) => (isComponent(b) ? s.plus(preNetByIdx[idx]) : s),
    money(0),
  );
  let d = money(0);
  if (bundle.pricing_model === "fixed_bundle_price") {
    const price = money(bundle.bundle_price_ngn || 0);
    d = compSubtotal.gt(price) ? compSubtotal.minus(price) : money(0);
  } else if (bundle.pricing_model === "pct_off") {
    d = compSubtotal.times(money(bundle.discount_value || 0));
  } else if (bundle.pricing_model === "amount_off") {
    d = money(bundle.discount_value || 0);
    if (d.gt(compSubtotal)) d = compSubtotal;
  } else if (
    bundle.pricing_model === "buy_x_get_y" ||
    bundle.pricing_model === "tiered_qty"
  ) {
    // Quantity-based models need per-line context (F-2 remainder).
    const componentLines = built
      .map((b, idx) => ({ b, idx }))
      .filter(({ b }) => isComponent(b))
      .map(({ b, idx }) => ({
        quantity: b.li.quantity,
        unit_price_ngn:
          b.li.quantity > 0
            ? money(preNetByIdx[idx]).div(b.li.quantity)
            : money(0),
      }));
    d = quantityBundleDiscount({
      pricing_model: bundle.pricing_model,
      bundle,
      lines: componentLines,
      component_subtotal_ngn: compSubtotal,
    });
  }
  return d;
}

module.exports = { assertBundleComplete, computeBundleDiscount };
