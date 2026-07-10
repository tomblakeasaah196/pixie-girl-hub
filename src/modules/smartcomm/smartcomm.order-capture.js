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
const orderLinksRepo = require("./smartcomm.order-links.repo");

// Owner decision (2026-07): order links live 7 days by default and die
// after a successful order (enforced via shared.smartcomm_order_links).
const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 3600;

/**
 * @param {object} args
 * @param {string} args.brand
 * @param {object} args.user
 * @param {string} args.request_id
 * @param {object} args.input
 * @param {string} args.input.contact_id
 * @param {Array<{kind?:'base'|'styled'|'bundle', product_id?:string, styled_id?:string, bundle_id?:string, qty:number, price_ngn?:string|number, note?:string}>} args.input.items
 * @param {string} [args.input.sales_channel]   defaults: 'whatsapp' (callers usually pass the channel platform)
 * @param {string} [args.input.notes]
 * @param {number} [args.input.expires_in]      seconds; default 24h
 */
async function createCaptureLink({ brand, user, request_id, input }) {
  // contact_id is optional now: checkout collects the customer inline
  // (mirroring the Online QR form) and back-fills the contact on submit.
  if (!input) {
    throw new AppError("ITEMS_REQUIRED", "At least one item required", 422);
  }
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) {
    throw new AppError("ITEMS_REQUIRED", "At least one item required", 422);
  }
  // Items may reference a base product, a styled product, or a bundle —
  // `kind` picks the field; when omitted it's inferred from whichever id
  // field is present (defaults to 'base' for backward compatibility with
  // callers that only ever sent `product_id`).
  function itemKind(it) {
    return (
      it.kind ||
      (it.styled_id
        ? "styled"
        : it.bundle_id
          ? "bundle"
          : it.service_id
            ? "service"
            : "base")
    );
  }
  function itemId(it) {
    return it.product_id || it.styled_id || it.bundle_id || it.service_id || it.id;
  }
  for (const it of items) {
    if (!itemId(it)) {
      throw new AppError(
        "ITEM_INVALID",
        "Every item needs a product_id, styled_id, bundle_id, or service_id",
        422,
      );
    }
    if (!it.qty || it.qty <= 0) {
      throw new AppError(
        "ITEM_INVALID",
        "Every item needs a positive qty",
        422,
      );
    }
  }

  const normalisedItems = items.map((it) => {
    const kind = itemKind(it);
    const id = itemId(it);
    return {
      kind,
      product_id: kind === "base" ? id : undefined,
      styled_id: kind === "styled" ? id : undefined,
      bundle_id: kind === "bundle" ? id : undefined,
      service_id: kind === "service" ? id : undefined,
      qty: Number(it.qty),
      price_ngn:
        it.price_ngn !== undefined && it.price_ngn !== null
          ? String(it.price_ngn)
          : undefined,
      note: it.note || undefined,
    };
  });
  const expiresIn = Number(input.expires_in) || DEFAULT_EXPIRY_SECONDS;
  const expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();

  // Persist first: the row is what makes the link single-use and feeds
  // the activity panel. The JWT carries the link_id so the public
  // verifier can find the row without a lookup table.
  const linkRow = await orderLinksRepo.createOrderLink({
    link: {
      business: brand,
      channel_id: input.channel_id || null,
      contact_id: input.contact_id || null,
      created_by: user.user_id,
      mode: input.mode || "capture",
      sales_channel: input.sales_channel || "whatsapp",
      items: normalisedItems,
      notes: input.notes || null,
      expires_at,
    },
  });

  const payload = {
    v: 2,
    link_id: linkRow.link_id,
    brand,
    contact_id: input.contact_id || undefined,
    channel_id: input.channel_id || undefined,
    mode: linkRow.mode,
    sales_channel: input.sales_channel || "whatsapp",
    items: normalisedItems,
    staffer_user_id: user.user_id,
    notes: input.notes || undefined,
  };
  const token = jwt.sign(payload, config.JWT_SECRET, {
    expiresIn,
    issuer: "smartcomm",
    audience: "order-capture",
  });
  const url = await brandUrls.orderCaptureUrl(brand, token);

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.order_capture.create",
    target_type: "order_capture",
    target_id: linkRow.link_id,
    after: {
      items_count: items.length,
      mode: linkRow.mode,
      contact_id: input.contact_id || null,
      sales_channel: payload.sales_channel,
      expires_at,
    },
    request_id,
  });

  return { url, token, expires_at, link_id: linkRow.link_id, mode: linkRow.mode };
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
