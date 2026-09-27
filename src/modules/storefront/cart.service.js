/**
 * Cart & Wishlist (V2.2 §6.4) — business logic.
 *
 * Cart is keyed by (contact_id, business) for logged-in users or by
 * session_token for guests. Guest carts merge into the customer cart at
 * login. Coupon validation re-uses the retention/coupons engine (read-only;
 * redemption happens at checkout via createOrder).
 *
 * Wishlist is per (contact_id, business, variant_id) — adds/removes only,
 * the storefront frontend controls display.
 */

"use strict";

const repo = require("./cart.repo");
const { transaction, query } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");
const { VALID } = require("../../config/brands");
// PR 2 — the single typed authority for Care & Accessories SKUs (gate,
// publication, exact variant, live price, sellable stock).
const retailResolver = require("../catalogue/retail-resolver");
// Reuse the catalogue composers for the styled snapshot price — never re-derive
// pricing here. (Snapshots are display-only; checkout re-prices server-side.)
const styledRepo = require("../catalogue/styled.repo");
const styledVariantsRepo = require("../catalogue/styled_variants.repo");
const bundleService = require("../retention/bundle.service");
const {
  computeAvailability,
  reduceBundleAvailability,
} = require("../catalogue/availability");
const { logger } = require("../../config/logger");

function assertBrand(business) {
  if (!VALID.has(business))
    throw new AppError("INVALID_BRAND", `Unknown brand: ${business}`, 400);
}

// ── Cart lifecycle ─────────────────────────────────────────

async function getCart({ business, contact_id, session_token }) {
  assertBrand(business);
  let cart = null;
  if (contact_id) {
    cart = await repo.findActiveCart({ business, contact_id });
  } else if (session_token) {
    cart = await repo.findCartBySession({ business, session_token });
  }
  if (!cart) return null;
  const items = await repo.listCartItems({ cart_id: cart.cart_id });
  await attachCartAvailability({ brand: business, items });
  return { ...cart, items };
}

/**
 * Tag each cart line with its in-stock / pre-order / sold-out state (000086),
 * resolved to the base product behind the line (styled variant → its base,
 * base variant → its product, bundle → reduce over components). Best-effort and
 * mutates the items in place: a resolution failure just leaves `availability`
 * off so the bag still renders. Batches one read per line-kind + the brand
 * policy, reusing the shared computeAvailability / reduceBundleAvailability so a
 * bag line's badge matches the shop grid and bundle pages.
 */
async function attachCartAvailability({ brand, items }) {
  if (!items || !items.length) return items;
  try {
    const cfg = await styledVariantsRepo.getConfig({ brand }).catch(() => null);
    const policy = {
      enabled: cfg ? cfg.preorder_enabled : true,
      min_weeks: cfg ? cfg.preorder_min_weeks : 4,
      max_weeks: cfg ? cfg.preorder_max_weeks : 8,
    };
    const uniq = (xs) => [...new Set(xs)];
    const svIds = uniq(
      items.filter((i) => i.styled_variant_id).map((i) => i.styled_variant_id),
    );
    const bvIds = uniq(
      items
        .filter((i) => !i.styled_variant_id && !i.bundle_id && i.variant_id)
        .map((i) => i.variant_id),
    );
    const bIds = uniq(items.filter((i) => i.bundle_id).map((i) => i.bundle_id));

    const [svRows, bvRows, bcRows] = await Promise.all([
      repo.styledVariantBaseAvailability({ brand, styled_variant_ids: svIds }),
      repo.baseVariantAvailability({ brand, variant_ids: bvIds }),
      repo.bundleComponentAvailability({ brand, bundle_ids: bIds }),
    ]);
    const svMap = new Map(svRows.map((r) => [r.styled_variant_id, r]));
    const bvMap = new Map(bvRows.map((r) => [r.variant_id, r]));
    const bcMap = new Map();
    for (const r of bcRows) {
      const arr = bcMap.get(r.bundle_id) || [];
      arr.push(r);
      bcMap.set(r.bundle_id, arr);
    }
    // A resolvable base row → computeAvailability; an unresolvable line (deleted
    // variant, etc.) gets no badge rather than a spurious pre-order.
    const availFrom = (row) =>
      row
        ? computeAvailability(row.base_available, {
            base: {
              preorder_enabled: row.preorder_enabled,
              preorder_excluded: row.preorder_excluded,
              expected_ready_date: row.expected_ready_date,
              production_lead_days: row.production_lead_days,
            },
            policy,
          })
        : null;

    for (const it of items) {
      if (it.styled_variant_id) {
        it.availability = availFrom(svMap.get(it.styled_variant_id));
      } else if (it.bundle_id) {
        const parts = (bcMap.get(it.bundle_id) || [])
          .map((row) => availFrom(row))
          .filter(Boolean);
        it.availability = parts.length ? reduceBundleAvailability(parts) : null;
      } else if (it.variant_id) {
        it.availability = availFrom(bvMap.get(it.variant_id));
      } else {
        it.availability = null;
      }
    }
  } catch (err) {
    logger.warn(
      { err: err.message },
      "cart availability enrich failed (cart stands)",
    );
  }
  return items;
}

async function getOrCreateCart({
  business,
  contact_id,
  session_token,
  display_currency,
}) {
  assertBrand(business);
  let cart = null;
  if (contact_id) {
    cart = await repo.findActiveCart({ business, contact_id });
  } else if (session_token) {
    cart = await repo.findCartBySession({ business, session_token });
  }
  if (!cart) {
    cart = await repo.createCart({
      business,
      contact_id,
      session_token,
      display_currency,
    });
  }
  const items = await repo.listCartItems({ cart_id: cart.cart_id });
  return { ...cart, items };
}

async function addItem({ business, cart_id, item, publicStorefront = false }) {
  assertBrand(business);
  const cart = await repo.findCartById({ id: cart_id });
  if (!cart || cart.business !== business || cart.status !== "active")
    throw new NotFoundError("Cart");

  // Classify the variant first: a Care & Accessories SKU takes the typed
  // resolver path; anything else stays on the repaired legacy variant path.
  const { rows: roleRows } = await query(
    `SELECT p.catalogue_role
       FROM ${business}.product_variants pv
       JOIN ${business}.products p ON p.product_id = pv.product_id
      WHERE pv.variant_id = $1`,
    [item.variant_id],
  );

  if (roleRows[0] && roleRows[0].catalogue_role === "retail") {
    // Typed retail path (PR 2). The resolver is fail-closed: gate off,
    // unpublished, archived, trashed, wrong-role, unpriced or forged ids all
    // 404 — nothing enters the bag that the typed checkout cannot sell.
    const r = await retailResolver.resolveSellableVariant({
      brand: business,
      variant_id: item.variant_id,
      product_id: item.product_id || null,
      channel: "storefront",
    });
    const qty = Math.max(1, parseInt(item.quantity, 10) || 1);
    if (qty > r.available)
      throw new AppError(
        "OUT_OF_STOCK",
        `Retail SKU ${r.sku} has ${r.available} sellable unit(s)`,
        409,
        {
          user_message: `${r.name}${r.variant_label ? ` (${r.variant_label})` : ""} is out of stock.`,
        },
      );
    const cartItem = await repo.upsertCartItem({
      item: {
        cart_id,
        business,
        product_id: r.product_id,
        variant_id: r.variant_id,
        quantity: qty,
        product_name_snapshot: r.name,
        variant_label_snapshot: r.variant_label || null,
        thumbnail_url_snapshot: r.image_url,
        unit_price_ngn: r.unit_price_ngn,
        unit_display_price: r.unit_price_usd ?? null,
        display_currency: item.display_currency || "NGN",
      },
    });
    await repo.updateCart({
      cart_id,
      patch: { last_interaction_at: new Date().toISOString() },
    });
    return cartItem;
  }

  if (publicStorefront)
    throw new AppError(
      "VARIANT_NOT_FOUND",
      "This item is not sold on the website",
      404,
      { user_message: "This item is no longer available." },
    );

  // Legacy base-variant path — repaired to select the REAL catalogue columns
  // (the old query referenced price_ngn / product_name / variant_label /
  // thumbnail_url / is_active, none of which exist on products/variants).
  const { rows: variants } = await query(
    `SELECT pv.variant_id,
            COALESCE(pv.price_storefront_ngn, pv.price_pos_ngn) AS price_ngn,
            p.name AS product_name, pv.variant_name AS variant_label
       FROM ${business}.product_variants pv
       JOIN ${business}.products p ON p.product_id = pv.product_id
      WHERE pv.variant_id = $1 AND pv.is_active = true AND p.is_deleted = false`,
    [item.variant_id],
  );
  const variant = variants[0];
  if (!variant)
    throw new AppError(
      "VARIANT_NOT_FOUND",
      `Variant ${item.variant_id} not found`,
      404,
    );

  const cartItem = await repo.upsertCartItem({
    item: {
      cart_id,
      business,
      product_id: item.product_id,
      variant_id: item.variant_id,
      quantity: item.quantity || 1,
      product_name_snapshot: item.product_name_snapshot || variant.product_name,
      variant_label_snapshot:
        item.variant_label_snapshot || variant.variant_label,
      thumbnail_url_snapshot: item.thumbnail_url_snapshot || null,
      unit_price_ngn: item.unit_price_ngn || variant.price_ngn,
      unit_display_price: item.unit_display_price || null,
      display_currency: item.display_currency || "NGN",
      custom_spec: item.custom_spec || null,
    },
  });
  await repo.updateCart({
    cart_id,
    patch: { last_interaction_at: new Date().toISOString() },
  });
  return cartItem;
}

/**
 * Storefront add-to-cart: accepts a STYLED variant, a BUNDLE, or a base product.
 * Snapshots name/label/thumbnail/price at add time (re-priced at checkout). The
 * styled price comes from the catalogue composer (listVariants), not re-derived.
 */
async function addStorefrontItem({
  business,
  cart_id,
  item,
  display_currency = "NGN",
}) {
  assertBrand(business);
  const cart = await repo.findCartById({ id: cart_id });
  if (!cart || cart.business !== business || cart.status !== "active")
    throw new NotFoundError("Cart");
  const cur = String(display_currency || "NGN").toUpperCase();
  const qty = Math.max(1, parseInt(item.quantity, 10) || 1);

  let line;
  if (item.bundle_id) {
    const { rows } = await query(
      `SELECT bundle_id, display_name, bundle_price_ngn, hero_image_url
         FROM ${business}.bundle_offers
        WHERE bundle_id = $1 AND is_active = true AND is_visible_storefront = true
          AND (valid_from IS NULL OR valid_from <= now())
          AND (valid_to IS NULL OR valid_to >= now())`,
      [item.bundle_id],
    );
    const b = rows[0];
    if (!b)
      throw new AppError(
        "BUNDLE_NOT_FOUND",
        "This bundle is no longer available",
        404,
      );
    // Snapshot the DECORATED effective price (correct for every pricing model,
    // not just fixed_bundle_price). Re-priced at checkout regardless.
    const decorated = await bundleService
      .getBundle({ brand: business, id: b.bundle_id })
      .catch(() => null);
    line = {
      cart_id,
      business,
      bundle_id: b.bundle_id,
      quantity: qty,
      product_name_snapshot: b.display_name,
      thumbnail_url_snapshot: b.hero_image_url || null,
      unit_price_ngn:
        decorated && decorated.effective_price_ngn != null
          ? decorated.effective_price_ngn
          : b.bundle_price_ngn || 0,
      unit_display_price: null,
      display_currency: cur,
    };
  } else if (item.styled_variant_id) {
    const { rows: r0 } = await query(
      `SELECT styled_id FROM ${business}.styled_product_variants
        WHERE styled_variant_id = $1 AND is_active = true AND is_deleted = false`,
      [item.styled_variant_id],
    );
    if (!r0[0])
      throw new AppError(
        "VARIANT_NOT_FOUND",
        "This item is no longer available",
        404,
      );
    const styled_id = r0[0].styled_id;
    const [variants, styled] = await Promise.all([
      styledVariantsRepo.listVariants({ brand: business, styled_id }),
      styledRepo.getById({ brand: business, id: styled_id }),
    ]);
    const v = variants.find(
      (x) => x.styled_variant_id === item.styled_variant_id,
    );
    if (!v || !styled || styled.is_deleted || styled.status !== "live")
      throw new AppError(
        "VARIANT_NOT_FOUND",
        "This item is no longer available",
        404,
      );
    const unstyled = !!item.unstyled;
    const ngn = unstyled
      ? Number(styled.retail_price_ngn || 0)
      : Number(v.effective_price_ngn || 0);
    const usd = unstyled
      ? styled.retail_price_usd === null
        ? styled.retail_price_usd === undefined
          ? null
          : Number(styled.retail_price_usd)
        : Number(styled.retail_price_usd)
      : v.effective_price_usd === null
        ? v.effective_price_usd === undefined
          ? null
          : Number(v.effective_price_usd)
        : Number(v.effective_price_usd);
    const label = unstyled
      ? [v.colour_name, v.size_label, "Unstyled"].filter(Boolean).join(" · ")
      : [v.colour_name, v.size_label, v.lace_label || v.lace_code]
          .filter(Boolean)
          .join(" · ");
    line = {
      cart_id,
      business,
      styled_variant_id: item.styled_variant_id,
      unstyled,
      quantity: qty,
      product_name_snapshot: styled.name,
      variant_label_snapshot: label || null,
      thumbnail_url_snapshot: styled.primary_image_url || null,
      unit_price_ngn: ngn,
      unit_display_price: cur === "USD" ? usd : null,
      display_currency: cur,
    };
  } else if (item.product_id || item.variant_id) {
    // The public storefront sells a bare variant ONLY when it is a Care &
    // Accessories SKU (typed retail path inside addItem). Hair bases are private
    // stock — never storefront-visible (000043) and usually ₦0 because a wig
    // sells through its styled record — so a guessed/leaked base variant id must
    // not enter a public bag. (The authenticated staff cart keeps addItem's
    // legacy base path.)
    return addItem({ business, cart_id, item, publicStorefront: true });
  } else {
    throw new AppError("CART_ITEM_INVALID", "Nothing to add to the cart", 422);
  }

  const cartItem = await repo.upsertCartItem({ item: line });
  await repo.updateCart({
    cart_id,
    patch: { last_interaction_at: new Date().toISOString() },
  });
  return cartItem;
}

async function updateItem({ business, cart_id, cart_item_id, quantity }) {
  assertBrand(business);
  const cart = await repo.findCartById({ id: cart_id });
  if (!cart || cart.business !== business || cart.status !== "active")
    throw new NotFoundError("Cart");
  if (!Number.isFinite(quantity) || quantity <= 0) {
    await repo.removeCartItem({ cart_id, cart_item_id });
    await repo.updateCart({
      cart_id,
      patch: { last_interaction_at: new Date().toISOString() },
    });
    return null;
  }
  const existing = await repo.findCartItem({ cart_id, cart_item_id });
  if (!existing) throw new NotFoundError("Cart item");
  // Care & Accessories are stock-only: the add path refuses more than the
  // sellable shelf holds, so the quantity stepper must too (no back-order).
  if (existing.variant_id && !existing.styled_variant_id && !existing.bundle_id) {
    const live = await retailResolver
      .resolveSellableVariants({
        brand: business,
        variant_ids: [existing.variant_id],
        channel: "storefront",
      })
      .catch(() => new Map());
    const r = live.get(existing.variant_id);
    if (r && quantity > r.available)
      throw new AppError(
        "OUT_OF_STOCK",
        `Retail SKU ${r.sku} has ${r.available} sellable unit(s)`,
        409,
        {
          user_message: `Only ${r.available} of ${r.name}${r.variant_label ? ` (${r.variant_label})` : ""} left in stock.`,
        },
      );
  }
  const updated = await repo.updateCartItemQuantity({
    cart_id,
    cart_item_id,
    quantity,
  });
  if (!updated) throw new NotFoundError("Cart item");
  await repo.updateCart({
    cart_id,
    patch: { last_interaction_at: new Date().toISOString() },
  });
  return updated;
}

async function removeItem({ business, cart_id, cart_item_id }) {
  assertBrand(business);
  const cart = await repo.findCartById({ id: cart_id });
  if (!cart || cart.business !== business || cart.status !== "active")
    throw new NotFoundError("Cart");
  await repo.removeCartItem({ cart_id, cart_item_id });
  await repo.updateCart({
    cart_id,
    patch: { last_interaction_at: new Date().toISOString() },
  });
}

async function clearCart({ business, cart_id }) {
  assertBrand(business);
  const cart = await repo.findCartById({ id: cart_id });
  if (!cart || cart.business !== business) throw new NotFoundError("Cart");
  await repo.clearCartItems({ cart_id });
  await repo.updateCart({
    cart_id,
    patch: {
      last_interaction_at: new Date().toISOString(),
      applied_coupon_id: null,
    },
  });
}

async function mergeGuestCart({ business, guest_cart_id, contact_id }) {
  assertBrand(business);
  return transaction(async (client) => {
    const guestCart = await repo.findCartById({ client, id: guest_cart_id });
    if (
      !guestCart ||
      guestCart.business !== business ||
      guestCart.status !== "active"
    )
      return null;
    const guestItems = await repo.listCartItems({
      client,
      cart_id: guest_cart_id,
    });
    if (!guestItems.length) {
      await repo.updateCart({
        client,
        cart_id: guest_cart_id,
        patch: { status: "expired" },
      });
      return null;
    }
    const customerCart =
      (await repo.findActiveCart({ client, business, contact_id })) ||
      (await repo.createCart({ client, business, contact_id }));

    for (const gi of guestItems) {
      await repo.upsertCartItem({
        client,
        item: { ...gi, cart_id: customerCart.cart_id },
      });
    }
    await repo.updateCart({
      client,
      cart_id: guest_cart_id,
      patch: { status: "expired" },
    });
    const items = await repo.listCartItems({
      client,
      cart_id: customerCart.cart_id,
    });
    return { ...customerCart, items };
  });
}

async function applyCoupon({ business, cart_id, coupon_code, contact_id }) {
  assertBrand(business);
  const cart = await repo.findCartById({ id: cart_id });
  if (!cart || cart.business !== business || cart.status !== "active")
    throw new NotFoundError("Cart");

  // Read-only validation (redemption happens at checkout via createOrder).
  // P0-4: this used to require validateCoupon from retention.service, which
  // never exported it — every attach threw a 500. Coupon validation lives
  // in coupon.service; validateCoupon returns { valid, reason?, coupon? }
  // and NEVER throws for a bad code, so we surface the reason cleanly.
  const couponService = require("../retention/coupon.service");
  const result = await couponService.validateCoupon({
    brand: business,
    code: coupon_code,
    contact_id: contact_id || null,
  });
  if (!result.valid) {
    throw new AppError(
      "COUPON_INVALID",
      `Coupon not applicable: ${result.reason || "unknown"}`,
      409,
      {
        user_message:
          "That code isn't valid on this cart. Please double-check it and try again.",
      },
    );
  }
  await repo.updateCart({
    cart_id,
    patch: { applied_coupon_id: result.coupon.coupon_id },
  });
  const items = await repo.listCartItems({ cart_id });
  return {
    ...cart,
    applied_coupon_id: result.coupon.coupon_id,
    applied_coupon_code: result.coupon.coupon_code,
    items,
  };
}

// ── Wishlist ───────────────────────────────────────────────

async function listWishlist({ business, contact_id }) {
  assertBrand(business);
  return repo.listWishlistItems({ contact_id, business });
}

async function addToWishlist({ business, contact_id, item }) {
  assertBrand(business);
  // Confirm variant exists (real catalogue columns — the old query selected
  // price_ngn / product_name / variant_label / thumbnail_url, which don't
  // exist). Retail SKUs are wishlisted through the same variant rail.
  const { rows } = await query(
    `SELECT pv.variant_id,
            COALESCE(pv.price_storefront_ngn, pv.price_pos_ngn) AS price_ngn,
            p.name AS product_name, pv.variant_name AS variant_label
       FROM ${business}.product_variants pv
       JOIN ${business}.products p ON p.product_id = pv.product_id
      WHERE pv.variant_id = $1`,
    [item.variant_id],
  );
  const variant = rows[0];
  if (!variant)
    throw new AppError(
      "VARIANT_NOT_FOUND",
      `Variant ${item.variant_id} not found`,
      404,
    );

  return repo.addWishlistItem({
    item: {
      contact_id,
      business,
      variant_id: item.variant_id,
      product_name_snapshot: variant.product_name,
      variant_label_snapshot: variant.variant_label,
      thumbnail_url_snapshot: null,
      price_ngn_at_add: variant.price_ngn,
    },
  });
}

async function removeFromWishlist({ business, contact_id, variant_id }) {
  assertBrand(business);
  const removed = await repo.removeWishlistItem({
    contact_id,
    business,
    variant_id,
  });
  if (!removed) throw new NotFoundError("Wishlist item");
  return removed;
}

module.exports = {
  getCart,
  getOrCreateCart,
  addItem,
  addStorefrontItem,
  updateItem,
  removeItem,
  clearCart,
  mergeGuestCart,
  applyCoupon,
  listWishlist,
  addToWishlist,
  removeFromWishlist,
};
