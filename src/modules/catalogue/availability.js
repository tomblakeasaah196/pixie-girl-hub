/**
 * Customer-facing availability, shared by the catalogue + storefront so the
 * "in stock / pre-order / sold out" decision is computed in exactly one place.
 *
 * Universal pre-orders (000086): with a brand `policy`, any out-of-stock item
 * is offered as a PRE-ORDER unless the brand switch is off or the product is
 * opted out (`preorder_excluded`). Without a policy we fall back to the legacy
 * per-product opt-in (`base.preorder_enabled`) so existing callers are unchanged.
 */

"use strict";

const { formatDate } = require("../../utils/dates");
const { t } = require("../../config/brands");

/** "4–8 weeks" / "6 weeks" / null (from a brand pre-order policy). */
function preorderWindowLabel(policy = {}) {
  const min = Number(policy.min_weeks) || 0;
  const max = Number(policy.max_weeks) || 0;
  if (min && max && min !== max) return `${min}–${max} weeks`;
  const w = max || min;
  return w ? `${w} week${w === 1 ? "" : "s"}` : null;
}

/**
 * @param {number} available  base units available (0 when out of stock)
 * @param {object} opts
 * @param {object} [opts.base]    { preorder_enabled, preorder_excluded,
 *                                  expected_ready_date, production_lead_days }
 * @param {object} [opts.policy]  brand policy { enabled, min_weeks, max_weeks }
 * @returns {{state:'in_stock'|'preorder'|'out_of_stock', available:number, ...}}
 */
function computeAvailability(available, { base = {}, policy = null } = {}) {
  const avail = Number(available) || 0;
  if (avail > 0) return { state: "in_stock", available: avail };

  const excluded = Boolean(base.preorder_excluded);
  const preorderOn = policy
    ? Boolean(policy.enabled)
    : Boolean(base.preorder_enabled);

  if (preorderOn && !excluded) {
    const label = policy ? preorderWindowLabel(policy) : null;
    let message;
    if (base.expected_ready_date) {
      message = `In production · ready ~${formatDate(
        base.expected_ready_date,
        String(base.expected_ready_date),
      )}`;
    } else if (base.production_lead_days) {
      message = `Made to order · ~${base.production_lead_days} days in production`;
    } else if (label) {
      message = `Made to order · ships in ~${label}`;
    } else {
      message = "Made to order · in production";
    }
    return {
      state: "preorder",
      available: 0,
      expected_ready_date: base.expected_ready_date || null,
      production_lead_days: base.production_lead_days || null,
      min_weeks: policy ? policy.min_weeks ?? null : null,
      max_weeks: policy ? policy.max_weeks ?? null : null,
      window_label: label,
      message,
    };
  }
  return { state: "out_of_stock", available: 0 };
}

/**
 * Reduce a set of component availabilities to a BUNDLE-level state (000086).
 * A bundle can only be fully in stock when every component is; if any single
 * component is a hard sold-out (opted out of pre-orders AND out of stock) the
 * whole bundle can't be fulfilled, so it's sold out; otherwise if any component
 * must be made to order the bundle is a pre-order on the LONGEST such window
 * (it ships once the slowest piece is ready). An empty set is in stock.
 *
 * Shared by the storefront bundle pages and the cart so a bundle's badge is
 * computed in exactly one place.
 *
 * @param {Array<{state:string, max_weeks?:number}>} parts component availabilities
 */
function reduceBundleAvailability(parts = []) {
  let state = "in_stock";
  let preorder = null;
  for (const a of parts) {
    if (!a) continue;
    if (a.state === "out_of_stock") {
      state = "out_of_stock";
    } else if (a.state === "preorder" && state !== "out_of_stock") {
      state = "preorder";
      // Keep the component with the longest production window — the bundle
      // can't ship until its slowest piece is ready.
      if (!preorder || (Number(a.max_weeks) || 0) > (Number(preorder.max_weeks) || 0)) {
        preorder = a;
      }
    }
  }
  if (state === "out_of_stock") return { state: "out_of_stock", available: 0 };
  if (state === "preorder" && preorder) {
    return { ...preorder, state: "preorder", available: 0 };
  }
  return { state: "in_stock", available: 0 };
}

/**
 * SQL: the two LATERAL joins that resolve a styled product's stock the
 * VARIANT-AWARE way, for a query whose outer styled_products row is aliased
 * `alias`. Every styled colour×size variant carries its own base product
 * (falling back to the styled product's seed base), so the stock behind a
 * styled product is the sum across the DISTINCT bases of its ACTIVE variants —
 * not just the seed base. Rules, shared with checkout's stock resolution:
 *
 *   - a variant's stock source = its own base_product_id, else the seed base;
 *   - the styled-level base_variant_id pin only applies when the resolved
 *     source IS the seed base (a repointed variant reads its own base whole);
 *   - a styled product with no active variants (a draft mid-setup) falls back
 *     to the seed base, exactly as before.
 *
 * Use as: `... FROM styled_products s ${joins} ...` then select `${expr}`.
 * The aliases `vav`/`sav` are reserved by this fragment.
 */
function styledStockSql(brand, alias = "s") {
  const joins = `LEFT JOIN LATERAL (
         SELECT SUM(src.available)::int AS available
           FROM (SELECT DISTINCT COALESCE(v.base_product_id, ${alias}.base_product_id) AS src_product_id
                   FROM ${t(brand, "styled_product_variants")} v
                  WHERE v.styled_id = ${alias}.styled_id
                    AND v.is_active = true AND v.is_deleted = false) bases
          CROSS JOIN LATERAL (
            SELECT COALESCE(SUM(sl.available), 0)::int AS available
              FROM ${t(brand, "stock_levels")} sl
              JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sl.variant_id
             WHERE CASE WHEN ${alias}.base_variant_id IS NOT NULL
                             AND bases.src_product_id = ${alias}.base_product_id
                        THEN sl.variant_id = ${alias}.base_variant_id
                        ELSE pv.product_id = bases.src_product_id AND pv.is_active = true
                   END
          ) src
       ) vav ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(sl.available), 0)::int AS available
           FROM ${t(brand, "stock_levels")} sl
           JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sl.variant_id
          WHERE CASE WHEN ${alias}.base_variant_id IS NOT NULL
                     THEN sl.variant_id = ${alias}.base_variant_id
                     ELSE pv.product_id = ${alias}.base_product_id AND pv.is_active = true
                END
       ) sav ON true`;
  // vav.available is NULL (not 0) when there are no active variants → seed.
  const expr = `COALESCE(vav.available, sav.available, 0)`;
  return { joins, expr };
}

/**
 * SQL: one LATERAL join resolving the stock behind a SINGLE styled variant
 * row (aliased `variantAlias`, its styled_products row aliased `styledAlias`),
 * under the same rules as styledStockSql. Reserves the alias `vstock`;
 * select `vstock.available`.
 */
function styledVariantStockSql(brand, variantAlias = "v", styledAlias = "sp") {
  const src = `COALESCE(${variantAlias}.base_product_id, ${styledAlias}.base_product_id)`;
  return `LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(sl.available), 0)::int AS available
           FROM ${t(brand, "stock_levels")} sl
           JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sl.variant_id
          WHERE CASE WHEN ${styledAlias}.base_variant_id IS NOT NULL
                          AND ${src} = ${styledAlias}.base_product_id
                     THEN sl.variant_id = ${styledAlias}.base_variant_id
                     ELSE pv.product_id = ${src} AND pv.is_active = true
                END
       ) vstock ON true`;
}

module.exports = {
  computeAvailability,
  preorderWindowLabel,
  reduceBundleAvailability,
  styledStockSql,
  styledVariantStockSql,
};
