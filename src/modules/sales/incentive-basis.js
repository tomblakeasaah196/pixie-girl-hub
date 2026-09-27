/**
 * Care & Accessories share of an order — for the incentive bases (loyalty /
 * crowns, customer referral, stylist referral, staff sales commission).
 *
 * Owner rule (docs/PXG_RETAIL_PRODUCTS_FEASIBILITY.md): retail value earns no
 * loyalty, referral reward or commission; a MIXED order's incentive uses the
 * eligible (non-retail) value; wig-only and FLH orders keep EXACTLY their
 * existing behaviour. So callers keep their historical base and only subtract
 * the retail share this returns — an order with no retail lines is untouched
 * (services included, as before).
 *
 * Pure read. A line is retail when its product (the line's own product_id or
 * its variant's) carries catalogue_role = 'retail'. FLH can never hold one
 * (000094 CHECK), so there this always reports "no retail".
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");
const { money } = require("../../utils/money");

async function retailShare({ client, brand, order_id }) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT sol.quantity, sol.unit_price_ngn, sol.line_discount_ngn,
            sol.line_total_ngn,
            (p.catalogue_role = 'retail') AS is_retail
       FROM ${t(brand, "sales_order_lines")} sol
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sol.variant_id
       LEFT JOIN ${t(brand, "products")} p
              ON p.product_id = COALESCE(sol.product_id, pv.product_id)
      WHERE sol.order_id = $1`,
    [order_id],
  );
  let retailGross = money(0);
  let retailNet = money(0);
  let retailTotal = money(0);
  let retailLines = 0;
  for (const r of rows) {
    if (r.is_retail !== true) continue;
    retailLines += 1;
    const gross = money(r.unit_price_ngn || 0).times(Number(r.quantity) || 0);
    retailGross = retailGross.plus(gross);
    retailNet = retailNet.plus(gross.minus(money(r.line_discount_ngn || 0)));
    retailTotal = retailTotal.plus(money(r.line_total_ngn || 0));
  }
  return {
    hasRetail: retailLines > 0,
    retailOnly: rows.length > 0 && retailLines === rows.length,
    // unit × qty (pre-discount, pre-tax)
    retailGross,
    // after line + allocated order discounts, pre-tax
    retailNet,
    // what the customer pays for the retail lines (net + VAT)
    retailTotal,
  };
}

/** `base` minus `share`, floored at zero (a Decimal). */
function minusShare(base, share) {
  const out = money(base || 0).minus(share);
  return out.lt(0) ? money(0) : out;
}

module.exports = { retailShare, minusShare };
