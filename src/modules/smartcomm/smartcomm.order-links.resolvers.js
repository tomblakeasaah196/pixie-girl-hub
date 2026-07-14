/**
 * Order-link item resolvers — shared by the public checkout route
 * (customer opening the `/o/<slug>` link) AND the authenticated minter
 * (staff sharing a catalogue). One implementation so what the staff
 * picker warns about is exactly what the customer's checkout will sell.
 *
 * Every resolver returns the same shape:
 *   { kind, ref_id, name, product_code, image_url, qty, price_ngn,
 *     note, lines: [{variant_id, quantity}], … }
 * `lines` empty (for a non-service kind) means the item can NOT be
 * turned into a sellable order line — deleted/inactive product, no
 * active variant, non-live styled product, unresolvable bundle
 * component — and the checkout excludes it from the submitted order.
 */

"use strict";

const { query } = require("../../config/database");

/** Default sellable variant for a base product: prefer the flagged
 *  default, else the oldest active row — mirrors the convention used
 *  across catalogue/bundle/cart resolution elsewhere in the codebase. */
async function defaultVariant(schema, product_id) {
  const { rows } = await query(
    `SELECT variant_id, price_storefront_ngn, price_pos_ngn
       FROM ${schema}.product_variants
      WHERE product_id = $1 AND is_active = true
      ORDER BY is_default DESC, created_at ASC
      LIMIT 1`,
    [product_id],
  );
  return rows[0] || null;
}

/** True when the variant exists in this brand's schema AND is active.
 *  Pinned variants (a styled product's `base_variant_id`, a bundle
 *  component's `variant_id`) can rot silently — the referenced variant
 *  is deleted/deactivated in POS while the pin stays put. The customer
 *  used to only find out at Place Order (Sales rejects "Variant … not
 *  found" — REFERENCE_INVALID). Verifying up front lets the resolver
 *  fall back to defaultVariant instead. */
async function isVariantSellable(schema, variant_id) {
  if (!variant_id) return false;
  const { rows } = await query(
    `SELECT 1 FROM ${schema}.product_variants
      WHERE variant_id = $1 AND is_active = true
      LIMIT 1`,
    [variant_id],
  );
  return rows.length > 0;
}

/** Resolve a `kind: 'base'` item into one sellable line. */
async function resolveBaseItem(schema, it) {
  const { rows } = await query(
    `SELECT p.product_id, p.name, p.product_code,
            (SELECT pi.cdn_url FROM ${schema}.product_images pi
              WHERE pi.product_id = p.product_id
              ORDER BY pi.is_primary DESC, pi.display_order LIMIT 1) AS primary_image_url
       FROM ${schema}.products p
      WHERE p.product_id = $1 AND p.is_active = true`,
    [it.product_id],
  );
  const p = rows[0];
  const v = await defaultVariant(schema, it.product_id);
  return {
    kind: "base",
    ref_id: it.product_id,
    name: p ? p.name : null,
    product_code: p ? p.product_code : null,
    image_url: p ? p.primary_image_url : null,
    qty: it.qty,
    price_ngn: it.price_ngn || null,
    note: it.note || null,
    unresolved_reason: !p
      ? "Product is inactive or deleted"
      : !v
        ? "Product has no active variant to sell"
        : null,
    lines: v ? [{ variant_id: v.variant_id, quantity: it.qty }] : [],
  };
}

/** Resolve a `kind: 'styled'` item. A styled product sells through the
 *  base product's stock variant — the pinned one when the styled record
 *  has it, else the base's default variant (mirrors the ERP-wide
 *  product-search resolver in apps/admin/src/lib/product-search.ts). */
async function resolveStyledItem(business, it) {
  const styledRepo = require("../catalogue/styled.repo");
  const styled = await styledRepo.getById({ brand: business, id: it.styled_id });
  const schema = `"${business}"`;
  if (!styled || styled.is_deleted || styled.status !== "live") {
    return {
      kind: "styled",
      ref_id: it.styled_id,
      name: styled && !styled.is_deleted ? styled.name : null,
      product_code: null,
      image_url: null,
      qty: it.qty,
      price_ngn: it.price_ngn || null,
      note: it.note || null,
      unresolved_reason:
        !styled || styled.is_deleted
          ? "Styled product no longer exists"
          : `Styled product is not live (status: ${styled.status})`,
      lines: [],
    };
  }
  // The pinned `base_variant_id` may point at a variant that has since
  // been deleted/deactivated in POS — Sales rejects the order with
  // "Variant … not found" the moment the customer taps Place Order.
  // Verify the pin is still sellable in THIS brand's schema; if not,
  // fall back to the base product's default variant (matches how POS +
  // storefront checkout resolve the styled product themselves).
  let variant_id = null;
  if (
    styled.base_variant_id &&
    (await isVariantSellable(schema, styled.base_variant_id))
  ) {
    variant_id = styled.base_variant_id;
  } else {
    const v = await defaultVariant(schema, styled.base_product_id);
    variant_id = v ? v.variant_id : null;
  }
  // Staff may have picked a specific head size × lace × colour (styled_variant).
  // The physical stock line is still the base variant above; the styled variant
  // sets the PRICE (it.price_ngn, snapshotted at pick time) and the spec label
  // shown to the customer + recorded on the order note for fulfilment.
  const spec = it.spec || null;
  const note = [it.note, spec].filter(Boolean).join(" — ") || null;
  return {
    kind: "styled",
    ref_id: it.styled_id,
    name: styled.name,
    product_code: styled.styled_code,
    image_url: styled.primary_image_url || null,
    qty: it.qty,
    price_ngn: it.price_ngn || String(styled.retail_price_ngn ?? ""),
    note,
    spec,
    styled_variant_id: it.styled_variant_id || null,
    size_code: it.size_code || null,
    lace_code: it.lace_code || null,
    colour_id: it.colour_id || null,
    unresolved_reason: variant_id
      ? null
      : "Base product has no active variant to sell through",
    lines: variant_id ? [{ variant_id, quantity: it.qty }] : [],
  };
}

/** Resolve a `kind: 'bundle'` item into its component lines. A bundle
 *  only resolves cleanly when EVERY component maps to a stocked base
 *  product; if any component can't resolve (e.g. a styled sub-component
 *  with no pinned variant) the whole bundle is left unsupported rather
 *  than shipping a partial order silently. */
async function resolveBundleItem(business, it) {
  const bundleService = require("../retention/bundle.service");
  const schema = `"${business}"`;
  let bundle;
  try {
    bundle = await bundleService.getBundle({ brand: business, id: it.bundle_id });
  } catch {
    bundle = null;
  }
  if (!bundle || bundle.is_active === false) {
    return {
      kind: "bundle",
      ref_id: it.bundle_id,
      name: bundle ? bundle.display_name : null,
      product_code: null,
      image_url: null,
      qty: it.qty,
      price_ngn: it.price_ngn || null,
      note: it.note || null,
      unresolved_reason: bundle
        ? "Bundle is inactive"
        : "Bundle no longer exists",
      lines: [],
    };
  }
  const lines = [];
  let allResolved = true;
  for (const comp of bundle.components || []) {
    // Same rot as styled products: a component's pinned variant_id can
    // outlive the variant itself. Verify each pin against the brand's
    // schema; fall back to the component product's default variant when
    // the pin is stale so the bundle doesn't dead-end at Place Order.
    let variant_id = null;
    if (
      comp.variant_id &&
      (await isVariantSellable(schema, comp.variant_id))
    ) {
      variant_id = comp.variant_id;
    } else if (comp.product_id) {
      const v = await defaultVariant(schema, comp.product_id);
      variant_id = v ? v.variant_id : null;
    }
    if (!variant_id) {
      allResolved = false;
      break;
    }
    lines.push({
      variant_id,
      quantity: (comp.quantity || 1) * it.qty,
    });
  }
  return {
    kind: "bundle",
    ref_id: it.bundle_id,
    name: bundle.display_name,
    product_code: bundle.bundle_code || null,
    image_url: bundle.hero_image_url || null,
    qty: it.qty,
    price_ngn:
      it.price_ngn ||
      String(bundle.effective_price_ngn ?? bundle.bundle_price_ngn ?? ""),
    note: it.note || null,
    bundle_id: it.bundle_id,
    unresolved_reason: allResolved
      ? null
      : "A bundle component has no sellable variant",
    lines: allResolved ? lines : [],
  };
}

/** Resolve a `kind: 'service'` item from the shared service catalogue.
 *  Services carry no stock variant — the checkout renders them as
 *  booking lines (requested date/time; the business confirms). */
async function resolveServiceItem(business, it) {
  const { rows } = await query(
    `SELECT service_id, name, description, base_price_ngn, duration_minutes, image_url
       FROM shared.service_offerings
      WHERE service_id = $1 AND business = $2 AND is_active = true`,
    [it.service_id, business],
  );
  const s = rows[0];
  return {
    kind: "service",
    ref_id: it.service_id,
    service_id: it.service_id,
    name: s ? s.name : null,
    product_code: null,
    image_url: s ? s.image_url : null,
    qty: it.qty,
    price_ngn: it.price_ngn || (s ? String(s.base_price_ngn) : null),
    duration_minutes: s ? s.duration_minutes : null,
    note: it.note || null,
    unresolved_reason: s ? null : "Service is inactive or deleted",
    lines: [],
  };
}

/**
 * Resolve a normalised item list (the shape persisted on the order-link
 * row) for a brand. Any single item failing never takes the batch down —
 * it surfaces as `lines: []` + `unresolved_reason`.
 */
async function resolveItems(business, items) {
  const schema = `"${business}"`;
  const out = [];
  for (const it of items || []) {
    try {
      if (it.kind === "styled" && it.styled_id) {
        out.push(await resolveStyledItem(business, it));
      } else if (it.kind === "bundle" && it.bundle_id) {
        out.push(await resolveBundleItem(business, it));
      } else if (it.kind === "service" && it.service_id) {
        out.push(await resolveServiceItem(business, it));
      } else {
        out.push(await resolveBaseItem(schema, it));
      }
    } catch {
      out.push({
        kind: it.kind || "base",
        ref_id:
          it.product_id || it.styled_id || it.bundle_id || it.service_id || null,
        name: null,
        product_code: null,
        image_url: null,
        qty: it.qty,
        price_ngn: it.price_ngn || null,
        note: it.note || null,
        unresolved_reason: "Lookup failed",
        lines: [],
      });
    }
  }
  return out;
}

module.exports = {
  defaultVariant,
  resolveBaseItem,
  resolveStyledItem,
  resolveBundleItem,
  resolveServiceItem,
  resolveItems,
};
