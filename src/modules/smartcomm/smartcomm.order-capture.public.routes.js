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
const { query } = require("../../config/database");
const { AppError, NotFoundError } = require("../../utils/errors");

const router = express.Router();

async function fetchPrefillContext(decoded) {
  const { rows: contacts } = await query(
    `SELECT contact_id, display_name, first_name, last_name,
            primary_phone, whatsapp_number, email
       FROM shared.contacts WHERE contact_id = $1 AND is_deleted = false`,
    [decoded.contact_id],
  );
  const contact = contacts[0];
  if (!contact) throw new NotFoundError("Contact");

  const { rows: addresses } = await query(
    `SELECT line1, line2, area, city, state, country, country_code,
            postal_code, landmark, recipient_name, recipient_phone,
            latitude, longitude
       FROM shared.contact_addresses
      WHERE contact_id = $1 AND address_type = 'delivery'
      ORDER BY is_default DESC, updated_at DESC
      LIMIT 1`,
    [contact.contact_id],
  );

  // Hydrate item rows with name + image where available. Per CLAUDE.md
  // products live in the brand schema, so we use the brand carried in
  // the token.
  const items = [];
  if (decoded.brand && Array.isArray(decoded.items)) {
    const schema = `"${decoded.brand}"`;
    for (const it of decoded.items) {
      try {
        const { rows: prows } = await query(
          `SELECT product_id, name, product_code, primary_image_url
             FROM ${schema}.products
            WHERE product_id = $1`,
          [it.product_id],
        );
        const p = prows[0];
        // The public order form is keyed by variant_id, not product_id.
        // Resolve to the default (first) variant so the consumer page can
        // submit without exposing variant complexity to the staffer who
        // generated the capture link.
        let variant_id = null;
        try {
          const { rows: vrows } = await query(
            `SELECT variant_id FROM ${schema}.product_variants
              WHERE product_id = $1
              ORDER BY created_at ASC
              LIMIT 1`,
            [it.product_id],
          );
          variant_id = vrows[0] ? vrows[0].variant_id : null;
        } catch {
          /* schema variants table may not exist for legacy brands */
        }
        items.push({
          product_id: it.product_id,
          variant_id,
          qty: it.qty,
          price_ngn: it.price_ngn || null,
          note: it.note || null,
          name: p ? p.name : null,
          product_code: p ? p.product_code : null,
          image_url: p ? p.primary_image_url : null,
        });
      } catch {
        items.push({ ...it, name: null, product_code: null, image_url: null });
      }
    }
  }

  return {
    brand: decoded.brand,
    sales_channel: decoded.sales_channel,
    expires_at: new Date(decoded.exp * 1000).toISOString(),
    contact: {
      contact_id: contact.contact_id,
      first_name: contact.first_name || (contact.display_name || "").split(" ")[0] || null,
      last_name: contact.last_name || null,
      display_name: contact.display_name,
      primary_phone: contact.primary_phone,
      whatsapp_number: contact.whatsapp_number,
      email: contact.email,
    },
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
    const ctx = await fetchPrefillContext(decoded);
    res.json(ctx);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
