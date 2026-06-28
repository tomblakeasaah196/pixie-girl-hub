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
// Reuse the catalogue composers for the styled snapshot price — never re-derive
// pricing here. (Snapshots are display-only; checkout re-prices server-side.)
const styledRepo = require("../catalogue/styled.repo");
const styledVariantsRepo = require("../catalogue/styled_variants.repo");
const bundleService = require("../retention/bundle.service");

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
  return { ...cart, items };
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

async function addItem({ business, cart_id, item }) {
  assertBrand(business);
  const cart = await repo.findCartById({ id: cart_id });
  if (!cart || cart.business !== business || cart.status !== "active")
    throw new NotFoundError("Cart");

  // Validate product/variant exists in this brand's catalogue.
  //const { query } = require("../../config/database");
  const { rows: variants } = await query(
    `SELECT pv.variant_id, pv.price_ngn, p.product_name, pv.variant_label, pv.thumbnail_url
       FROM ${business}.product_variants pv
       JOIN ${business}.products p ON p.product_id = pv.product_id
      WHERE pv.variant_id = $1 AND pv.is_active = true AND p.is_active = true`,
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
      thumbnail_url_snapshot:
        item.thumbnail_url_snapshot || variant.thumbnail_url,
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
    // Base product line — reuse the existing variant-validated path.
    return addItem({ business, cart_id, item });
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
  if (quantity <= 0) {
    await repo.removeCartItem({ cart_item_id });
    await repo.updateCart({
      cart_id,
      patch: { last_interaction_at: new Date().toISOString() },
    });
    return null;
  }
  const updated = await repo.updateCartItemQuantity({ cart_item_id, quantity });
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
  await repo.removeCartItem({ cart_item_id });
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

async function applyCoupon({ business, cart_id, coupon_code }) {
  assertBrand(business);
  const cart = await repo.findCartById({ id: cart_id });
  if (!cart || cart.business !== business || cart.status !== "active")
    throw new NotFoundError("Cart");

  // Validate via the retention coupons service (read-only validation, no redemption yet).
  const couponsService = require("../retention/retention.service");
  const coupon = await couponsService.validateCoupon({
    brand: business,
    code: coupon_code,
  });
  await repo.updateCart({
    cart_id,
    patch: { applied_coupon_id: coupon.coupon_id },
  });
  const items = await repo.listCartItems({ cart_id });
  return { ...cart, applied_coupon_id: coupon.coupon_id, items };
}

// ── Wishlist ───────────────────────────────────────────────

async function listWishlist({ business, contact_id }) {
  assertBrand(business);
  return repo.listWishlistItems({ contact_id, business });
}

async function addToWishlist({ business, contact_id, item }) {
  assertBrand(business);
  // Confirm variant exists
  //const { query } = require("../../config/database");
  const { rows } = await query(
    `SELECT pv.variant_id, pv.price_ngn, p.product_name, pv.variant_label, pv.thumbnail_url
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
      thumbnail_url_snapshot: variant.thumbnail_url,
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
