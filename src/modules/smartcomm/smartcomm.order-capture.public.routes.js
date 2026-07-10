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
const { query } = require("../../config/database");
const { AppError } = require("../../utils/errors");

const router = express.Router();

/** Default sellable variant for a base product: prefer the flagged
 *  default, else the oldest active row — mirrors the convention used
 *  across catalogue/bundle/cart resolution elsewhere in the codebase. */
async function defaultVariant(schema, product_id) {
  const { rows } = await query(
    `SELECT variant_id, price_storefront_ngn, price_pos_ngn
       FROM ${schema}.product_variants
      WHERE product_id = $1 AND is_active = true
      ORDER BY is_default DESC, created_at ASC
      LIMIT 1`,
    [product_id],
  );
  return rows[0] || null;
}

/** Resolve a `kind: 'base'` item into one sellable line. */
async function resolveBaseItem(schema, it) {
  const { rows } = await query(
    `SELECT p.product_id, p.name, p.product_code,
            (SELECT pi.cdn_url FROM ${schema}.product_images pi
              WHERE pi.product_id = p.product_id
              ORDER BY pi.is_primary DESC, pi.display_order LIMIT 1) AS primary_image_url
       FROM ${schema}.products p
      WHERE p.product_id = $1 AND p.is_active = true`,
    [it.product_id],
  );
  const p = rows[0];
  const v = await defaultVariant(schema, it.product_id);
  return {
    kind: "base",
    ref_id: it.product_id,
    name: p ? p.name : null,
    product_code: p ? p.product_code : null,
    image_url: p ? p.primary_image_url : null,
    qty: it.qty,
    price_ngn: it.price_ngn || null,
    note: it.note || null,
    lines: v ? [{ variant_id: v.variant_id, quantity: it.qty }] : [],
  };
}

/** Resolve a `kind: 'styled'` item. A styled product sells through the
 *  base product's stock variant — the pinned one when the styled record
 *  has it, else the base's default variant (mirrors the ERP-wide
 *  product-search resolver in apps/admin/src/lib/product-search.ts). */
async function resolveStyledItem(business, it) {
  const styledRepo = require("../catalogue/styled.repo");
  const styled = await styledRepo.getById({ brand: business, id: it.styled_id });
  const schema = `"${business}"`;
  if (!styled || styled.is_deleted || styled.status !== "live") {
    return {
      kind: "styled",
      ref_id: it.styled_id,
      name: null,
      product_code: null,
      image_url: null,
      qty: it.qty,
      price_ngn: it.price_ngn || null,
      note: it.note || null,
      lines: [],
    };
  }
  let variant_id = styled.base_variant_id || null;
  if (!variant_id) {
    const v = await defaultVariant(schema, styled.base_product_id);
    variant_id = v ? v.variant_id : null;
  }
  return {
    kind: "styled",
    ref_id: it.styled_id,
    name: styled.name,
    product_code: styled.styled_code,
    image_url: styled.primary_image_url || null,
    qty: it.qty,
    price_ngn: it.price_ngn || String(styled.retail_price_ngn ?? ""),
    note: it.note || null,
    lines: variant_id ? [{ variant_id, quantity: it.qty }] : [],
  };
}

/** Resolve a `kind: 'bundle'` item into its component lines. A bundle
 *  only resolves cleanly when EVERY component maps to a stocked base
 *  product; if any component can't resolve (e.g. a styled sub-component
 *  with no pinned variant) the whole bundle is left unsupported rather
 *  than shipping a partial order silently. */
async function resolveBundleItem(business, it) {
  const bundleService = require("../retention/bundle.service");
  const schema = `"${business}"`;
  let bundle;
  try {
    bundle = await bundleService.getBundle({ brand: business, id: it.bundle_id });
  } catch {
    bundle = null;
  }
  if (!bundle || bundle.is_active === false) {
    return {
      kind: "bundle",
      ref_id: it.bundle_id,
      name: null,
      product_code: null,
      image_url: null,
      qty: it.qty,
      price_ngn: it.price_ngn || null,
      note: it.note || null,
      lines: [],
    };
  }
  const lines = [];
  let allResolved = true;
  for (const comp of bundle.components || []) {
    let variant_id = comp.variant_id || null;
    if (!variant_id && comp.product_id) {
      const v = await defaultVariant(schema, comp.product_id);
      variant_id = v ? v.variant_id : null;
    }
    if (!variant_id) {
      allResolved = false;
      break;
    }
    lines.push({
      variant_id,
      quantity: (comp.quantity || 1) * it.qty,
    });
  }
  return {
    kind: "bundle",
    ref_id: it.bundle_id,
    name: bundle.display_name,
    product_code: bundle.bundle_code || null,
    image_url: bundle.hero_image_url || null,
    qty: it.qty,
    price_ngn:
      it.price_ngn ||
      String(bundle.effective_price_ngn ?? bundle.bundle_price_ngn ?? ""),
    note: it.note || null,
    bundle_id: it.bundle_id,
    lines: allResolved ? lines : [],
  };
}

/** Resolve a `kind: 'service'` item from the shared service catalogue.
 *  Services carry no stock variant — the checkout renders them as
 *  booking lines (requested date/time; the business confirms). */
async function resolveServiceItem(business, it) {
  const { rows } = await query(
    `SELECT service_id, name, description, base_price_ngn, duration_minutes, image_url
       FROM shared.service_offerings
      WHERE service_id = $1 AND business = $2 AND is_active = true`,
    [it.service_id, business],
  );
  const s = rows[0];
  return {
    kind: "service",
    ref_id: it.service_id,
    service_id: it.service_id,
    name: s ? s.name : null,
    product_code: null,
    image_url: s ? s.image_url : null,
    qty: it.qty,
    price_ngn: it.price_ngn || (s ? String(s.base_price_ngn) : null),
    duration_minutes: s ? s.duration_minutes : null,
    note: it.note || null,
    lines: [],
  };
}

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
  // rest of the order can still go through.
  const items = [];
  if (decoded.brand && Array.isArray(decoded.items)) {
    const schema = `"${decoded.brand}"`;
    for (const it of decoded.items) {
      try {
        if (it.kind === "styled" && it.styled_id) {
          items.push(await resolveStyledItem(decoded.brand, it));
        } else if (it.kind === "bundle" && it.bundle_id) {
          items.push(await resolveBundleItem(decoded.brand, it));
        } else if (it.kind === "service" && it.service_id) {
          items.push(await resolveServiceItem(decoded.brand, it));
        } else {
          items.push(await resolveBaseItem(schema, it));
        }
      } catch {
        items.push({
          kind: it.kind || "base",
          ref_id:
            it.product_id || it.styled_id || it.bundle_id || it.service_id || null,
          name: null,
          product_code: null,
          image_url: null,
          qty: it.qty,
          price_ngn: it.price_ngn || null,
          note: it.note || null,
          lines: [],
        });
      }
    }
  }

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
