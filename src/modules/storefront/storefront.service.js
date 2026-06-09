/**
 * E-Commerce Storefront & Channel Sync (V2.2 §6.4) — business logic.
 *
 * Public catalogue reads, storefront analytics capture, and the no-login
 * Public Order Form (V2.2 §6.4/6.21): upsert the customer as a contact and
 * raise a sales order tagged sales_channel='public_form', returning the
 * order's public pay-link token.
 */

"use strict";

const repo = require("./storefront.repo");
const salesService = require("../sales/sales.service");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");

const SYSTEM_USER = { user_id: null };

// ── Catalogue ──────────────────────────────────────────────
function listProducts(args) {
  return repo.listProducts(args);
}

async function getProduct({ brand, slug }) {
  const product = await repo.getProductBySlug({ brand, slug });
  if (!product) throw new NotFoundError("Product");
  return product;
}

function listCategories({ brand }) {
  return repo.listCategories({ brand });
}

async function getCollection({ brand, slug }) {
  const collection = await repo.getCollectionBySlug({ brand, slug });
  if (!collection) throw new NotFoundError("Collection");
  return collection;
}

async function getContent({ brand, type, slug }) {
  const post = await repo.getContentPost({ brand, type, slug });
  if (!post) throw new NotFoundError("Content");
  return post;
}

// ── Public Order Form ──────────────────────────────────────
async function submitOrderForm({ brand, input, request_id }) {
  if (!Array.isArray(input.items) || input.items.length === 0)
    throw new AppError("NO_ITEMS", "At least one item is required", 422);

  return transaction(async (client) => {
    // 1. Upsert the customer as a contact.
    let contact = await repo.findContactByEmailOrPhone({
      client,
      email: input.email,
      phone: input.phone,
    });
    if (!contact) {
      const displayName =
        [input.first_name, input.last_name].filter(Boolean).join(" ") ||
        input.email ||
        input.phone;
      contact = await repo.createContact({
        client,
        brand,
        contact: {
          display_name: displayName,
          first_name: input.first_name,
          last_name: input.last_name,
          primary_phone: input.phone,
          email: input.email,
        },
      });
    }

    // 2. Raise the order through the Sales engine (pricing/VAT/stock are its
    //    responsibility). Tag the channel for attribution.
    const order = await salesService.createOrder({
      brand,
      user: SYSTEM_USER,
      request_id,
      input: {
        contact_id: contact.contact_id,
        sales_channel: input.sales_channel || "public_form",
        order_type: "dispatch",
        lines: input.items.map((it) => ({
          variant_id: it.variant_id,
          quantity: it.quantity,
        })),
        shipping_fee_ngn: input.shipping_fee_ngn || 0,
        utm_source: input.utm_source,
        utm_medium: input.utm_medium,
        utm_campaign: input.utm_campaign,
      },
    });

    return {
      order_id: order.order_id,
      order_number: order.order_number,
      total_ngn: order.total_ngn,
      payment_model: order.payment_model,
      public_tracking_token: order.public_tracking_token || null,
      contact_id: contact.contact_id,
    };
  });
}

// ── Analytics ──────────────────────────────────────────────
function startSession({ brand, input, ip }) {
  return repo.createSession({
    brand,
    session: { ...input, ip_address: ip },
  });
}

function recordPageView({ brand, input }) {
  return repo.recordPageView({ brand, view: input });
}

function recordFunnelEvent({ brand, input }) {
  return repo.recordFunnelEvent({ brand, event: input });
}

// ── Install Hub (V2.2 §6.10) ───────────────────────────────
/**
 * Compose the public, no-login install & care hub for an order, resolved by
 * its public_tracking_token. Pulls only existing data — the order's items,
 * matching wig-care guides, and certified stylists near the delivery city —
 * plus a pre-populated WhatsApp help link.
 */
async function getInstallHub({ token }) {
  const found = await repo.findOrderByTrackingToken({ token });
  if (!found) throw new NotFoundError("Order");
  const { brand, order } = found;

  const snapshot = order.delivery_address_snapshot || {};
  const city = snapshot.city || snapshot.town || null;

  const [careGuides, stylists] = await Promise.all([
    repo.listCareGuides({ brand }).catch(() => []),
    repo.nearbyStylists({ city }).catch(() => []),
  ]);

  return {
    order_number: order.order_number,
    items: (order.lines || []).map((l) => ({
      product_id: l.product_id,
      variant_id: l.variant_id,
      name: [l.product_name_snapshot, l.variant_label_snapshot]
        .filter(Boolean)
        .join(" — "),
    })),
    care_guides: careGuides,
    nearby_stylists: stylists,
    delivery_city: city,
    whatsapp_help_url: `https://wa.me/?text=${encodeURIComponent(
      `Hi! I need help installing my order ${order.order_number}.`,
    )}`,
    review_unlocked: false,
  };
}

module.exports = {
  listProducts,
  getProduct,
  listCategories,
  getCollection,
  getContent,
  submitOrderForm,
  startSession,
  recordPageView,
  recordFunnelEvent,
  getInstallHub,
};
