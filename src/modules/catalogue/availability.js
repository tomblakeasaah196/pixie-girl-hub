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
 * SQL: restrict a stock_levels row (aliased `slAlias`) to a location whose
 * stock is genuinely sellable.
 *
 * Availability used to sum EVERY location — including in-transit, production
 * and any warehouse a merchant had deliberately flagged
 * `available_for_storefront = false` — while a sale only ever reserves at the
 * one location `stockRepo.getDefaultLocation` resolves. That mismatch reports
 * stock the checkout cannot reach, and the line then pre-orders despite the
 * screen showing units in stock. Sales-campaigns already filtered this way
 * (campaigns.repo.js, campaigns.bundles.repo.js); this brings the catalogue and
 * storefront reads onto the same definition.
 */
function sellableLocation(brand, slAlias) {
  return `EXISTS (
    SELECT 1 FROM ${t(brand, "stock_locations")} loc
     WHERE loc.location_id = ${slAlias}.location_id
       AND loc.is_active = true
       AND loc.available_for_storefront = true
  )`;
}

/**
 * SQL: extra fulfillable stock from REWIG-eligible size-adjacent sibling bases
 * — one size up or one size down ONLY, never chained further (000088). A
 * sibling is a base sharing `base_family_id` (same texture/lace/colour, only
 * size differs) whose `styled_size_tiers.display_order` is exactly ±1 from the
 * origin base's own tier. Gated by the brand master switch, the brand mode
 * ('automatic' = on by default, 'opt_in' = off by default) crossed with the
 * styled product's own `rewig_override` (NULL = follow the brand mode; an
 * explicit 'enabled'/'disabled' always wins), and each base's own
 * `rewig_eligible` flag (both the origin AND the donor must be eligible).
 *
 * `originExpr` is a SQL expression resolving to the origin base's
 * products.product_id; `styledAlias` is the in-scope styled_products row
 * (carries rewig_override). Returns a scalar subquery — safe to add directly
 * into a SUM(...)/available expression. Direction preference
 * (catalogue_config.rewig_direction) doesn't affect this total — a rewig
 * consumes exactly one donor unit per order, so every eligible sibling's
 * stock genuinely adds to how many of THIS size can be fulfilled; direction
 * only decides which donor is drawn from first at reservation time.
 */
function rewigBonusSql(brand, originExpr, styledAlias) {
  return `(
    SELECT COALESCE(SUM(sib_stock.available), 0)::int
      FROM (
        SELECT DISTINCT sib.product_id
          FROM ${t(brand, "products")} origin
          JOIN ${t(brand, "styled_size_tiers")} ot ON ot.size_code = origin.size_code
          JOIN ${t(brand, "products")} sib
            ON sib.base_family_id = origin.base_family_id
           AND sib.product_id <> origin.product_id
           AND sib.is_deleted = false
           AND sib.rewig_eligible = true
          JOIN ${t(brand, "styled_size_tiers")} st ON st.size_code = sib.size_code
         WHERE origin.product_id = ${originExpr}
           AND origin.base_family_id IS NOT NULL
           AND origin.rewig_eligible = true
           AND ABS(st.display_order - ot.display_order) = 1
           AND (SELECT rewig_enabled FROM ${t(brand, "catalogue_config")} WHERE singleton = true) = true
           AND CASE ${styledAlias}.rewig_override
                 WHEN 'enabled' THEN true
                 WHEN 'disabled' THEN false
                 ELSE (SELECT rewig_mode FROM ${t(brand, "catalogue_config")} WHERE singleton = true) = 'automatic'
               END
      ) sibs
      JOIN LATERAL (
        SELECT COALESCE(SUM(sl.available), 0)::int AS available
          FROM ${t(brand, "stock_levels")} sl
          JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sl.variant_id
         WHERE pv.product_id = sibs.product_id AND pv.is_active = true
           AND ${sellableLocation(brand, "sl")}
      ) sib_stock ON true
  )`;
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
 *     to the seed base, exactly as before;
 *   - each resolved base's own stock is topped up with any REWIG-eligible
 *     size-adjacent sibling's stock (rewigBonusSql, 000088).
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
            SELECT COALESCE(SUM(sl.available), 0)::int
                   + ${rewigBonusSql(brand, "bases.src_product_id", alias)} AS available
              FROM ${t(brand, "stock_levels")} sl
              JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sl.variant_id
             WHERE CASE WHEN ${alias}.base_variant_id IS NOT NULL
                             AND bases.src_product_id = ${alias}.base_product_id
                        THEN sl.variant_id = ${alias}.base_variant_id
                        ELSE pv.product_id = bases.src_product_id AND pv.is_active = true
                   END
               AND ${sellableLocation(brand, "sl")}
          ) src
       ) vav ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(sl.available), 0)::int
                + ${rewigBonusSql(brand, `${alias}.base_product_id`, alias)} AS available
           FROM ${t(brand, "stock_levels")} sl
           JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sl.variant_id
          WHERE CASE WHEN ${alias}.base_variant_id IS NOT NULL
                     THEN sl.variant_id = ${alias}.base_variant_id
                     ELSE pv.product_id = ${alias}.base_product_id AND pv.is_active = true
                END
            AND ${sellableLocation(brand, "sl")}
       ) sav ON true`;
  // vav.available is NULL (not 0) when there are no active variants → seed.
  const expr = `COALESCE(vav.available, sav.available, 0)`;
  return { joins, expr };
}

/**
 * SQL: one LATERAL join resolving the stock behind a SINGLE styled variant
 * row (aliased `variantAlias`, its styled_products row aliased `styledAlias`),
 * under the same rules as styledStockSql (including the rewig sibling
 * top-up). Reserves the alias `vstock`; select `vstock.available`.
 */
function styledVariantStockSql(brand, variantAlias = "v", styledAlias = "sp") {
  const src = `COALESCE(${variantAlias}.base_product_id, ${styledAlias}.base_product_id)`;
  return `LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(sl.available), 0)::int
                + ${rewigBonusSql(brand, src, styledAlias)} AS available
           FROM ${t(brand, "stock_levels")} sl
           JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sl.variant_id
          WHERE CASE WHEN ${styledAlias}.base_variant_id IS NOT NULL
                          AND ${src} = ${styledAlias}.base_product_id
                     THEN sl.variant_id = ${styledAlias}.base_variant_id
                     ELSE pv.product_id = ${src} AND pv.is_active = true
                END
            AND ${sellableLocation(brand, "sl")}
       ) vstock ON true`;
}

module.exports = {
  computeAvailability,
  preorderWindowLabel,
  reduceBundleAvailability,
  rewigBonusSql,
  styledStockSql,
  styledVariantStockSql,
};
