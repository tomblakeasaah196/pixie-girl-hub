/**
 * Cart & Wishlist (V2.2 §6.4) — repository.
 * Tables live in `shared` schema (cross-brand): carts, cart_items,
 * customer_wishlists. The `business` column scopes each cart to one brand.
 */

"use strict";

const { query } = require("../../config/database");
const ex = (client) => (client ? client.query.bind(client) : query);

// ── Carts ─────────────────────────────────────────────────

async function findActiveCart({ client, business, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.carts
      WHERE business = $1 AND contact_id = $2 AND status = 'active'
      LIMIT 1`,
    [business, contact_id],
  );
  return rows[0] || null;
}

async function findCartBySession({ client, business, session_token }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.carts
      WHERE business = $1 AND session_token = $2 AND status = 'active'
      LIMIT 1`,
    [business, session_token],
  );
  return rows[0] || null;
}

async function findCartById({ client, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.carts WHERE cart_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function createCart({
  client,
  business,
  contact_id,
  session_token,
  display_currency,
}) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.carts (business, contact_id, session_token, display_currency, status)
     VALUES ($1, $2, $3, $4, 'active') RETURNING *`,
    [
      business,
      contact_id || null,
      session_token || null,
      display_currency || "NGN",
    ],
  );
  return rows[0];
}

async function listCartItems({ client, cart_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.cart_items WHERE cart_id = $1 ORDER BY added_at`,
    [cart_id],
  );
  return rows;
}

async function findCartItem({ client, cart_id, cart_item_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.cart_items WHERE cart_id = $1 AND cart_item_id = $2`,
    [cart_id, cart_item_id],
  );
  return rows[0] || null;
}

async function findCartItemByVariant({ client, cart_id, variant_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.cart_items WHERE cart_id = $1 AND variant_id = $2`,
    [cart_id, variant_id],
  );
  return rows[0] || null;
}

// Match an existing line by its SELLABLE TARGET so re-adding the same thing
// bumps quantity instead of creating a duplicate row. A storefront line is one
// of: a bundle, a styled variant (distinguished by the unstyled flag), or a
// base product variant (legacy/auth cart).
async function findCartItemByTarget({ client, cart_id, target = {} }) {
  if (target.bundle_id) {
    const { rows } = await ex(client)(
      `SELECT * FROM shared.cart_items WHERE cart_id = $1 AND bundle_id = $2`,
      [cart_id, target.bundle_id],
    );
    return rows[0] || null;
  }
  if (target.styled_variant_id) {
    const { rows } = await ex(client)(
      `SELECT * FROM shared.cart_items
        WHERE cart_id = $1 AND styled_variant_id = $2 AND unstyled = $3`,
      [cart_id, target.styled_variant_id, !!target.unstyled],
    );
    return rows[0] || null;
  }
  if (target.variant_id) {
    return findCartItemByVariant({
      client,
      cart_id,
      variant_id: target.variant_id,
    });
  }
  return null;
}

async function upsertCartItem({ client, item }) {
  const existing = await findCartItemByTarget({
    client,
    cart_id: item.cart_id,
    target: {
      styled_variant_id: item.styled_variant_id,
      bundle_id: item.bundle_id,
      variant_id: item.variant_id,
      unstyled: item.unstyled,
    },
  });
  if (existing) {
    const { rows } = await ex(client)(
      `UPDATE shared.cart_items SET quantity = quantity + $2, added_at = now()
        WHERE cart_item_id = $1 RETURNING *`,
      [existing.cart_item_id, item.quantity],
    );
    return rows[0];
  }
  const { rows } = await ex(client)(
    `INSERT INTO shared.cart_items
       (cart_id, business, product_id, variant_id, styled_variant_id, bundle_id,
        unstyled, quantity, product_name_snapshot, variant_label_snapshot,
        thumbnail_url_snapshot, unit_price_ngn, unit_display_price,
        display_currency, custom_spec)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      item.cart_id,
      item.business,
      item.product_id || null,
      item.variant_id || null,
      item.styled_variant_id || null,
      item.bundle_id || null,
      item.unstyled || false,
      item.quantity,
      item.product_name_snapshot,
      item.variant_label_snapshot || null,
      item.thumbnail_url_snapshot || null,
      item.unit_price_ngn,
      item.unit_display_price || null,
      item.display_currency || "NGN",
      item.custom_spec ? JSON.stringify(item.custom_spec) : null,
    ],
  );
  return rows[0];
}

async function updateCartItemQuantity({ client, cart_item_id, quantity }) {
  const { rows } = await ex(client)(
    `UPDATE shared.cart_items SET quantity = $2 WHERE cart_item_id = $1 RETURNING *`,
    [cart_item_id, quantity],
  );
  return rows[0] || null;
}

async function removeCartItem({ client, cart_item_id }) {
  await ex(client)(`DELETE FROM shared.cart_items WHERE cart_item_id = $1`, [
    cart_item_id,
  ]);
}

async function clearCartItems({ client, cart_id }) {
  await ex(client)(`DELETE FROM shared.cart_items WHERE cart_id = $1`, [
    cart_id,
  ]);
}

async function updateCart({ client, cart_id, patch }) {
  const sets = [];
  const params = [cart_id];
  let i = 2;
  if (patch.applied_coupon_id !== undefined) {
    sets.push(`applied_coupon_id = $${i++}`);
    params.push(patch.applied_coupon_id);
  }
  if (patch.status !== undefined) {
    sets.push(`status = $${i++}`);
    params.push(patch.status);
  }
  if (patch.abandoned_at !== undefined) {
    sets.push(`abandoned_at = $${i++}`);
    params.push(patch.abandoned_at);
  }
  if (patch.last_interaction_at !== undefined) {
    sets.push(`last_interaction_at = $${i++}`);
    params.push(patch.last_interaction_at);
  }
  if (patch.converted_order_id !== undefined) {
    sets.push(`converted_order_id = $${i++}`);
    params.push(patch.converted_order_id);
  }
  if (patch.contact_id !== undefined) {
    sets.push(`contact_id = $${i++}`);
    params.push(patch.contact_id);
  }
  if (!sets.length) return findCartById({ client, id: cart_id });
  const { rows } = await ex(client)(
    `UPDATE shared.carts SET ${sets.join(",")} WHERE cart_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Wishlists ─────────────────────────────────────────────

async function listWishlistItems({ client, contact_id, business }) {
  const where = ["contact_id = $1", "removed_at IS NULL"];
  const params = [contact_id];
  let i = 2;
  if (business) {
    where.push(`business = $${i++}`);
    params.push(business);
  }
  const { rows } = await ex(client)(
    `SELECT * FROM shared.customer_wishlists WHERE ${where.join(" AND ")} ORDER BY added_at DESC`,
    params,
  );
  return rows;
}

async function findWishlistItem({ client, contact_id, business, variant_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.customer_wishlists
      WHERE contact_id = $1 AND business = $2 AND variant_id = $3 AND removed_at IS NULL`,
    [contact_id, business, variant_id],
  );
  return rows[0] || null;
}

async function addWishlistItem({ client, item }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.customer_wishlists
       (contact_id, business, variant_id, product_name_snapshot, variant_label_snapshot,
        thumbnail_url_snapshot, price_ngn_at_add, display_price_at_add, display_currency_at_add)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (contact_id, business, variant_id) DO UPDATE
       SET removed_at = NULL, added_at = now()
     RETURNING *`,
    [
      item.contact_id,
      item.business,
      item.variant_id,
      item.product_name_snapshot,
      item.variant_label_snapshot || null,
      item.thumbnail_url_snapshot || null,
      item.price_ngn_at_add || null,
      item.display_price_at_add || null,
      item.display_currency_at_add || "NGN",
    ],
  );
  return rows[0];
}

async function removeWishlistItem({
  client,
  contact_id,
  business,
  variant_id,
}) {
  const { rows } = await ex(client)(
    `UPDATE shared.customer_wishlists
       SET removed_at = now(), removed_reason = 'customer_removed'
      WHERE contact_id = $1 AND business = $2 AND variant_id = $3 AND removed_at IS NULL
     RETURNING *`,
    [contact_id, business, variant_id],
  );
  return rows[0] || null;
}

module.exports = {
  findActiveCart,
  findCartBySession,
  findCartById,
  createCart,
  listCartItems,
  findCartItem,
  findCartItemByVariant,
  findCartItemByTarget,
  upsertCartItem,
  updateCartItemQuantity,
  removeCartItem,
  clearCartItems,
  updateCart,
  listWishlistItems,
  findWishlistItem,
  addWishlistItem,
  removeWishlistItem,
};
