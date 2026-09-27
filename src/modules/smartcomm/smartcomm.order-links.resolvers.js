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
 *
 * Kinds: `base` (a raw/base product), `styled` (a wig sold through its base
 * stock variant), `bundle`, `service`, and — added in PR 3 — `retail`, a Care
 * & Accessories SKU. Retail is resolved through `catalogue/retail-resolver`,
 * the same typed resolver the storefront cart, Quick Sale, quotations and
 * amendments use, so the PXG gate, brand isolation, publication state, live
 * channel price and sellable-location stock all come from one implementation.
 * Retail identity is ALWAYS an exact `variant_id`; there is no default-variant
 * fallback, because a 50 ml and a 100 ml are different products at different
 * prices with different stock.
 */

"use strict";

const { query } = require("../../config/database");
const rewigService = require("../catalogue/rewig.service");

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

/** True when `variant_id` is an ACTIVE variant of `product_id`. */
async function isVariantOfProduct(schema, variant_id, product_id) {
  if (!variant_id || !product_id) return false;
  const { rows } = await query(
    `SELECT 1 FROM ${schema}.product_variants
      WHERE variant_id = $1 AND product_id = $2 AND is_active = true
      LIMIT 1`,
    [variant_id, product_id],
  );
  return rows.length > 0;
}

/** Resolve a `kind: 'base'` item into one sellable line.
 *
 *  Two PR 3 fixes here, both found by reading the SQL against the real schema:
 *
 *  1. `p.is_active` DOES NOT EXIST on `products` (only `product_variants` has
 *     it). The query raised "column p.is_active does not exist" at runtime, the
 *     per-item try/catch in resolveItems swallowed it as "Lookup failed", and
 *     EVERY base-product order link silently resolved to zero sellable lines.
 *     The real lifecycle columns are `is_deleted` (+ `catalogue_role` /
 *     `retail_status` for retail). `is_visible_storefront` is deliberately NOT
 *     required: migration 000043 hides all base products from the storefront on
 *     purpose, yet staff still share them over DM — requiring it would have
 *     broken base links a second time.
 *
 *  2. The chosen variant is now PRESERVED. Previously a base item always sold
 *     its default variant, so a staff member who picked a specific size shared
 *     a link that sold something else. `it.variant_id` wins when it is still
 *     sellable; the default is only a fallback for links that never carried a
 *     pick (and for a pin that has since rotted).
 */
async function resolveBaseItem(schema, it) {
  const { rows } = await query(
    `SELECT p.product_id, p.name, p.product_code, p.catalogue_role,
            (SELECT pi.cdn_url FROM ${schema}.product_images pi
              WHERE pi.product_id = p.product_id
              ORDER BY pi.is_primary DESC, pi.display_order LIMIT 1) AS primary_image_url
       FROM ${schema}.products p
      WHERE p.product_id = $1 AND p.is_deleted = false`,
    [it.product_id],
  );
  const p = rows[0];

  // A Care & Accessories product shared as `base` is a mis-kinded (or forged)
  // payload. Refuse it rather than selling the product's default SKU: retail is
  // stock-only and priced per exact SKU, so a default-variant fallback would
  // silently substitute a different bottle size and price.
  if (p && p.catalogue_role === "retail") {
    return {
      kind: "base",
      ref_id: it.product_id,
      name: p.name,
      product_code: p.product_code,
      image_url: p.primary_image_url,
      qty: it.qty,
      price_ngn: it.price_ngn || null,
      note: it.note || null,
      unresolved_reason:
        "Care & Accessories items must be shared with their exact size/SKU",
      lines: [],
    };
  }

  // Honour an explicit, still-sellable pick — but only a variant OF THIS base
  // product. Without the ownership check a link could pair product X's name
  // and code with any other variant id (another wig, or a Care SKU slipping
  // past the typed retail resolver) and the invoice would name the wrong item.
  const pinned =
    it.variant_id && (await isVariantOfProduct(schema, it.variant_id, it.product_id))
      ? { variant_id: it.variant_id }
      : null;
  const v = pinned || (await defaultVariant(schema, it.product_id));
  return {
    kind: "base",
    ref_id: it.product_id,
    name: p ? p.name : null,
    product_code: p ? p.product_code : null,
    image_url: p ? p.primary_image_url : null,
    qty: it.qty,
    price_ngn: it.price_ngn || null,
    note: it.note || null,
    variant_id: v ? v.variant_id : null,
    unresolved_reason: !p
      ? "Product is deleted or does not exist"
      : !v
        ? "Product has no active variant to sell"
        : null,
    lines: v ? [{ variant_id: v.variant_id, quantity: it.qty }] : [],
  };
}

/** Resolve a `kind: 'retail'` item — one exact Care & Accessories SKU.
 *
 *  This deliberately does NOT reuse the base/styled fallback machinery. It goes
 *  through the same typed resolver every other retail sales path uses
 *  (`catalogue/retail-resolver`), so one implementation owns the PXG gate,
 *  brand isolation, live publication state, variant ownership/activity, live
 *  channel price and sellable-location stock. A forged FLH link, an unpublished
 *  item, a wrong-brand variant id or a base-wig variant all refuse here.
 *
 *  `variant_id` is mandatory and there is NO default-variant fallback: guessing
 *  a bottle size is exactly the bug PR 3 fixes.
 *
 *  The returned `price_ngn` is the LIVE resolved price, for display. It is
 *  never used to override what Sales charges a retail line — retail always
 *  re-prices from the live channel price at order time (see
 *  storefront.service.resolveStyledUnitPrices, which maps styled picks only),
 *  so a stale or tampered link-row price cannot set the amount charged.
 */
async function resolveRetailItem(business, it) {
  const shape = {
    kind: "retail",
    ref_id: it.variant_id || it.product_id || null,
    product_id: it.product_id || null,
    variant_id: it.variant_id || null,
    sku: it.sku || null,
    name: null,
    product_code: null,
    variant_label: null,
    image_url: null,
    qty: it.qty,
    price_ngn: it.price_ngn || null,
    note: it.note || null,
    available: 0,
    lines: [],
  };
  if (!it.variant_id) {
    return {
      ...shape,
      unresolved_reason:
        "A Care & Accessories item needs its exact size/SKU — re-share it from the catalogue picker",
    };
  }
  const retailResolver = require("../catalogue/retail-resolver");
  let r;
  try {
    r = await retailResolver.resolveSellableVariant({
      brand: business,
      variant_id: it.variant_id,
      product_id: it.product_id || null,
      channel: "storefront",
    });
  } catch (err) {
    // NotFound (gate off / FLH / unpublished / trashed / wrong-role / wrong
    // brand) and RETAIL_UNPRICED both land here as "can't be sold" — the
    // customer-facing message, never the raw SQL detail.
    return {
      ...shape,
      unresolved_reason:
        (err && (err.options?.user_message || err.user_message || err.message)) ||
        "This Care & Accessories item isn't available",
    };
  }
  return {
    ...shape,
    ref_id: r.variant_id,
    product_id: r.product_id,
    variant_id: r.variant_id,
    sku: r.sku,
    name: r.name,
    product_code: r.product_code || null,
    variant_label: r.variant_label || null,
    image_url: r.image_url || null,
    price_ngn: String(r.unit_price_ngn),
    available: Number(r.available) || 0,
    taxable: r.taxable === true,
    vat_rate: r.vat_rate === null || r.vat_rate === undefined ? null : Number(r.vat_rate),
    // Stock-only invariants, surfaced so no downstream surface can promise a
    // pre-order, a rewig substitute or a styling job for a retail line.
    preorder: false,
    rewig_eligible: false,
    unresolved_reason: null,
    lines: [{ variant_id: r.variant_id, quantity: it.qty }],
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
  // Rewig adjacency (000088): the resolution above is deterministic, not
  // stock-aware — if the base it landed on is short, draw from a
  // size-adjacent sibling base instead, same as storefront checkout.
  if (variant_id && styled.base_product_id) {
    const donorProductId = await rewigService.pickRewigDonorProductId({
      brand: business,
      styled,
      originProductId: styled.base_product_id,
      quantity: it.qty,
    });
    if (donorProductId) {
      const dv = await defaultVariant(schema, donorProductId);
      if (dv) variant_id = dv.variant_id;
    }
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
 *  variant; if any component can't resolve (a styled sub-component with
 *  no reachable base, a bundle_offer_products row with no product/styled
 *  reference at all) the whole bundle is left unsupported rather than
 *  shipping a partial order silently. */
async function resolveBundleItem(business, it) {
  const bundleService = require("../retention/bundle.service");
  const styledRepo = require("../catalogue/styled.repo");
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
    // Bundle components can pin ANY of three things (bundle_offer_products
    // carries all three columns): a specific variant, a styled product, or
    // a base product. The pinned variant/base can rot silently too — the
    // referenced variant is deleted/deactivated in POS while the pin stays
    // put — so every branch verifies + falls through to the base's default
    // variant when the pin is stale. Missing this styled_id branch was
    // exactly why every bundle made of styled components (e.g. "The Baddie")
    // returned lines:[] and rendered "Unavailable right now" on the /o page.
    // Matches the resolution the storefront's own bundle resolver runs
    // (src/modules/storefront/storefront.service.js resolveStorefrontBundle).
    let variant_id = null;
    if (
      comp.variant_id &&
      (await isVariantSellable(schema, comp.variant_id))
    ) {
      variant_id = comp.variant_id;
    } else if (comp.styled_id) {
      // Styled component → the base variant carries the stock; the styled
      // record only sets pricing + fulfilment styling. Prefer the pinned
      // base_variant_id when it's still sellable in the brand's schema,
      // else the base product's default variant.
      let styled = null;
      try {
        styled = await styledRepo.getById({ brand: business, id: comp.styled_id });
      } catch {
        styled = null;
      }
      if (
        styled &&
        styled.base_variant_id &&
        (await isVariantSellable(schema, styled.base_variant_id))
      ) {
        variant_id = styled.base_variant_id;
      } else if (styled && styled.base_product_id) {
        const v = await defaultVariant(schema, styled.base_product_id);
        variant_id = v ? v.variant_id : null;
      }
      // Rewig adjacency (000088) — same fallback as a direct styled item.
      if (variant_id && styled && styled.base_product_id) {
        const donorProductId = await rewigService.pickRewigDonorProductId({
          brand: business,
          styled,
          originProductId: styled.base_product_id,
          quantity: (comp.quantity || 1) * it.qty,
        });
        if (donorProductId) {
          const dv = await defaultVariant(schema, donorProductId);
          if (dv) variant_id = dv.variant_id;
        }
      }
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
      if (it.kind === "retail") {
        // Retail is routed on `kind` alone — never on which id happens to be
        // present — so a retail item that lost its variant_id fails loudly
        // inside resolveRetailItem instead of falling through to the base
        // path and selling a default SKU.
        out.push(await resolveRetailItem(business, it));
      } else if (it.kind === "styled" && it.styled_id) {
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
          it.variant_id ||
          it.product_id ||
          it.styled_id ||
          it.bundle_id ||
          it.service_id ||
          null,
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
  isVariantSellable,
  resolveBaseItem,
  resolveRetailItem,
  resolveStyledItem,
  resolveBundleItem,
  resolveServiceItem,
  resolveItems,
};
