/**
 * Persistent Storefront cart — PUBLIC (no auth, guest-first).
 * Mounted at /api/public/storefront/cart.
 *
 * The website's cart differs from the Sales Campaign Landing's client-only cart:
 * it persists in shared.carts/cart_items. Guests are identified by an httpOnly
 * `sf_cart` cookie (a random session token); when customer auth lands (Phase 3)
 * the same cart resolves by contact_id and the guest cart merges in on login.
 *
 * Brand resolves from X-Brand-Context / ?brand (host-resolved by the website).
 */

"use strict";

const express = require("express");
const { v4: uuidv4 } = require("uuid");
const cartService = require("./cart.service");
const storefrontService = require("./storefront.service");
const { VALID_BRANDS } = require("../../config/brands");
const { NotFoundError } = require("../../utils/errors");

const router = express.Router();

function brandHint(req) {
  const h = req.brand || req.headers["x-brand-context"] || req.query.brand;
  return VALID_BRANDS.has(h) ? h : "pixiegirl";
}

const COOKIE = "sf_cart";
const cookieOpts = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days (matches carts.expires_at)
  path: "/",
};

/**
 * Resolve the cart for this request. `create:true` will mint a guest session
 * token (and set the cookie) if none exists. `req.customer` is set once customer
 * auth is wired (Phase 3); until then every public cart is a guest cart.
 */
async function resolveCart(req, res, { create = false } = {}) {
  const business = brandHint(req);
  const contact_id = req.customer?.contact_id || null;
  let session_token = contact_id ? null : req.cookies?.[COOKIE] || null;
  if (!contact_id && !session_token) {
    if (!create) return { business, cart: null };
    session_token = uuidv4();
    res.cookie(COOKIE, session_token, cookieOpts);
  }
  const cart = create
    ? await cartService.getOrCreateCart({
        business,
        contact_id,
        session_token,
        display_currency: req.query.currency,
      })
    : await cartService.getCart({ business, contact_id, session_token });
  return { business, cart };
}

// Create or fetch the active cart (sets the sf_cart cookie for guests).
router.post("/", async (req, res, next) => {
  try {
    const { cart } = await resolveCart(req, res, { create: true });
    res.status(201).json({ data: cart });
  } catch (e) {
    next(e);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const { cart } = await resolveCart(req, res, { create: false });
    res.json({ data: cart || { items: [] } });
  } catch (e) {
    next(e);
  }
});

// Add a styled variant / bundle / base product.
router.post("/items", async (req, res, next) => {
  try {
    const { business, cart } = await resolveCart(req, res, { create: true });
    const item = await cartService.addStorefrontItem({
      business,
      cart_id: cart.cart_id,
      item: req.body,
      display_currency: req.body.display_currency || req.query.currency,
    });
    res.status(201).json({ data: item });
  } catch (e) {
    next(e);
  }
});

router.patch("/items/:itemId", async (req, res, next) => {
  try {
    const { business, cart } = await resolveCart(req, res, { create: false });
    if (!cart) throw new NotFoundError("Cart");
    const updated = await cartService.updateItem({
      business,
      cart_id: cart.cart_id,
      cart_item_id: req.params.itemId,
      quantity: parseInt(req.body.quantity, 10),
    });
    res.json({ data: updated });
  } catch (e) {
    next(e);
  }
});

router.delete("/items/:itemId", async (req, res, next) => {
  try {
    const { business, cart } = await resolveCart(req, res, { create: false });
    if (!cart) throw new NotFoundError("Cart");
    await cartService.removeItem({
      business,
      cart_id: cart.cart_id,
      cart_item_id: req.params.itemId,
    });
    res.json({ data: { removed: true } });
  } catch (e) {
    next(e);
  }
});

// Server-authoritative quote (subtotal, delivery, total in NGN + display ccy).
router.post("/quote", async (req, res, next) => {
  try {
    const { business, cart } = await resolveCart(req, res, { create: false });
    if (!cart)
      return res.json({
        data: { lines: [], subtotal_ngn: "0.00", total_ngn: "0.00" },
      });
    const quote = await storefrontService.quoteCart({
      brand: business,
      cart_id: cart.cart_id,
      address: req.body.address || null,
      display_currency: req.body.display_currency || req.query.currency,
    });
    res.json({ data: quote });
  } catch (e) {
    next(e);
  }
});

// Validate + attach a coupon (re-validated at checkout; never trusted for price).
router.post("/coupon", async (req, res, next) => {
  try {
    const { business, cart } = await resolveCart(req, res, { create: false });
    if (!cart) throw new NotFoundError("Cart");
    if (!req.body.code)
      return res.status(400).json({ error: { code: "CODE_REQUIRED" } });
    const updated = await cartService.applyCoupon({
      business,
      cart_id: cart.cart_id,
      coupon_code: req.body.code,
    });
    res.json({ data: updated });
  } catch (e) {
    next(e);
  }
});

// Merge the guest (sf_cart) cart into the logged-in customer's cart. Called by
// the website right after login/register. Requires a resolved customer
// (customerAuthOptional runs ahead of this router in routes/index.js).
router.post("/merge", async (req, res, next) => {
  try {
    const business = brandHint(req);
    const contact_id = req.customer ? req.customer.contact_id : null;
    if (!contact_id)
      return res
        .status(401)
        .json({ error: { code: "AUTH_REQUIRED", userMessage: "Please sign in." } });
    const session_token = req.cookies ? req.cookies[COOKIE] : null;
    if (!session_token) return res.json({ data: { merged: false } });
    const guest = await cartService.getCart({ business, session_token });
    if (!guest || !guest.cart_id) return res.json({ data: { merged: false } });
    const merged = await cartService.mergeGuestCart({
      business,
      guest_cart_id: guest.cart_id,
      contact_id,
    });
    // Guest cart consumed; drop the guest cookie so future calls use the contact.
    res.clearCookie(COOKIE, { path: "/" });
    res.json({ data: merged || { merged: true } });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
