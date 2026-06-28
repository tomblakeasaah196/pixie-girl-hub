/**
 * Storefront checkout — PUBLIC (no auth, guest-first).
 * Mounted at /api/public/storefront/checkout.
 *
 * Loads the persistent cart (sf_cart cookie for guests / contact for members),
 * then hands off to storefront.service.checkout() which mirrors the proven sale
 * sequence: contact + address upsert → server-priced order lines → fail-closed
 * delivery quote → salesService.createOrder (channel 'storefront') → currency
 * snapshot → payment link. The order flows through the same outbox as every
 * channel, so it lands in Sales → Orders and fires invoicing/accounting/etc.
 *
 * This is the WEBSITE checkout. It is NOT the Sales Campaign Landing checkout.
 */

"use strict";

const express = require("express");
const cartService = require("./cart.service");
const storefrontService = require("./storefront.service");
const { VALID_BRANDS } = require("../../config/brands");
const { AppError } = require("../../utils/errors");

const router = express.Router();

function brandHint(req) {
  const h = req.brand || req.headers["x-brand-context"] || req.query.brand;
  return VALID_BRANDS.has(h) ? h : "pixiegirl";
}

router.post("/", async (req, res, next) => {
  try {
    const business = brandHint(req);
    const contact_id = req.customer?.contact_id || null;
    const session_token = contact_id ? null : req.cookies?.sf_cart || null;
    const cart = await cartService.getCart({
      business,
      contact_id,
      session_token,
    });
    if (!cart || !cart.items || !cart.items.length)
      throw new AppError("EMPTY_CART", "Your cart is empty.", 400);

    // Build the storefront return URL from the incoming host so the gateway
    // sends the buyer back to OUR thank-you page (not the Hub default).
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const proto = req.headers["x-forwarded-proto"] || "https";
    const returnUrlBase = host
      ? `${proto}://${host}/checkout/thank-you`
      : undefined;

    const result = await storefrontService.checkout({
      brand: business,
      cart_id: cart.cart_id,
      input: { ...req.body, return_url_base: returnUrlBase },
    });
    res.status(201).json({ data: result });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
