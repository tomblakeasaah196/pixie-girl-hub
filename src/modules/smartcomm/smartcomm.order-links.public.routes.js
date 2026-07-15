/**
 * Order link — public checkout routes.
 *
 * Mounted at /api/public/order-link. The link is a short, unguessable slug
 * (`/o/<slug>`); the slug IS the authorisation boundary — an unknown slug
 * simply resolves to nothing. These endpoints:
 *   - GET /:slug         → the checkout context (brand, resolved items,
 *                          contact + delivery-address pre-fill, catalogue
 *                          USD rate, expiry). Records the customer "opened
 *                          your link" thread line. Ordered links return the
 *                          order outcome instead of a form.
 *   - POST /:slug/activity → the customer's live selection, so the team's
 *                          sidebar panel updates while they browse.
 *
 * We include the contact's first name + delivery address so the page can
 * say "Hi Ada — shipping to 12 Admiralty Way" without a re-fill. Nothing
 * here exposes an unrelated contact — only the contact bound to the slug.
 */

"use strict";

const express = require("express");
const orderLinks = require("./smartcomm.order-links.service");

const router = express.Router();

router.get("/:slug", async (req, res, next) => {
  try {
    const ctx = await orderLinks.getPublicContext(req.params.slug);
    res.json(ctx);
  } catch (err) {
    next(err);
  }
});

// Live-cart reporting from the public page. The hourly throttle lives
// server-side so a browsing customer never floods the thread. Always 204 —
// activity must never break the shopper.
router.post("/:slug/activity", async (req, res) => {
  try {
    const cart = req.body && req.body.cart;
    if (Array.isArray(cart)) {
      const slim = cart.slice(0, 30).map((c) => ({
        kind: String(c.kind || "base").slice(0, 12),
        ref_id: c.ref_id || null,
        name: String(c.name || "").slice(0, 160),
        qty: Math.max(1, Math.min(100, Number(c.qty) || 1)),
        price_ngn:
          c.price_ngn !== null && c.price_ngn !== undefined
            ? String(c.price_ngn).slice(0, 20)
            : null,
      }));
      await orderLinks.recordCartBySlug({ slug: req.params.slug, cart: slim });
    }
  } catch {
    // unknown slug or DB hiccup — silently ignore
  }
  res.status(204).end();
});

module.exports = router;
