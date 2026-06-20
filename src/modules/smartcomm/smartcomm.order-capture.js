/**
 * Smartcomm "Order Capture" — generate a pre-filled public order link.
 *
 * Flow:
 *   1. Staff picks products + qty for the customer in the composer's
 *      Order Capture modal.
 *   2. Hub mints a short-lived signed JWT carrying { contact_id,
 *      items, sales_channel, brand }.
 *   3. URL is `${STOREFRONT_BASE_URL}/order?capture=<jwt>` (default
 *      24h expiry).
 *   4. Customer opens it on their phone — the public order form
 *      verifies the signature, pre-fills the cart + their delivery
 *      address (from contact_addresses), and the customer pays via
 *      the gateway.
 *   5. The resulting `sales_orders` row carries `sales_channel` (the
 *      DM platform the conversation originated on) and the staffer's
 *      `created_by` so commission is attributed.
 *
 * No new schema — the link is fully signed and stateless. The signing
 * key is the application JWT_SECRET. Tampering invalidates it; expired
 * tokens are rejected by the storefront's verifier.
 */

"use strict";

const jwt = require("jsonwebtoken");
const { config } = require("../../config/env");
const { audit } = require("../../middleware/audit");
const { AppError } = require("../../utils/errors");
const brandUrls = require("../../utils/brand-urls");

const DEFAULT_EXPIRY_SECONDS = 24 * 3600;

/**
 * @param {object} args
 * @param {string} args.brand
 * @param {object} args.user
 * @param {string} args.request_id
 * @param {object} args.input
 * @param {string} args.input.contact_id
 * @param {Array<{product_id:string, qty:number, price_ngn?:string|number, note?:string}>} args.input.items
 * @param {string} [args.input.sales_channel]   defaults: 'whatsapp' (callers usually pass the channel platform)
 * @param {string} [args.input.notes]
 * @param {number} [args.input.expires_in]      seconds; default 24h
 */
async function createCaptureLink({ brand, user, request_id, input }) {
  if (!input || !input.contact_id) {
    throw new AppError("CONTACT_REQUIRED", "contact_id is required", 422);
  }
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) {
    throw new AppError("ITEMS_REQUIRED", "At least one item required", 422);
  }
  for (const it of items) {
    if (!it.product_id) {
      throw new AppError("ITEM_INVALID", "Every item needs product_id", 422);
    }
    if (!it.qty || it.qty <= 0) {
      throw new AppError(
        "ITEM_INVALID",
        "Every item needs a positive qty",
        422,
      );
    }
  }

  const payload = {
    v: 1,
    brand,
    contact_id: input.contact_id,
    sales_channel: input.sales_channel || "whatsapp",
    items: items.map((it) => ({
      product_id: it.product_id,
      qty: Number(it.qty),
      price_ngn:
        it.price_ngn !== undefined && it.price_ngn !== null
          ? String(it.price_ngn)
          : undefined,
      note: it.note || undefined,
    })),
    staffer_user_id: user.user_id,
    notes: input.notes || undefined,
  };
  const expiresIn = Number(input.expires_in) || DEFAULT_EXPIRY_SECONDS;
  const token = jwt.sign(payload, config.JWT_SECRET, {
    expiresIn,
    issuer: "smartcomm",
    audience: "order-capture",
  });
  const url = await brandUrls.orderCaptureUrl(brand, token);
  const expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.order_capture.create",
    target_type: "order_capture",
    target_id: input.contact_id,
    after: {
      items_count: items.length,
      sales_channel: payload.sales_channel,
      expires_at,
    },
    request_id,
  });

  return { url, token, expires_at };
}

/**
 * Verify a capture token. Exported so the storefront's public order
 * route can call it without re-implementing the verification.
 */
function verifyCaptureToken(token) {
  try {
    return jwt.verify(token, config.JWT_SECRET, {
      issuer: "smartcomm",
      audience: "order-capture",
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw new AppError(
        "CAPTURE_EXPIRED",
        "This order link has expired. Ask the team for a fresh one.",
        410,
      );
    }
    throw new AppError("CAPTURE_INVALID", "This order link isn't valid.", 400);
  }
}

module.exports = { createCaptureLink, verifyCaptureToken };
