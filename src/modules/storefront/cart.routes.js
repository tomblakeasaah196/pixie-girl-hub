/**
 * Cart & Wishlist (V2.2 §6.4) — routes.
 * Mounted at /api/v1/cart (cart) and /api/v1/wishlist (wishlist).
 *
 * Cart: auth required; business resolved from X-Brand-Context header.
 * Wishlist: auth required.
 *
 * No separate permission key — every authenticated user can manage their
 * own cart and wishlist.
 */

"use strict";

const express = require("express");
const cartService = require("./cart.service");

// ── Cart router ────────────────────────────────────────────
const cartRouter = express.Router();

cartRouter.get("/", async (req, res) => {
  const cart = await cartService.getOrCreateCart({
    business: req.brand,
    contact_id: req.user.contact_id || req.user.user_id,
    session_token: req.headers["x-session-token"],
    display_currency: req.query.currency,
  });
  res.json({ data: cart });
});

cartRouter.post("/items", async (req, res) => {
  const cart = await cartService.getOrCreateCart({
    business: req.brand,
    contact_id: req.user.contact_id || req.user.user_id,
    session_token: req.headers["x-session-token"],
  });
  const item = await cartService.addItem({
    business: req.brand,
    cart_id: cart.cart_id,
    item: req.body,
  });
  res.status(201).json({ data: item });
});

cartRouter.put("/items/:itemId", async (req, res) => {
  const { quantity } = req.body;
  if (quantity === undefined)
    return res.status(400).json({ error: "quantity required" });
  const cart = await cartService.getOrCreateCart({
    business: req.brand,
    contact_id: req.user.contact_id || req.user.user_id,
    session_token: req.headers["x-session-token"],
  });
  const updated = await cartService.updateItem({
    business: req.brand,
    cart_id: cart.cart_id,
    cart_item_id: req.params.itemId,
    quantity: parseInt(quantity, 10),
  });
  res.json({ data: updated });
});

cartRouter.delete("/items/:itemId", async (req, res) => {
  const cart = await cartService.getOrCreateCart({
    business: req.brand,
    contact_id: req.user.contact_id || req.user.user_id,
    session_token: req.headers["x-session-token"],
  });
  await cartService.removeItem({
    business: req.brand,
    cart_id: cart.cart_id,
    cart_item_id: req.params.itemId,
  });
  res.json({ data: { removed: true } });
});

cartRouter.delete("/", async (req, res) => {
  const cart = await cartService.getOrCreateCart({
    business: req.brand,
    contact_id: req.user.contact_id || req.user.user_id,
    session_token: req.headers["x-session-token"],
  });
  await cartService.clearCart({ business: req.brand, cart_id: cart.cart_id });
  res.json({ data: { cleared: true } });
});

cartRouter.post("/apply-coupon", async (req, res) => {
  const { coupon_code } = req.body;
  if (!coupon_code)
    return res.status(400).json({ error: "coupon_code required" });
  const cart = await cartService.getOrCreateCart({
    business: req.brand,
    contact_id: req.user.contact_id || req.user.user_id,
    session_token: req.headers["x-session-token"],
  });
  const updated = await cartService.applyCoupon({
    business: req.brand,
    cart_id: cart.cart_id,
    coupon_code,
  });
  res.json({ data: updated });
});

cartRouter.post("/merge", async (req, res) => {
  const { guest_cart_id } = req.body;
  if (!guest_cart_id)
    return res.status(400).json({ error: "guest_cart_id required" });
  const contact_id = req.user.contact_id || req.user.user_id;
  const merged = await cartService.mergeGuestCart({
    business: req.brand,
    guest_cart_id,
    contact_id,
  });
  res.json({ data: merged });
});

// ── Wishlist router ────────────────────────────────────────
const wishlistRouter = express.Router();

wishlistRouter.get("/", async (req, res) => {
  const items = await cartService.listWishlist({
    business: req.brand,
    contact_id: req.user.contact_id || req.user.user_id,
  });
  res.json({ data: items });
});

wishlistRouter.post("/", async (req, res) => {
  const item = await cartService.addToWishlist({
    business: req.brand,
    contact_id: req.user.contact_id || req.user.user_id,
    item: req.body,
  });
  res.status(201).json({ data: item });
});

wishlistRouter.delete("/:variantId", async (req, res) => {
  const removed = await cartService.removeFromWishlist({
    business: req.brand,
    contact_id: req.user.contact_id || req.user.user_id,
    variant_id: req.params.variantId,
  });
  res.json({ data: removed });
});

module.exports = { cartRouter, wishlistRouter };
