/**
 * Order-link lifecycle: mint (staff share a catalogue), public checkout
 * context (customer opens `/o/<slug>`), and customer-activity glue.
 *
 * Owner decision (2026-07-10, visibility level "c"): staff see what the
 * customer does with an order link — opened (once), selection changes
 * (throttled to one thread line per hour; the sidebar panel is always
 * live), and the placed order — as system lines in the originating
 * thread, fanned out over the existing smartcomm realtime bridge.
 *
 * The link is a persisted row keyed by a short, unguessable `public_slug`
 * (the `/o/<slug>` URL). The slug IS the authorisation boundary — a
 * forged/expired slug simply doesn't resolve to a row. The full cart
 * lives in the row (never in the URL), which is what let us shrink the
 * ~1.4 KB signed-JWT link down to ~40 chars for Instagram DMs.
 *
 * Everything activity-related is best-effort from the customer's point of
 * view — a failed system message must never break their checkout.
 */

"use strict";

const repo = require("./smartcomm.order-links.repo");
const resolvers = require("./smartcomm.order-links.resolvers");
const smartcommRepo = require("./smartcomm.repo");
const events = require("./smartcomm.events");
const brandUrls = require("../../utils/brand-urls");
const currencyService = require("../../services/currency.service");
const { audit } = require("../../middleware/audit");
const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const { formatDateTime } = require("../../utils/dates");
const { AppError } = require("../../utils/errors");

// Owner decision (2026-07): order links live 7 days by default and die
// after a successful order (enforced via shared.smartcomm_order_links).
const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 3600;

function ngn(v) {
  const n = Number(v || 0);
  return `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Item normalisation (shared by the minter) ──────────────
// Items may reference a base product, a styled product, a bundle, a service,
// or (PR 3) a Care & Accessories retail SKU; `kind` picks the field (inferred
// from whichever id is present when omitted). Styled products additionally
// carry the staff-picked head-size × lace × colour so the order is priced +
// fulfilled for that exact combination.
//
// `retail` is NEVER inferred from a bare `variant_id`: a legacy base pick may
// also carry one, and mis-inferring would route a wig through the retail
// resolver. Retail must be declared, and must carry its exact variant_id — the
// validator enforces both, so a normalised retail item always has one.
function itemKind(it) {
  if (it.kind === "retail") return "retail";
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
  return (
    it.product_id ||
    it.styled_id ||
    it.bundle_id ||
    it.service_id ||
    it.variant_id ||
    it.id
  );
}
function normaliseItems(items) {
  return items.map((it) => {
    const kind = itemKind(it);
    // Explicit per-kind field mapping. `itemId` is only the "is this item
    // identifiable at all" check in createLink — assigning it blindly would put
    // a variant_id into product_id for a base pick that carries only a variant.
    const productId =
      kind === "base" || kind === "retail"
        ? it.product_id || (kind === "base" ? it.id : undefined) || undefined
        : undefined;
    return {
      kind,
      product_id: productId,
      styled_id: kind === "styled" ? it.styled_id || it.id || undefined : undefined,
      bundle_id: kind === "bundle" ? it.bundle_id || it.id || undefined : undefined,
      service_id: kind === "service" ? it.service_id || it.id || undefined : undefined,
      // The exact sellable SKU. Kept for base picks too (previously discarded,
      // which is why a base link always sold the default variant). Mandatory
      // for retail — enforced by the validator, and re-checked by the resolver.
      variant_id:
        kind === "retail" || kind === "base"
          ? it.variant_id || undefined
          : undefined,
      // Informational only — identity is always variant_id.
      sku: kind === "retail" ? it.sku || undefined : undefined,
      qty: Number(it.qty),
      price_ngn:
        it.price_ngn !== undefined && it.price_ngn !== null
          ? String(it.price_ngn)
          : undefined,
      note: it.note || undefined,
      styled_variant_id: kind === "styled" ? it.styled_variant_id : undefined,
      size_code: kind === "styled" ? it.size_code : undefined,
      lace_code: kind === "styled" ? it.lace_code : undefined,
      colour_id: kind === "styled" ? it.colour_id : undefined,
      spec: kind === "styled" ? it.spec : undefined,
    };
  });
}

/**
 * Mint a shared-catalogue order link. Staff pick products in the composer's
 * catalogue picker; we persist the cart as a row, mint a short slug, and
 * return the `/o/<slug>` URL (on the brand's own domain) to drop into the
 * chat. The cart lives in the row — the URL only carries the slug.
 *
 * @param {object} args
 * @param {string} args.brand
 * @param {object} args.user
 * @param {string} args.request_id
 * @param {object} args.input   { contact_id?, channel_id?, items[], sales_channel?, notes?, expires_in? }
 */
async function createLink({ brand, user, request_id, input }) {
  const items = input && Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) {
    throw new AppError("ITEMS_REQUIRED", "At least one item required", 422);
  }
  for (const it of items) {
    if (!itemId(it)) {
      throw new AppError(
        "ITEM_INVALID",
        "Every item needs a product_id, styled_id, bundle_id, service_id, or variant_id",
        422,
      );
    }
    // Retail must be exact-SKU. The validator already refuses this on the HTTP
    // path; createLink is also called internally (composer quick-share), so the
    // invariant is enforced here too rather than trusted to the caller.
    if (itemKind(it) === "retail" && !it.variant_id) {
      throw new AppError(
        "ITEM_INVALID",
        "A Care & Accessories item needs its exact size/SKU (variant_id)",
        422,
      );
    }
    if (!it.qty || it.qty <= 0) {
      throw new AppError("ITEM_INVALID", "Every item needs a positive qty", 422);
    }
  }

  const normalisedItems = normaliseItems(items);
  const expiresIn = Number(input.expires_in) || DEFAULT_EXPIRY_SECONDS;
  const expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();

  // Resolve every item to its sellable variant NOW — the same resolution the
  // customer's checkout runs — so staff are warned at share time about an item
  // that can't be sold (deactivated product, non-live styled product, broken
  // bundle) instead of the customer discovering it at checkout.
  const resolved = await resolvers.resolveItems(brand, normalisedItems);
  const warnings = resolved
    .filter((r) => r.kind !== "service" && r.lines.length === 0)
    .map((r) => ({
      kind: r.kind,
      ref_id: r.ref_id,
      name: r.name,
      reason: r.unresolved_reason || "Can't be sold automatically",
    }));

  const linkRow = await repo.createOrderLink({
    link: {
      business: brand,
      channel_id: input.channel_id || null,
      contact_id: input.contact_id || null,
      created_by: user.user_id,
      mode: "shop",
      sales_channel: input.sales_channel || "whatsapp",
      items: normalisedItems,
      notes: input.notes || null,
      expires_at,
    },
  });

  const url = await brandUrls.orderLinkUrl(brand, linkRow.public_slug);

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.order_link.create",
    target_type: "order_link",
    target_id: linkRow.link_id,
    after: {
      items_count: items.length,
      contact_id: input.contact_id || null,
      sales_channel: input.sales_channel || "whatsapp",
      expires_at,
    },
    request_id,
  });

  return {
    url,
    slug: linkRow.public_slug,
    link_id: linkRow.link_id,
    expires_at,
    warnings,
  };
}

/**
 * Public checkout context for a slug — everything the `/o/<slug>` page
 * renders: brand, resolved items, contact + delivery-address pre-fill, the
 * catalogue USD rate (so the page can show a $ equivalent), and expiry.
 * Records the open (single "customer opened your link" thread line) and
 * short-circuits ordered/revoked/expired links.
 */
async function getPublicContext(slug) {
  const link = await repo.getBySlug({ slug });
  if (!link) {
    throw new AppError("LINK_INVALID", "This order link isn't valid.", 404);
  }
  if (link.status === "ordered") {
    return {
      status: "ordered",
      brand: link.business,
      order_number: link.order_number || null,
      ordered_at: link.ordered_at || null,
    };
  }
  if (link.status === "revoked") {
    throw new AppError(
      "LINK_REVOKED",
      "This order link was cancelled. Ask the team for a fresh one.",
      410,
    );
  }
  const timedOut =
    link.expires_at && new Date(link.expires_at).getTime() < Date.now();
  if (link.status === "expired" || timedOut) {
    throw new AppError(
      "LINK_EXPIRED",
      "This order link has expired. Ask the team for a fresh one.",
      410,
    );
  }

  // First open drops a thread line; refreshes only bump the counter.
  await recordOpen({ link_id: link.link_id }).catch(() => null);

  const ctx = await buildPrefillContext(link);
  return ctx;
}

/** Hydrate a link row into the public checkout payload. */
async function buildPrefillContext(link) {
  // Contact is optional: no-contact links collect the customer inline
  // (mirroring the Online QR welcome form) and back-fill on submit.
  let contact = null;
  if (link.contact_id) {
    const { rows } = await query(
      `SELECT contact_id, display_name, first_name, last_name,
              primary_phone, whatsapp_number, email
         FROM shared.contacts WHERE contact_id = $1 AND is_deleted = false`,
      [link.contact_id],
    );
    contact = rows[0] || null;
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

  const items = Array.isArray(link.items)
    ? await resolvers.resolveItems(link.business, link.items)
    : [];

  // Catalogue USD rate (NGN per $1) so the page can show "≈ $X". This is
  // the same rate the storefront settles at — set in Catalogue → Config
  // ("Apply USD exchange rate"). Null when never configured (page then
  // shows Naira only).
  let fx_rate_ngn_per_usd = null;
  try {
    fx_rate_ngn_per_usd = await currencyService.systemFxRate({
      brand: link.business,
      currency: "USD",
    });
  } catch {
    fx_rate_ngn_per_usd = null;
  }

  // PR 3: retail signals for both `/o` hosts, computed SERVER-side from the
  // resolved items so neither page has to infer them (and neither can be
  // talked into a delivery fee by a tampered client). A link carrying any
  // Care & Accessories SKU cannot quote a web delivery fee until the owner
  // approves the provisional zone fee — same fail-closed rule as the main
  // storefront cart/checkout. Pickup and staff-arranged delivery still work.
  const sellable = items.filter(
    (r) => r.kind !== "service" && Array.isArray(r.lines) && r.lines.length > 0,
  );
  const careItems = items.filter((r) => r.kind === "retail");
  const hasCare = careItems.length > 0;
  const careOnly =
    hasCare && sellable.length > 0 && sellable.every((r) => r.kind === "retail");

  return {
    status: "active",
    brand: link.business,
    slug: link.public_slug,
    link_id: link.link_id,
    sales_channel: link.sales_channel,
    expires_at: link.expires_at
      ? new Date(link.expires_at).toISOString()
      : null,
    fx_rate_ngn_per_usd,
    has_care_items: hasCare,
    care_delivery_notice: hasCare ? "EXTRA DELIVERY FEES MAY APPLY" : null,
    // Exact required wording: MAY, never WILL.
    care_only: careOnly,
    delivery_available: !hasCare,
    delivery_unavailable_reason: hasCare ? "care_items_staff_arranged" : null,
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
    require_contact_form: !contact,
    delivery_address: addresses[0] || null,
    items,
    notes: link.notes || null,
  };
}

/** Live-cart activity from the public page, resolved by slug. Best-effort. */
async function recordCartBySlug({ slug, cart }) {
  const link = await repo.getBySlug({ slug });
  if (!link) return null;
  return recordCart({ link_id: link.link_id, cart });
}

async function postSystemLine({ business, channel_id, content, client }) {
  if (!channel_id) return;
  try {
    const msg = await smartcommRepo.insertMessage({
      client,
      message: { channel_id, message_type: "system", content },
    });
    events.emit("message.posted", {
      brand: business,
      channel_id,
      message_id: msg.message_id,
    });
  } catch (err) {
    logger.warn(
      { err: err.message, channel_id },
      "order-link: system line failed (ignored)",
    );
  }
}

async function customerLabel(link) {
  if (!link.contact_id) return "The customer";
  try {
    const { rows } = await query(
      `SELECT display_name, first_name FROM shared.contacts WHERE contact_id = $1`,
      [link.contact_id],
    );
    return rows[0]?.first_name || rows[0]?.display_name || "The customer";
  } catch {
    return "The customer";
  }
}

/** First open drops a line in the thread; refreshes only bump counters. */
async function recordOpen({ link_id }) {
  const link = await repo.recordOpen({ link_id });
  if (!link) return null;
  if (link.first_open) {
    const who = await customerLabel(link);
    await postSystemLine({
      business: link.business,
      channel_id: link.channel_id,
      content: `👀 ${who} opened your ${link.mode === "shop" ? "catalogue" : "order"} link.`,
    });
    emitActivity(link);
  }
  return link;
}

/**
 * Save the live selection. The sidebar panel updates on every call (via
 * the socket event); the thread only gets a line when the hourly
 * throttle allows, so browsing never floods the conversation.
 */
async function recordCart({ link_id, cart }) {
  const link = await repo.updateCart({ link_id, cart });
  if (!link) return null;
  emitActivity(link);
  if (link.notify && Array.isArray(cart) && cart.length > 0) {
    const who = await customerLabel(link);
    const summary = cart
      .slice(0, 4)
      .map((c) => `${c.qty}× ${c.name || c.kind}`)
      .join(", ");
    const more = cart.length > 4 ? ` +${cart.length - 4} more` : "";
    await postSystemLine({
      business: link.business,
      channel_id: link.channel_id,
      content: `🛍️ ${who} is picking items: ${summary}${more}.`,
    });
  }
  return link;
}

/**
 * Called by the storefront order-form inside its transaction once the
 * order exists. Flips the link to 'ordered' (single-use), back-fills
 * the contact, files service booking requests, and announces the order
 * in the thread. Passing `client` keeps it atomic with the order.
 */
async function completeOrder({
  client,
  link_id,
  order_id,
  order_number,
  total_ngn,
  contact_id,
  bookings = [],
}) {
  const link = await repo.markOrdered({
    client,
    link_id,
    order_id,
    order_number,
    contact_id,
  });
  if (!link) return null; // already ordered/expired — never double-fire

  const bookingRows = [];
  for (const b of bookings) {
    bookingRows.push(
      await repo.createBookingRequest({
        client,
        booking: {
          business: link.business,
          link_id: link.link_id,
          channel_id: link.channel_id,
          contact_id: contact_id || link.contact_id,
          service_id: b.service_id,
          order_id: order_id || null,
          qty: b.qty,
          price_ngn: b.price_ngn,
          requested_for: b.requested_for,
          note: b.note,
        },
      }),
    );
  }

  const who = await customerLabel({ ...link, contact_id: contact_id || link.contact_id });
  const bits = [];
  if (order_number) {
    bits.push(
      `🛒 ${who} placed order ${order_number}${total_ngn ? ` — ${ngn(total_ngn)}` : ""}.`,
    );
  }
  if (bookingRows.length) {
    const when = bookings[0]?.requested_for
      ? ` (requested for ${formatDateTime(bookings[0].requested_for)})`
      : "";
    bits.push(
      `💇 ${who} requested ${bookingRows.length} service booking${bookingRows.length === 1 ? "" : "s"}${when} — confirm from the thread.`,
    );
  }
  if (bits.length) {
    await postSystemLine({
      business: link.business,
      channel_id: link.channel_id,
      content: bits.join("\n"),
      client,
    });
  }
  emitActivity({ ...link, status: "ordered", order_number });
  return { link, bookings: bookingRows };
}

/** Socket ping so the sidebar's activity panel refetches. */
function emitActivity(link) {
  events.emit("order_link.activity", {
    brand: link.business,
    channel_id: link.channel_id,
    link_id: link.link_id,
    status: link.status,
  });
}

async function listForChannel({ channel_id, limit }) {
  return repo.listForChannel({ channel_id, limit });
}

module.exports = {
  createLink,
  getPublicContext,
  recordCartBySlug,
  recordOpen,
  recordCart,
  completeOrder,
  listForChannel,
};
