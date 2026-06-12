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
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");
const { VALID } = require("../../config/brands");

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
  const { query } = require("../../config/database");
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
  const { query } = require("../../config/database");
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
  updateItem,
  removeItem,
  clearCart,
  mergeGuestCart,
  applyCoupon,
  listWishlist,
  addToWishlist,
  removeFromWishlist,
};
