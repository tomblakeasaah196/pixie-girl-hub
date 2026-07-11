/**
 * Order Capture — public verifier route.
 *
 * Mounted at /api/public/order-capture/verify. Token-protected: the JWT
 * itself IS the auth boundary, so this endpoint:
 *   - decodes + signature-verifies the token,
 *   - rejects expired/tampered tokens with the same error codes as the
 *     authenticated minter,
 *   - looks up the contact behind the token so the storefront / consumer
 *     page can pre-fill name + delivery address from
 *     `contact_addresses` (default delivery row),
 *   - resolves each item (base product / styled product / bundle) down
 *     to concrete `product_variants` lines the public order-form's
 *     existing `{variant_id, quantity}` contract already understands,
 *   - returns a compact payload safe to render publicly.
 *
 * NEVER returns full PII for an unrelated contact — the token is the
 * authorisation, and a forged token fails the JWT verifier. We DO
 * include the contact's first name + delivery address so the page can
 * say "Hi Ada — shipping to 12 Admiralty Way" without forcing a re-fill.
 */

"use strict";

const express = require("express");
const orderCapture = require("./smartcomm.order-capture");
const orderLinksService = require("./smartcomm.order-links.service");
const resolvers = require("./smartcomm.order-capture.resolvers");
const { query } = require("../../config/database");
const { AppError } = require("../../utils/errors");

const router = express.Router();

async function fetchPrefillContext(decoded) {
  // Contact is optional: no-contact links collect the customer inline
  // (mirroring the Online QR welcome form) and back-fill on submit.
  let contact = null;
  if (decoded.contact_id) {
    const { rows: contacts } = await query(
      `SELECT contact_id, display_name, first_name, last_name,
              primary_phone, whatsapp_number, email
         FROM shared.contacts WHERE contact_id = $1 AND is_deleted = false`,
      [decoded.contact_id],
    );
    contact = contacts[0] || null;
  }

  const { rows: addresses } = contact
    ? await query(
        `SELECT line1, line2, area, city, state, country, country_code,
                postal_code, landmark, recipient_name, recipient_phone,
                latitude, longitude
           FROM shared.contact_addresses
          WHERE contact_id = $1 AND address_type = 'delivery'
          ORDER BY is_default DESC, updated_at DESC
          LIMIT 1`,
        [contact.contact_id],
      )
    : { rows: [] };

  // Hydrate item rows with name + image + a resolved sellable variant per
  // kind. Per CLAUDE.md products live in the brand schema, so we use the
  // brand carried in the token. Any single item failing to resolve never
  // takes the whole link down — it just surfaces as "unsupported" so the
  // rest of the order can still go through. Shared with the authenticated
  // minter so staff see the same resolution the customer will.
  const items =
    decoded.brand && Array.isArray(decoded.items)
      ? await resolvers.resolveItems(decoded.brand, decoded.items)
      : [];

  return {
    status: "active",
    brand: decoded.brand,
    mode: decoded.mode || "capture",
    link_id: decoded.link_id || null,
    sales_channel: decoded.sales_channel,
    expires_at: new Date(decoded.exp * 1000).toISOString(),
    contact: contact
      ? {
          contact_id: contact.contact_id,
          first_name:
            contact.first_name ||
            (contact.display_name || "").split(" ")[0] ||
            null,
          last_name: contact.last_name || null,
          display_name: contact.display_name,
          primary_phone: contact.primary_phone,
          whatsapp_number: contact.whatsapp_number,
          email: contact.email,
        }
      : null,
    // The page shows the inline "tell us who you are" block when no
    // contact rides the link (kills the "send the QR form first" blocker).
    require_contact_form: !contact,
    delivery_address: addresses[0] || null,
    items,
    notes: decoded.notes || null,
  };
}

router.post("/verify", async (req, res, next) => {
  try {
    const token = req.body && req.body.token;
    if (!token) {
      throw new AppError("TOKEN_REQUIRED", "Capture token is required", 400);
    }
    const decoded = orderCapture.verifyCaptureToken(token);

    // v2 tokens carry a persisted link — check its lifecycle first.
    // Ordered links are single-use: show the order outcome, not a form.
    if (decoded.link_id) {
      const link = await orderLinksService
        .recordOpen({ link_id: decoded.link_id })
        .catch(() => null);
      if (link && link.status === "ordered") {
        return res.json({
          status: "ordered",
          brand: decoded.brand,
          mode: link.mode,
          order_number: link.order_number || null,
          ordered_at: link.ordered_at || null,
        });
      }
      if (link && link.status === "revoked") {
        throw new AppError(
          "CAPTURE_REVOKED",
          "This order link was cancelled. Ask the team for a fresh one.",
          410,
        );
      }
    }

    const ctx = await fetchPrefillContext(decoded);
    res.json(ctx);
  } catch (err) {
    next(err);
  }
});

// Live-cart reporting from the public page. Token-authenticated; the
// hourly throttle lives server-side so a browsing customer never floods
// the thread. Always 204 — activity must never break the shopper.
router.post("/activity", async (req, res) => {
  try {
    const { token, cart } = req.body || {};
    if (!token) return res.status(204).end();
    const decoded = orderCapture.verifyCaptureToken(token);
    if (decoded.link_id && Array.isArray(cart)) {
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
      await orderLinksService.recordCart({
        link_id: decoded.link_id,
        cart: slim,
      });
    }
  } catch {
    // expired/tampered token or DB hiccup — silently ignore
  }
  res.status(204).end();
});

module.exports = router;
