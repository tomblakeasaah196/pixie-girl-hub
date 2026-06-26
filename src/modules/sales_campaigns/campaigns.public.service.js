/**
 * Sales Campaigns — PUBLIC service (V2.2 §6.22 + §6.4).
 *
 * Powers the no-login landing page at /sale/:slug. Resolves the campaign to a
 * single brand using (in order): the brand set by hostBrandResolverMiddleware
 * (subdomain), then an explicit brand hint from header/query. We never fan a
 * slug query across all brands — that gave an attacker a timing oracle and
 * doubled DB load per public hit. Returns only public-safe data — never cost
 * prices, never the other brand's data, never draft/pending campaigns.
 */

"use strict";

const repo = require("./campaigns.repo");
const bundleRepo = require("./campaigns.bundles.repo");
const bundleService = require("./campaigns.bundles.service");
const { computeDeals } = require("./campaigns.deals.service");
const main = require("./campaigns.service");
const events = require("./campaigns.events");
const salesService = require("../sales/sales.service");
const salesRepo = require("../sales/sales.repo");
const zonesService = require("../logistics/zones.service");
const paymentLink = require("../sales/payment-link.service");
const contactsRepo = require("../../shared/contacts/contacts.repo");
const styledRepo = require("../catalogue/styled.repo");
const styledVariantsRepo = require("../catalogue/styled_variants.repo");
const { transaction, query } = require("../../config/database");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");
const { getSupportContact, supportSentence } = require("../../config/support");

const { BRANDS } = require("../../config/brands");

// Strip human formatting from a phone so "+234 (0)801 234 5678" and
// "08012345678" don't create duplicate contacts or fail length checks.
function normalizePhone(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^0-9]/g, "");
}

// Build a buyer-facing support block + a one-line sentence for messages.
function buildSupport(brand, brandConfig) {
  const c = getSupportContact(brand, brandConfig);
  return {
    contact: c,
    meta:
      c.whatsapp || c.email
        ? { whatsapp: c.whatsapp, email: c.email, message: supportSentence(c) }
        : null,
    sentence: supportSentence(c),
  };
}

// Pre-order delivery estimate for the checkout response so the UI can show
// "ships in N weeks" the moment the buyer pays.
function preorderResponse(order, campaign) {
  const pre = order && order._preorder;
  if (!pre || !pre.is_preorder) return null;
  const base = Number(campaign.delivery_weeks) || 0;
  const extra =
    campaign.preorder_extra_weeks === null ||
    campaign.preorder_extra_weeks === undefined
      ? 4
      : Number(campaign.preorder_extra_weeks);
  const weeks = base + extra;
  return {
    is_preorder: true,
    item_count: pre.line_count,
    items: pre.names,
    delivery_weeks: weeks,
    message: weeks
      ? `Pre-order confirmed — your item${pre.line_count > 1 ? "s" : ""} ship${pre.line_count > 1 ? "" : "s"} in about ${weeks} weeks.`
      : "Pre-order confirmed — we'll be in touch with your delivery date.",
  };
}

// Statuses that are publicly visible (the landing page exists for these).
const PUBLIC_STATUSES = new Set(["scheduled", "live", "paused", "ended"]);

// Fetch brand public identity info for the landing payload.
async function getBrandPublic(brand) {
  const { rows } = await query(
    `SELECT business_key, display_name, storefront_domain, sales_subdomain,
            support_email, praxis_voice_profile, show_viewer_count_policy, viewer_count_floor
       FROM shared.business_config
      WHERE business_key = $1 AND is_active = true`,
    [brand],
  );
  return rows[0] || null;
}

// Attach brand public info to a landing payload.
function withBrandInfo(payload, brandInfo) {
  if (!brandInfo) return payload;
  return {
    ...payload,
    brand: {
      business_key: brandInfo.business_key,
      display_name: brandInfo.display_name,
      storefront_domain: brandInfo.storefront_domain,
      sales_subdomain: brandInfo.sales_subdomain,
      support_email: brandInfo.support_email,
      praxis_voice_profile: brandInfo.praxis_voice_profile,
      show_viewer_count_policy: brandInfo.show_viewer_count_policy,
      viewer_count_floor: brandInfo.viewer_count_floor,
    },
  };
}

/**
 * Resolve the campaign for a slug to a single brand.
 *
 * Priority order:
 *   1. `brand` already attached to the request by hostBrandResolverMiddleware
 *      (subdomain or admin-side X-Brand-Context).
 *   2. Explicit brandHint (query string or header) that matches an active brand.
 *
 * If neither resolves to a known brand we return null (→ 404). We deliberately
 * do NOT fan a slug query across every brand: that turns every public hit into
 * O(brands) DB queries and gives an attacker a timing oracle for slug
 * enumeration across brands. Subdomains are how production routes /sale/:slug.
 */
async function resolveCampaign({ slug, brand, brandHint }) {
  let targetBrand = null;
  if (brand && BRANDS.has(brand)) targetBrand = brand;
  else if (brandHint && BRANDS.has(brandHint)) targetBrand = brandHint;
  if (!targetBrand) return null;
  const c = await repo.findBySlug({ brand: targetBrand, slug });
  return c ? { campaign: c, brand: targetBrand } : null;
}

async function getLanding({ slug, brand, brandHint }) {
  const found = await resolveCampaign({ slug, brand, brandHint });
  if (!found || !PUBLIC_STATUSES.has(found.campaign.status)) {
    throw new NotFoundError("Campaign");
  }
  const { campaign, brand: resolvedBrand } = found;
  const state = main.resolveState(campaign);

  const [products, bundles, tiers, upsells] = await Promise.all([
    repo.listProducts({
      brand: resolvedBrand,
      campaign_id: campaign.campaign_id,
    }),
    bundleService.listCampaignBundles({
      brand: resolvedBrand,
      campaign_id: campaign.campaign_id,
    }),
    bundleService.listTiers({
      brand: resolvedBrand,
      campaign_id: campaign.campaign_id,
    }),
    bundleService.listUpsells({
      brand: resolvedBrand,
      campaign_id: campaign.campaign_id,
    }),
  ]);

  const payload = main.buildLandingPayload(campaign, products, state);

  if (state === "live" || state === "before") {
    payload.bundles = bundles || [];
    payload.tiers = tiers || [];
    payload.upsells = upsells || [];
  }

  // Owner directive: the live-page social-proof overlays — the "X just bought
  // from Lekki/Ajah" purchase popups AND the "X viewing" viewer ticker — are
  // removed entirely, so no simulated social-proof is emitted.

  payload.starts_at = campaign.starts_at;
  payload.ends_at = campaign.ends_at;
  payload.exit_intent_enabled = campaign.exit_intent_enabled || false;
  payload.exit_intent_code = campaign.exit_intent_code || null;
  payload.exit_intent_discount_ngn = campaign.exit_intent_discount_ngn || null;
  payload.exit_intent_title = campaign.exit_intent_title || null;
  payload.exit_intent_body = campaign.exit_intent_body || null;
  payload.exit_intent_button = campaign.exit_intent_button || null;
  payload.show_viewer_count_policy = campaign.show_viewer_count_policy || null;
  payload.viewer_count_floor = campaign.viewer_count_floor || null;
  payload.last_call_surge_minutes = campaign.last_call_surge_minutes || 0;
  payload.vip_early_access_minutes = campaign.vip_early_access_minutes || 0;

  const brandInfo = await getBrandPublic(resolvedBrand);
  return withBrandInfo(payload, brandInfo);
}

/**
 * Storefront index for the sales subdomain root (no slug). Returns the
 * currently-open drop (if any), the next scheduled drops, and a short archive
 * of recent past drops — all public-safe fields only. Powers the editorial
 * "between drops" page and the VIP-gated archive.
 */
async function getIndex({ brand, brandHint }) {
  let targetBrand = null;
  if (brand && BRANDS.has(brand)) targetBrand = brand;
  else if (brandHint && BRANDS.has(brandHint)) targetBrand = brandHint;
  if (!targetBrand) throw new NotFoundError("Storefront");

  const pub = (c) => ({
    slug: c.slug,
    name: c.name,
    hero_image_url: c.landing_hero_image_url,
    og_image_url: c.og_image_url,
    hero_subtitle: c.landing_hero_subtitle,
    starts_at: c.starts_at,
    ends_at: c.ends_at,
    state: main.resolveState(c),
  });

  const [live, scheduled, ended] = await Promise.all([
    repo.findAll({
      brand: targetBrand,
      filters: { status: "live" },
      page: 1,
      page_size: 4,
      offset: 0,
    }),
    repo.findAll({
      brand: targetBrand,
      filters: { status: "scheduled" },
      page: 1,
      page_size: 3,
      offset: 0,
    }),
    repo.findAll({
      brand: targetBrand,
      filters: { status: "ended" },
      page: 1,
      page_size: 6,
      offset: 0,
    }),
  ]);

  // Only surface a live campaign whose window is actually open right now.
  const liveOpen = live.data.find((c) => main.resolveState(c) === "live");
  return {
    brand: targetBrand,
    active: liveOpen ? pub(liveOpen) : null,
    upcoming: scheduled.data.map(pub),
    past: ended.data.map(pub),
  };
}

async function getStock({ slug, brand, brandHint }) {
  const found = await resolveCampaign({ slug, brand, brandHint });
  // Stock is only meaningful (and safe to expose) while the campaign is
  // actually live; we hide it pre-launch (competitor scouting) and post-end
  // (the dataset is just stale).
  if (!found || main.resolveState(found.campaign) !== "live") {
    throw new NotFoundError("Campaign");
  }
  const { campaign, brand: resolvedBrand } = found;
  const products = await repo.listProducts({
    brand: resolvedBrand,
    campaign_id: campaign.campaign_id,
  });
  return products
    .filter((p) => p.include_exclude === "include" && p.product_id)
    .map((p) => ({
      link_id: p.link_id,
      product_id: p.product_id,
      styled_id: p.styled_id,
      stock_remaining: p.live_base_stock,
    }));
}

async function signup({ slug, brand, brandHint, input, ip, user_agent }) {
  const found = await resolveCampaign({ slug, brand, brandHint });
  if (!found) throw new NotFoundError("Campaign");
  const { campaign, brand: resolvedBrand } = found;

  const state = main.resolveState(campaign);
  if (state === "ended") {
    throw new AppError("CAMPAIGN_ENDED", "This campaign has ended", 409);
  }
  if (!campaign.signup_for_notifications) {
    throw new AppError(
      "SIGNUPS_DISABLED",
      "Notifications are not enabled for this campaign",
      409,
    );
  }

  return transaction(async (client) => {
    // Race guard: two concurrent signups for the same email/phone on the same
    // campaign would both pass the dedupe check below and double-insert (there
    // is no unique index on the legacy table yet). A transaction-level advisory
    // lock keyed on (campaign_id, identifier) serialises them without a schema
    // change. hashtext is 32-bit so we feed Postgres two keys: campaign + ident.
    const identifier =
      (input.email || "").toLowerCase().trim() ||
      (input.phone || "").trim() ||
      "anon";
    await client.query(
      `SELECT pg_advisory_xact_lock(
         hashtext($1::text),
         hashtext($2::text)
       )`,
      [campaign.campaign_id, identifier],
    );

    const existing = await repo.findSignup({
      client,
      brand: resolvedBrand,
      campaign_id: campaign.campaign_id,
      email: input.email,
      phone: input.phone,
    });
    if (existing) {
      return { already_signed_up: true, signup_id: existing.signup_id };
    }

    // Find or create a CRM contact for this signup. Unlike the newsletter form
    // which requires both email and phone, campaign signups accept either alone.
    let contactId = null;
    if (input.email || input.phone) {
      const email = (input.email || "").toLowerCase().trim() || null;
      const phone = (input.phone || "").trim() || null;

      // Try to find an existing contact by email or phone.
      const { rows: existing_contact } = await client.query(
        `SELECT contact_id FROM shared.contacts
           WHERE is_deleted = false AND (
             (email = $1 AND $1 IS NOT NULL) OR
             (primary_phone = $2 AND $2 IS NOT NULL)
           )
           LIMIT 1`,
        [email, phone],
      );

      if (existing_contact[0]) {
        contactId = existing_contact[0].contact_id;
      } else {
        // Create a new contact with source='website' (same as newsletter signups).
        const { rows: created_contact } = await client.query(
          `INSERT INTO shared.contacts
             (contact_type, display_name, email, primary_phone, source, visible_to)
           VALUES (ARRAY['lead'], $1, $2, $3, 'website', ARRAY[$4])
           RETURNING contact_id`,
          [email || "Lead from campaign signup", email, phone, resolvedBrand],
        );
        if (created_contact[0]) {
          contactId = created_contact[0].contact_id;
        }
      }
    }

    const created = await repo.createSignup({
      client,
      brand: resolvedBrand,
      campaign_id: campaign.campaign_id,
      input,
      contact_id: contactId,
      ip,
      user_agent,
    });
    await repo.incrementCounters({
      client,
      brand: resolvedBrand,
      id: campaign.campaign_id,
      deltas: { total_signups: 1 },
    });
    events.emit("signup_received", {
      brand: resolvedBrand,
      id: campaign.campaign_id,
      signup_id: created.signup_id,
    });
    return { already_signed_up: false, signup_id: created.signup_id };
  });
}

/**
 * Public checkout — the public landing page submits a cart + contact + gateway.
 *
 * Flow:
 *   1. Resolve campaign (must be live).
 *   2. Find-or-create a shared CRM contact (+ address).
 *   3. Map the client cart (bundle_id / product_id + qty) to order lines by
 *      resolving each to its constituent variant(s). Prices are NEVER trusted
 *      from the client — the discount engine re-prices server-side.
 *   4. Create the Sales Order via salesService.createOrder (handles discount,
 *      margin-floor, stock reservation, idempotency, audit).
 *   5. Initiate payment via paymentLink.createPaymentLink (gateway chain +
 *      automatic fallback).
 *   6. Return { order_id, payment_url } — the frontend redirects the customer.
 */
// ── Deal-ladder lines ─────────────────────────────────────
// Map a public cart to the line shape the deals engine needs. The GROSS deal
// discount (position ladder + stacking bonus + quantity tier + bulk) is built
// purely from quantities/kinds — it does NOT depend on prices — so this is all
// checkout needs to compute the figure it hands to salesService.createOrder.
//
//   bundle  → wig_units = Σ component quantities (a 3-wig bundle counts as 3)
//   raw     → an unstyled wig (feeds the reseller/bulk tier)
//   styled  → a styled wig (feeds the per-wig position ladder)
async function buildDealLines({ brand, cart }) {
  const lines = [];
  for (const item of cart || []) {
    const quantity = Number(item.quantity) || 0;
    if (quantity <= 0) continue;
    if (item.bundle_id) {
      const items = await bundleRepo.listBundleItems({
        brand,
        bundle_id: item.bundle_id,
      });
      const wigUnits = items.reduce(
        (a, bi) => a + (Number(bi.quantity) || 1),
        0,
      );
      lines.push({
        kind: "bundle",
        bundle_id: item.bundle_id,
        quantity,
        wig_units: wigUnits || 1,
      });
    } else if (item.styled_variant_id || item.product_id) {
      lines.push({
        kind: item.unstyled ? "raw" : "styled",
        quantity,
        wig_units: 1,
      });
    }
  }
  return lines;
}

/**
 * Server-authoritative cart quote for the landing page. Resolves each line's
 * price the same way checkout does (never trusting the client), runs the deals
 * engine, and returns the full breakdown + "next rung" nudges. The figure here
 * matches what checkout charges because checkout feeds the SAME gross discount
 * into createOrder (which re-clamps it against the live margin floor).
 */
async function quoteCart({ slug, brand, brandHint, input }) {
  const found = await resolveCampaign({ slug, brand, brandHint });
  if (!found) throw new NotFoundError("Campaign");
  const { campaign, brand: resolvedBrand } = found;

  const tiers = await bundleService
    .listTiers({ brand: resolvedBrand, campaign_id: campaign.campaign_id })
    .catch(() => []);

  // Resolve a display price + margin floor for each line (best-effort; the
  // gross discount is price-independent, prices only drive the displayed
  // subtotal / savings / final total).
  const dealLines = [];
  for (const item of input.cart || []) {
    const quantity = Number(item.quantity) || 0;
    if (quantity <= 0) continue;
    const priced = await priceQuoteLine({
      brand: resolvedBrand,
      item,
      campaign_id: campaign.campaign_id,
    });
    if (!priced) continue;
    dealLines.push({ ...priced, quantity });
  }

  const breakdown = computeDeals({ campaign, lines: dealLines, tiers });

  // Pre-compute whether the free-shipping threshold is met for this cart so
  // the cart UI can show "Free delivery applied" before checkout is submitted.
  const cartSubtotal = dealLines.reduce(
    (s, l) => s + Number(l.unit_price_ngn || 0) * (Number(l.quantity) || 0),
    0,
  );
  const freeShippingThreshold =
    campaign.free_shipping_threshold_ngn !== null &&
    campaign.free_shipping_threshold_ngn !== undefined
      ? Number(campaign.free_shipping_threshold_ngn)
      : null;

  return {
    slug: campaign.slug,
    currency: "NGN",
    ...breakdown,
    free_shipping_threshold_ngn: freeShippingThreshold,
    free_shipping_unlocked:
      freeShippingThreshold !== null && cartSubtotal >= freeShippingThreshold,
    lines: dealLines.map((l) => ({
      kind: l.kind,
      bundle_id: l.bundle_id || null,
      name: l.name || null,
      unit_price_ngn: toCurrencyString(money(l.unit_price_ngn || 0)),
      quantity: l.quantity,
    })),
  };
}

// PURE. Given a bundle's resolved component prices (per single bundle) and the
// campaign's fixed bundle price (campaign_bundle_price_ngn, or null when the
// operator didn't set one), return the sum-of-parts, the price the buyer pays
// per bundle, and the discount per bundle that brings the component sum down to
// the campaign price. The discount is applied ORDER-LEVEL (never per item) so it
// can't double-count with the deal ladder, and is clamped ≥ 0 so a mis-set
// campaign price can never INFLATE a bundle above its sum-of-parts.
function computeBundleDiscount({ components, campaignBundlePrice }) {
  const sumOfParts = (components || []).reduce(
    (a, c) =>
      a.plus(money(c.unit_price_ngn || 0).times(Number(c.quantity) || 1)),
    money(0),
  );
  const hasCampaignPrice =
    campaignBundlePrice !== null &&
    campaignBundlePrice !== undefined &&
    campaignBundlePrice !== "";
  // The campaign price may only ever DISCOUNT the bundle, never mark it up: a
  // price set above sum-of-parts is ignored (we keep sum-of-parts), so the quote
  // and the till always agree and effectivePrice === sumOfParts − discount.
  let effectivePrice = sumOfParts;
  if (hasCampaignPrice) {
    const cp = money(campaignBundlePrice);
    if (cp.lt(sumOfParts)) effectivePrice = cp;
  }
  const discountPerBundle = sumOfParts.minus(effectivePrice);
  return { sumOfParts, effectivePrice, discountPerBundle };
}

// The campaign bundle price to charge for ONE bundle. Resolved LIVE from the
// source Catalogue offer (so the till matches the storefront the instant a
// discount is edited + saved in Catalogue → Bundles), falling back to the
// stored snapshot for one-off bundles with no Catalogue source. The link rows
// carry src_* pricing from getCampaignBundle. computeBundleDiscount then clamps
// it ≤ sum-of-parts, so a bundle can never be marked up or sold below its parts
// beyond the §6.25 margin floor enforced in createOrder.
function effectiveCampaignBundlePrice(link, components) {
  if (!link) return null;
  const subtotal = (components || []).reduce(
    (s, c) => s + (Number(c.unit_price_ngn) || 0) * (Number(c.quantity) || 1),
    0,
  );
  const totalUnits = (components || []).reduce(
    (s, c) => s + (Number(c.quantity) || 1),
    0,
  );
  const live = bundleService.liveBundlePriceFromSource(
    link,
    subtotal,
    totalUnits,
  );
  return live !== null ? live : (link.campaign_bundle_price_ngn ?? null);
}

// The active default variant for a base product (stock/fulfilment anchor).
async function defaultVariantId({ brand, product_id }) {
  if (!product_id) return null;
  const { rows } = await query(
    `SELECT variant_id FROM ${brand}.product_variants
      WHERE product_id = $1 AND is_active = true
      ORDER BY is_default DESC, display_order ASC, created_at ASC
      LIMIT 1`,
    [product_id],
  );
  return rows[0] ? rows[0].variant_id : null;
}

// Resolve a bundle to sellable, variant-level order lines for `units` copies of
// the bundle, plus the order-level discount that lands the whole group at the
// campaign bundle price. STYLED components have no variant_id post-migration —
// they used to be silently skipped (`if (!bi.variant_id) continue`), so the
// bundle resolved to zero lines, quoted at ₦0 and never applied its discount.
// We now resolve each styled component to its styled product's base variant for
// stock/fulfilment, price it at the styled retail anchor (already resolved by
// listBundleItems), and carry the styled name as a snapshot so the order shows
// the styled item. The per-bundle discount = Σ component prices − campaign
// bundle price; createOrder re-clamps the combined order discount at the §6.25
// margin floor, so a bundle can never sell below cost.
async function resolveBundleForCheckout({
  brand,
  campaign_id,
  bundle_id,
  units,
}) {
  const copies = Number(units) || 1;
  const items = await bundleRepo.listBundleItems({ brand, bundle_id });
  if (!items.length) {
    throw new AppError("BUNDLE_EMPTY", `Bundle ${bundle_id} has no items`, 409);
  }
  const orderLines = [];
  const components = []; // per single bundle, drives the discount math
  for (const bi of items) {
    const compQty = Number(bi.quantity) || 1;
    const unitPrice = bi.unit_price_ngn || 0; // styled retail / variant storefront
    components.push({ unit_price_ngn: unitPrice, quantity: compQty });

    if (bi.styled_id) {
      let baseVariantId = bi.styled_base_variant_id;
      if (!baseVariantId) {
        baseVariantId = await defaultVariantId({
          brand,
          product_id: bi.styled_base_product_id,
        });
      }
      if (!baseVariantId) {
        throw new AppError(
          "BUNDLE_COMPONENT_UNAVAILABLE",
          "One of the items in your bundle is no longer available. Please try again.",
          409,
        );
      }
      orderLines.push({
        variant_id: baseVariantId,
        quantity: compQty * copies,
        unit_price_ngn: toCurrencyString(money(unitPrice)),
        product_name_snapshot: bi.styled_name || bi.display_name || null,
      });
    } else if (bi.variant_id) {
      orderLines.push({
        variant_id: bi.variant_id,
        quantity: compQty * copies,
        unit_price_ngn: toCurrencyString(money(unitPrice)),
      });
    } else if (bi.product_id) {
      const variantId = await defaultVariantId({
        brand,
        product_id: bi.product_id,
      });
      if (!variantId) {
        throw new AppError(
          "BUNDLE_COMPONENT_UNAVAILABLE",
          "One of the items in your bundle is no longer available. Please try again.",
          409,
        );
      }
      orderLines.push({
        variant_id: variantId,
        quantity: compQty * copies,
        unit_price_ngn: toCurrencyString(money(unitPrice)),
      });
    }
  }
  if (!orderLines.length) {
    throw new AppError(
      "BUNDLE_EMPTY",
      `Bundle ${bundle_id} has no sellable items`,
      409,
    );
  }
  const link = await bundleRepo.getCampaignBundle({
    brand,
    campaign_id,
    bundle_id,
  });
  const { discountPerBundle, effectivePrice, sumOfParts } =
    computeBundleDiscount({
      components,
      campaignBundlePrice: effectiveCampaignBundlePrice(link, components),
    });
  return {
    orderLines,
    discountNgn: discountPerBundle.times(copies),
    effectivePrice,
    sumOfParts,
  };
}

// Resolve one cart line to { kind, unit_price_ngn, wig_units, bundle_id?,
// floor_ngn, name } for the quote. Read-only; mirrors checkout pricing.
async function priceQuoteLine({ brand, item, campaign_id }) {
  if (item.bundle_id) {
    const items = await bundleRepo.listBundleItems({
      brand,
      bundle_id: item.bundle_id,
    });
    if (!items.length) return null;
    // Bundle quote price = the operator-set campaign bundle price when present,
    // else the live sum of component prices (styled retail / variant storefront,
    // already resolved by listBundleItems). STYLED components have no variant_id
    // and used to be skipped here, quoting the bundle at ₦0 — they are now priced
    // the same way checkout charges them, so the cart matches the till.
    const wigUnits = items.reduce((a, bi) => a + (Number(bi.quantity) || 1), 0);
    const components = items.map((bi) => ({
      unit_price_ngn: bi.unit_price_ngn || 0,
      quantity: Number(bi.quantity) || 1,
    }));
    const link = campaign_id
      ? await bundleRepo.getCampaignBundle({
          brand,
          campaign_id,
          bundle_id: item.bundle_id,
        })
      : null;
    const { effectivePrice } = computeBundleDiscount({
      components,
      campaignBundlePrice: effectiveCampaignBundlePrice(link, components),
    });
    return {
      kind: "bundle",
      bundle_id: item.bundle_id,
      unit_price_ngn: toCurrencyString(effectivePrice),
      wig_units: wigUnits || 1,
      floor_ngn: null,
      name: null,
    };
  }

  if (item.styled_variant_id) {
    const { rows } = await query(
      `SELECT sv.price_override_ngn, sv.base_product_id AS sv_base_product_id,
              sp.styled_id, sp.name AS styled_name, sp.retail_price_ngn,
              sp.base_variant_id, sp.base_product_id AS sp_base_product_id,
              c.premium_ngn AS colour_premium,
              st.premium_ngn AS size_premium, ls.premium_ngn AS lace_premium
         FROM ${brand}.styled_product_variants sv
         JOIN ${brand}.styled_products sp ON sp.styled_id = sv.styled_id
         JOIN ${brand}.styled_product_colours c ON c.colour_id = sv.colour_id
         JOIN ${brand}.styled_size_tiers st ON st.size_code = sv.size_code
         LEFT JOIN ${brand}.styled_lace_sizes ls ON ls.lace_code = sv.lace_code
        WHERE sv.styled_variant_id = $1
          AND sv.is_active = true AND sv.is_deleted = false`,
      [item.styled_variant_id],
    );
    const sv = rows[0];
    if (!sv) return null;
    // "Buy unstyled / raw": the anchor price WITHOUT styling premiums. A raw
    // line feeds the reseller/bulk tier; a styled line feeds the position ladder.
    const unitPrice = item.unstyled
      ? money(sv.retail_price_ngn || 0)
      : sv.price_override_ngn !== null && sv.price_override_ngn !== undefined
        ? money(sv.price_override_ngn)
        : money(sv.retail_price_ngn || 0)
            .plus(money(sv.colour_premium || 0))
            .plus(money(sv.size_premium || 0))
            .plus(money(sv.lace_premium || 0));
    // Campaign deals are floor-free (owner decision, CONFORMANCE_GAPS G-1): the
    // quote must not clamp at the variant min_price, so the figure the buyer sees
    // matches the floor-free charge. floor_ngn is therefore always null here.
    return {
      kind: item.unstyled ? "raw" : "styled",
      unit_price_ngn: toCurrencyString(unitPrice),
      wig_units: 1,
      floor_ngn: null,
      name: sv.styled_name,
    };
  }

  if (item.product_id) {
    const { rows } = await query(
      `SELECT variant_id, price_storefront_ngn, min_price_ngn
         FROM ${brand}.product_variants
        WHERE product_id = $1 AND is_active = true
        ORDER BY is_default DESC, display_order ASC, created_at ASC
        LIMIT 1`,
      [item.product_id],
    );
    if (!rows[0]) return null;
    return {
      kind: item.unstyled ? "raw" : "styled",
      unit_price_ngn: toCurrencyString(
        money(rows[0].price_storefront_ngn || 0),
      ),
      wig_units: 1,
      // Floor-free (owner decision, CONFORMANCE_GAPS G-1) — see styled branch.
      floor_ngn: null,
      name: null,
    };
  }
  return null;
}

async function checkout({ slug, brand, brandHint, input, ip, user_agent }) {
  const found = await resolveCampaign({ slug, brand, brandHint });
  if (!found) throw new NotFoundError("Campaign");
  const { campaign, brand: resolvedBrand } = found;

  if (main.resolveState(campaign) !== "live") {
    throw new AppError(
      "CAMPAIGN_NOT_LIVE",
      "This sale is not currently open for purchases",
      409,
    );
  }

  // ── Wholesale minimum (cart-wide) ──────────────────────
  // Raw / unstyled wigs are a wholesale-only SKU: they only sell at or above the
  // lowest configured bulk tier. The minimum is enforced on the COMBINED raw-wig
  // count across every style in the cart — not per product — so a buyer can mix
  // styles to reach it. The cart drawer mirrors this; this is the authoritative
  // guard so the client check can't be bypassed.
  const bulkTiersForMin = Array.isArray(campaign.bulk_tiers)
    ? campaign.bulk_tiers
    : [];
  const minBulkQty = bulkTiersForMin
    .map((t) => Number(t && t.min_qty))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)[0];
  if (minBulkQty) {
    const rawWigQty = (input.cart || []).reduce(
      (sum, it) => sum + (it && it.unstyled ? Number(it.quantity) || 0 : 0),
      0,
    );
    if (rawWigQty > 0 && rawWigQty < minBulkQty) {
      throw new AppError(
        "WHOLESALE_MINIMUM_NOT_MET",
        `Raw (unstyled) wigs are sold wholesale — a minimum of ${minBulkQty} across any style. You have ${rawWigQty}. Add ${minBulkQty - rawWigQty} more, or remove the raw wigs, to continue.`,
        409,
      );
    }
  }

  // Pickup (collect-in-store) carries no delivery address and no delivery fee.
  const isPickup = input.fulfilment_type === "pickup";

  // Delivery requires a usable address — guard here (the schema makes address
  // optional so pickup can omit it) so a delivery checkout can never slip
  // through addressless and look like a silent failure at fulfilment.
  if (!isPickup) {
    const a = input.contact.address;
    if (!a || !a.line1 || !a.city) {
      throw new AppError(
        "ADDRESS_REQUIRED",
        "Please enter your delivery address (or choose store pickup).",
        422,
      );
    }
  }

  // ── 1. Find or create CRM contact + address ────────────
  // Runs in its own transaction so it doesn't nest inside salesService's.
  const { contact, deliveryAddress } = await transaction(async (client) => {
    const c = input.contact;
    const email = (c.email || "").toLowerCase().trim() || null;
    const phone = normalizePhone(c.phone);
    // Single-name buyers are allowed (last name optional) — build a sensible
    // display name from whatever we have so the NOT NULL display_name holds.
    const displayName =
      [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
      email ||
      phone ||
      "Customer";

    let ct = await contactsRepo.findByPhoneOrEmail({ client, phone, email });
    if (!ct) {
      ct = await contactsRepo.create({
        client,
        input: {
          contact_type: ["customer"],
          display_name: displayName,
          first_name: c.first_name,
          last_name: c.last_name || null,
          email,
          primary_phone: phone,
          source: "campaign_checkout",
          instagram_handle: c.instagram_handle || null,
          visible_to: [resolvedBrand],
        },
        user_id: null,
      });
    } else {
      await contactsRepo.addContactTypes({
        client,
        id: ct.contact_id,
        types: ["customer"],
      });
    }

    // Ship-to-typed + save (owner decision): always honour the address the
    // buyer typed for THIS order and persist it as their default for next time
    // — never silently ship to a stale saved address. We clear the existing
    // default first so the (contact_id,'delivery',is_default) unique index
    // can't 409 a concurrent checkout. The whole save is wrapped in a SAVEPOINT
    // so an address hiccup can never poison this transaction (which would have
    // surfaced as INTERNAL_ERROR) — we fall back to any existing address.
    //
    // NB: address_type must be 'delivery' (CHECK allows delivery|billing|office
    // |home|other — 'shipping' 23514'd). State is omitted when blank so the
    // NOT NULL DEFAULT 'Lagos' applies (an explicit NULL 23502'd).
    // Pickup orders have no delivery address to persist.
    if (isPickup) return { contact: ct, deliveryAddress: null };

    const addr = c.address;
    let savedAddress = null;
    await client.query("SAVEPOINT pgh_addr");
    try {
      await contactsRepo.clearDefaultAddresses({
        client,
        contact_id: ct.contact_id,
        address_type: "delivery",
      });
      savedAddress = await contactsRepo.addAddress({
        client,
        contact_id: ct.contact_id,
        input: {
          address_type: "delivery",
          is_default: true,
          line1: addr.line1,
          line2: addr.line2 || null,
          city: addr.city,
          ...(addr.state ? { state: addr.state } : {}),
          country: addr.country || "Nigeria",
          // ISO-2 country code (e.g. "GB"); for NG we keep the human country
          // and route the delivery fee by zone_code (state/LGA) below.
          ...(addr.country_code && /^[A-Za-z]{2}$/.test(addr.country_code)
            ? { country_code: addr.country_code.toUpperCase() }
            : {}),
          ...(addr.landmark ? { landmark: addr.landmark } : {}),
          recipient_name: displayName,
          ...(phone ? { recipient_phone: phone } : {}),
        },
        user_id: null,
      });
      await client.query("RELEASE SAVEPOINT pgh_addr");
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT pgh_addr");
      await client.query("RELEASE SAVEPOINT pgh_addr").catch(() => {});
      logger.warn(
        { err: err.message, contact_id: ct.contact_id },
        "checkout address save fell back to existing",
      );
      const existing = await contactsRepo.listAddresses({
        client,
        contact_id: ct.contact_id,
      });
      savedAddress =
        existing.find((a) => a.address_type === "delivery" && a.is_default) ||
        existing[0] ||
        null;
    }
    return { contact: ct, deliveryAddress: savedAddress };
  });

  // ── 2. Map cart items → order lines (variant-level) ────
  // The client sends bundle_id or product_id. We resolve each to its
  // constituent variant(s) so salesService.createOrder can do its job.
  // Prices are NEVER trusted from the client.
  const orderLines = [];
  // Σ of each bundle's (sum-of-parts − campaign bundle price). Folded into the
  // single order-level discount below so the campaign bundle price is actually
  // applied (it never was) without double-counting against the deal ladder.
  let bundlePriceDiscount = money(0);

  for (const cartItem of input.cart) {
    if (cartItem.bundle_id) {
      // Resolve the bundle to variant-level lines (INCLUDING styled components,
      // which were previously skipped → ₦0 bundles) and accumulate the discount
      // that lands the bundle at its campaign price.
      const resolved = await resolveBundleForCheckout({
        brand: resolvedBrand,
        campaign_id: campaign.campaign_id,
        bundle_id: cartItem.bundle_id,
        units: cartItem.quantity,
      });
      orderLines.push(...resolved.orderLines);
      bundlePriceDiscount = bundlePriceDiscount.plus(resolved.discountNgn);
    } else if (cartItem.styled_variant_id) {
      // Styled product line. Price comes from the STYLED tables (not the base
      // product_variants, which are intentionally ₦0 for a styled product):
      //   price = price_override_ngn, else
      //           retail_price_ngn + colour premium + size premium + lace premium.
      // The line attaches to the styled product's base variant for stock /
      // fulfilment (styled_products.base_variant_id, else the base product's
      // default variant), and carries styled snapshots for the label.
      const { rows } = await query(
        `SELECT sv.styled_variant_id, sv.sku AS styled_sku, sv.size_code,
                sv.lace_code, sv.price_override_ngn,
                sv.base_product_id AS sv_base_product_id,
                sp.styled_id, sp.name AS styled_name, sp.retail_price_ngn,
                sp.base_variant_id, sp.base_product_id AS sp_base_product_id,
                c.name AS colour_name, c.premium_ngn AS colour_premium,
                st.label AS size_label, st.premium_ngn AS size_premium,
                ls.premium_ngn AS lace_premium
           FROM ${resolvedBrand}.styled_product_variants sv
           JOIN ${resolvedBrand}.styled_products sp ON sp.styled_id = sv.styled_id
           JOIN ${resolvedBrand}.styled_product_colours c ON c.colour_id = sv.colour_id
           JOIN ${resolvedBrand}.styled_size_tiers st ON st.size_code = sv.size_code
           LEFT JOIN ${resolvedBrand}.styled_lace_sizes ls ON ls.lace_code = sv.lace_code
          WHERE sv.styled_variant_id = $1
            AND sv.is_active = true AND sv.is_deleted = false`,
        [cartItem.styled_variant_id],
      );
      const sv = rows[0];
      if (!sv) {
        throw new AppError(
          "STYLED_VARIANT_UNAVAILABLE",
          "One of your items is no longer available. Please remove it and try again.",
          409,
        );
      }

      // "Buy unstyled / raw": the buyer ordered this wig WITHOUT styling, so we
      // price it at the styled product's anchor (retail_price_ngn) and drop the
      // colour/size/lace premiums. The line is flagged raw so it feeds the
      // reseller/bulk tier rather than the per-wig position ladder.
      const unitPrice = cartItem.unstyled
        ? money(sv.retail_price_ngn || 0)
        : sv.price_override_ngn !== null && sv.price_override_ngn !== undefined
          ? money(sv.price_override_ngn)
          : money(sv.retail_price_ngn || 0)
              .plus(money(sv.colour_premium || 0))
              .plus(money(sv.size_premium || 0))
              .plus(money(sv.lace_premium || 0));
      if (!unitPrice.gt(0)) {
        throw new AppError(
          "STYLED_NOT_PRICED",
          "This item isn’t available for purchase right now.",
          409,
        );
      }

      // Resolve a base variant for stock/fulfilment.
      let baseVariantId = sv.base_variant_id;
      if (!baseVariantId) {
        const baseProductId = sv.sv_base_product_id || sv.sp_base_product_id;
        if (baseProductId) {
          const { rows: bv } = await query(
            `SELECT variant_id FROM ${resolvedBrand}.product_variants
               WHERE product_id = $1 AND is_active = true
               ORDER BY is_default DESC, display_order ASC, created_at ASC
               LIMIT 1`,
            [baseProductId],
          );
          baseVariantId = bv[0] ? bv[0].variant_id : null;
        }
      }
      if (!baseVariantId) {
        throw new AppError(
          "STYLED_NO_BASE_VARIANT",
          "This item isn’t available for purchase right now.",
          409,
        );
      }

      const label = cartItem.unstyled
        ? [sv.colour_name, sv.size_label, "Unstyled"]
            .filter(Boolean)
            .join(" · ")
        : [sv.colour_name, sv.size_label, sv.lace_code]
            .filter(Boolean)
            .join(" · ");
      orderLines.push({
        variant_id: baseVariantId,
        quantity: cartItem.quantity,
        // Server-resolved styled price (client price is never trusted).
        unit_price_ngn: toCurrencyString(unitPrice),
        // Styled snapshots so the order line shows the styled item, not the base.
        product_name_snapshot: sv.styled_name,
        variant_label_snapshot: label || null,
        sku_snapshot: sv.styled_sku,
      });
    } else if (cartItem.product_id) {
      const { rows } = await query(
        `SELECT variant_id FROM ${resolvedBrand}.product_variants
           WHERE product_id = $1 AND is_active = true
           ORDER BY display_order ASC, created_at ASC
           LIMIT 1`,
        [cartItem.product_id],
      );
      if (!rows[0]) {
        throw new AppError(
          "PRODUCT_NO_VARIANT",
          `Product ${cartItem.product_id} has no active variant`,
          409,
        );
      }
      orderLines.push({
        variant_id: rows[0].variant_id,
        quantity: cartItem.quantity,
      });
    } else {
      // Neither a bundle nor a product id — surface it instead of silently
      // dropping the line (which previously let a cart check out as an empty
      // order, looking like a "silent failure" to the buyer).
      throw new AppError(
        "CART_ITEM_UNRESOLVED",
        "One of your items is no longer available. Please remove it and try again.",
        409,
      );
    }
  }

  if (!orderLines.length) {
    throw new AppError("EMPTY_ORDER", "No valid items in the cart", 400);
  }

  // ── 2b. Resolve the delivery fee server-side ───────────
  // The wig-quantity tier × the buyer's delivery zone drives the fee. We NEVER
  // trust a client-sent amount — we re-quote against the seeded zone using the
  // zone_code (NG state/LGA) or ISO-2 country code the autofill captured.
  // Pickup is always free.
  //
  // FAIL CLOSED (owner mandate): a *delivery* order must resolve to a real,
  // billable zone before it can be created. Browser autofill (or typing a
  // country/state without picking it from the list) leaves the zone code blank
  // while the visible address looks complete — and an uncovered zone prices to
  // null. Both used to fall back to ₦0, so we shipped hair we couldn't bill and
  // ate the logistics cost. We now refuse the order in both cases. Every
  // country, every NG state and every Lagos LGA is seeded, so a genuine buyer
  // selection always prices; if it ever doesn't, this surfaces the seeding gap
  // loudly instead of silently absorbing the freight.
  let shippingFeeNgn = 0;
  let deliveryQuote = null;
  // Set when a zone resolves but prices to ₦0 WITHOUT being marked free — a
  // config gap that "should never happen". Per owner decision we still take the
  // order (don't lose the sale), flag it, and confirm the rate before dispatch.
  let deliveryFeePending = false;
  if (!isPickup) {
    const addr = input.contact.address || {};
    const zoneCode = addr.zone_code || addr.country_code || null;
    const wigQty = orderLines.reduce(
      (s, l) => s + (Number(l.quantity) || 0),
      0,
    );

    // (1) No zone code at all — the location was never resolved to a country /
    //     state / LGA we can price. Block, don't guess at ₦0.
    if (!zoneCode) {
      logger.warn(
        { slug: campaign.slug },
        "checkout blocked — delivery address has no resolved zone/country code",
      );
      throw new AppError(
        "DELIVERY_LOCATION_REQUIRED",
        "Delivery order has no resolvable zone/country code",
        422,
        {
          user_message:
            "Please pick your country from the list (and your state, plus your LGA for Lagos) so we can calculate delivery before you pay.",
        },
      );
    }

    deliveryQuote = await zonesService
      .quote({ brand: resolvedBrand, country_code: zoneCode, qty: wigQty })
      .catch((err) => {
        logger.warn({ err: err.message, zoneCode }, "delivery quote failed");
        return null;
      });

    // (2) No zone covers this location at all (unserviceable) → we genuinely
    //     cannot ship here. Refuse rather than create an order we can't fulfil.
    //     fee_ngn === null / fee_status 'unserviceable' both mean "no zone".
    if (
      !deliveryQuote ||
      deliveryQuote.fee_ngn === null ||
      deliveryQuote.fee_status === "unserviceable"
    ) {
      logger.error(
        { zoneCode, slug: campaign.slug },
        "checkout blocked — no delivery zone covers this location",
      );
      throw new AppError(
        "DELIVERY_UNAVAILABLE",
        `No delivery zone covers '${zoneCode}'`,
        422,
        {
          user_message:
            "We couldn't calculate delivery for that location. Please double-check your country, state and city — or contact us and we'll complete your order.",
        },
      );
    }

    // (3) Zone resolved. fee_status tells the three valid outcomes apart:
    //     'priced' → charge the fee; 'free' → intentional ₦0 (a promo), charge
    //     ₦0 confidently; 'pending' → ₦0 with no free marker (config gap) →
    //     take the order at ₦0 now but flag it so the rate is confirmed before
    //     dispatch (owner decision: never lose the sale, never silently eat it).
    shippingFeeNgn = Number(deliveryQuote.fee_ngn) || 0;
    if (deliveryQuote.fee_status === "pending") {
      deliveryFeePending = true;
      logger.warn(
        { zoneCode, zone: deliveryQuote.zone_name, slug: campaign.slug },
        "delivery fee pending — zone resolved to ₦0 without a free-delivery marker; order flagged for rate confirmation before dispatch",
      );
    }

    // ── Free-shipping threshold override ──────────────────
    // If the campaign has a threshold and the cart goods subtotal meets it,
    // delivery is intentionally free — overrides the zone fee entirely.
    if (
      campaign.free_shipping_threshold_ngn !== null &&
      campaign.free_shipping_threshold_ngn !== undefined
    ) {
      const goodsSubtotal = orderLines.reduce(
        (s, l) => s + Number(l.unit_price_ngn || 0) * (Number(l.quantity) || 0),
        0,
      );
      if (goodsSubtotal >= Number(campaign.free_shipping_threshold_ngn)) {
        shippingFeeNgn = 0;
        deliveryFeePending = false;
        deliveryQuote = {
          ...deliveryQuote,
          fee_ngn: 0,
          fee_status: "free",
          is_free_delivery: true,
        };
        logger.info(
          {
            slug: campaign.slug,
            goodsSubtotal,
            threshold: campaign.free_shipping_threshold_ngn,
          },
          "free-shipping threshold met — delivery zeroed",
        );
      }
    }

    // ── FAIL CLOSED: a delivery order MUST carry a real logistics fee ──
    // Owner mandate (never ever): if the address didn't resolve to a billable
    // shipping fee (zone priced to ₦0 without being a genuine free-delivery
    // promo — i.e. the old 'pending' config-gap case), reject the checkout and
    // make the buyer enter a valid address. Genuine free shipping (fee_status
    // 'free' — a zone promo or the threshold override above) is still allowed.
    if (
      shippingFeeNgn <= 0 &&
      !(deliveryQuote && deliveryQuote.fee_status === "free")
    ) {
      logger.error(
        {
          zoneCode: addr.zone_code || addr.country_code || null,
          slug: campaign.slug,
        },
        "checkout blocked — delivery order has no resolved logistics fee",
      );
      throw new AppError(
        "DELIVERY_FEE_REQUIRED",
        "Delivery order has no resolved logistics fee",
        422,
        {
          user_message:
            "We couldn't calculate a delivery fee for your address. Please enter a valid delivery address so we can charge shipping before you pay.",
        },
      );
    }
  }

  // ── 2c. Campaign deal ladder ───────────────────────────
  // Compute the GROSS deal discount (position ladder + bundle stacking bonus +
  // quantity-tier ladder + reseller/bulk) from the cart's kinds/quantities —
  // the only inputs it needs. We hand this single figure to createOrder, which
  // applies it order-level and re-clamps it against the live margin floor, so
  // the charged total always matches the quote the buyer saw in the cart.
  // Quantity-tier bonuses (best-effort) — a tier DB hiccup skips the tier
  // bonus but must never silently zero the position ladder or bulk discount.
  let checkoutTiers = [];
  try {
    checkoutTiers = await bundleService.listTiers({
      brand: resolvedBrand,
      campaign_id: campaign.campaign_id,
    });
  } catch (err) {
    logger.warn(
      { err: err.message, slug: campaign.slug },
      "campaign quantity-tier fetch failed — quantity-tier bonus will not apply this checkout",
    );
  }
  // buildDealLines and computeDeals are NOT allowed to fail silently.
  // A transient error here must surface to the caller so the buyer retries —
  // the order is idempotent on client_idempotency_key so retrying is safe.
  // Swallowing these errors would zero the entire discount and charge full price.
  const dealLines = await buildDealLines({
    brand: resolvedBrand,
    cart: input.cart,
  });
  const deal = computeDeals({
    campaign,
    lines: dealLines,
    tiers: checkoutTiers,
  });
  let campaignDealDiscountNgn = deal.gross_discount_ngn;

  // Fold the bundle-price savings (Σ sum-of-parts − campaign bundle price) into
  // the single order-level discount. The deal ladder above only covers the
  // multi-bundle stacking bonus — the per-bundle campaign price is a separate
  // axis, so adding it here does not double-count. createOrder re-clamps the
  // combined figure at the §6.25 margin floor, so a bundle can never sell below
  // cost.
  if (bundlePriceDiscount.gt(money(0))) {
    campaignDealDiscountNgn = toCurrencyString(
      money(campaignDealDiscountNgn).plus(bundlePriceDiscount),
    );
  }

  // ── 2d. Near-duplicate guard ─────────────────────────────
  // A buyer who abandons the Paystack/Nomba page and opens a new browser
  // tab (different session → new idempotency key) creates a fresh order each
  // time. Before writing a new order, check whether the same contact already
  // has a pending_payment order on this campaign within the last 15 minutes.
  // If yes — and the caller has not confirmed intent — surface a warning so
  // the frontend can ask the buyer rather than silently duplicating.
  if (!input.force_new_order) {
    const nearDups = await salesRepo.findNearDuplicates({
      brand: resolvedBrand,
      contact_id: contact.contact_id,
      campaign_id: campaign.campaign_id,
      minutes: 15,
    });
    if (nearDups.length > 0) {
      throw new AppError(
        "POTENTIAL_DUPLICATE",
        "Near-duplicate pending order detected for same contact + campaign within 15 min",
        409,
        {
          user_message:
            "You appear to have placed a recent order. Check your inbox or tap 'Place new order' to continue.",
          metadata: {
            existing_orders: nearDups.map((o) => ({
              order_id: o.order_id,
              order_number: o.order_number,
              total_ngn: o.total_ngn,
              created_at: o.created_at,
            })),
          },
        },
      );
    }
  }

  // ── 3. Create the Sales Order ──────────────────────────
  // salesService.createOrder runs its own transaction (discount engine,
  // margin-floor, stock reservation, idempotency, audit — all atomic).
  const order = await salesService.createOrder({
    brand: resolvedBrand,
    user: { user_id: null },
    request_id: input.client_idempotency_key,
    input: {
      contact_id: contact.contact_id,
      // 'storefront' = an online store sale (the public sale landing is the
      // brand's storefront). 'campaign_landing' is not a valid channel per the
      // sales_orders.sales_channel CHECK constraint.
      sales_channel: "storefront",
      order_type: "dispatch",
      sales_campaign_id: campaign.campaign_id,
      campaign_slug: campaign.slug,
      lines: orderLines,
      // Gross campaign deal-ladder discount (position ladder + stacking bonus +
      // quantity tier + reseller/bulk). createOrder applies it order-level and
      // re-clamps against the margin floor.
      campaign_deal_discount_ngn: campaignDealDiscountNgn,
      // Server-resolved delivery fee (0 for pickup / unresolved zone). The
      // discount engine still honours a free_shipping coupon on top of this.
      shipping_fee_ngn: shippingFeeNgn,
      coupon_code: input.coupon_code || null,
      client_idempotency_key: input.client_idempotency_key,
      utm_source: input.utm?.utm_source || null,
      utm_medium: input.utm?.utm_medium || null,
      utm_campaign: input.utm?.utm_campaign || campaign.slug,
    },
  });

  // ── 4. Record checkout metadata + freeze the delivery address ──
  // sales_orders carries customer_notes (human, fulfilment-facing) and
  // internal_notes (structured: gift instructions, consent, request origin,
  // pre-order). We also snapshot the delivery address onto the order so
  // fulfilment ships exactly where the buyer typed — independent of any later
  // change to their saved address. Best-effort: a separate query (not inside a
  // transaction) so a hiccup here can never undo the order or poison anything.
  const c = input.contact;
  {
    const internal = {};
    if (c.gift) {
      internal.gift = c.gift;
      if (c.gift.ship_to_recipient && c.gift.recipient_address) {
        internal.ship_to = "recipient";
        internal.recipient_address = c.gift.recipient_address;
      }
    }
    if (c.consent) internal.consent = c.consent;
    // Fulfilment intent + the resolved delivery zone/fee, so the back office
    // knows whether to ship or hold for pickup and which courier/tier applied.
    internal.fulfilment_type = isPickup ? "pickup" : "delivery";
    if (!isPickup && deliveryQuote && deliveryQuote.zone_id) {
      internal.delivery = {
        zone_name: deliveryQuote.zone_name,
        courier_key: deliveryQuote.courier_key,
        country_code: deliveryQuote.country_code,
        fee_ngn: shippingFeeNgn,
        fee_status: deliveryQuote.fee_status || null,
        // Back-office flag: the delivery rate could not be priced (₦0 with no
        // free-delivery marker). Confirm the rate with the buyer and bill it
        // before dispatch. Surfaced as a badge/filter in the sales dashboard.
        ...(deliveryFeePending ? { fee_pending: true } : {}),
      };
    }
    if (order._preorder && order._preorder.is_preorder) {
      internal.preorder = {
        line_count: order._preorder.line_count,
        items: order._preorder.names,
      };
    }
    internal.ip = ip;
    internal.user_agent = user_agent;

    const customerParts = [];
    if (c.notes) customerParts.push(c.notes);
    if (isPickup) {
      customerParts.push("PICKUP / collect in store — no delivery.");
    } else if (internal.delivery) {
      customerParts.push(
        `Delivery zone: ${internal.delivery.zone_name} (${internal.delivery.courier_key}).`,
      );
      if (deliveryFeePending) {
        customerParts.push(
          "⚠ DELIVERY FEE PENDING — this zone resolved to ₦0 with no free-delivery rate set. Confirm the delivery rate with the customer and bill it BEFORE dispatch.",
        );
      }
    }
    if (order._preorder && order._preorder.is_preorder) {
      customerParts.push("Contains pre-order item(s).");
    }
    if (c.gift) {
      customerParts.push(`GIFT ORDER for ${c.gift.recipient_name}`);
      if (c.gift.message) customerParts.push(`Gift message: ${c.gift.message}`);
      if (c.gift.ship_to_recipient && c.gift.recipient_address) {
        const ra = c.gift.recipient_address;
        customerParts.push(
          `Ship to recipient: ${ra.line1}${ra.line2 ? `, ${ra.line2}` : ""}, ${ra.city}${ra.state ? `, ${ra.state}` : ""}, ${ra.country || "Nigeria"}`,
        );
      }
    }

    const addressSnapshot = deliveryAddress
      ? {
          line1: deliveryAddress.line1,
          line2: deliveryAddress.line2,
          area: deliveryAddress.area,
          city: deliveryAddress.city,
          state: deliveryAddress.state,
          country: deliveryAddress.country,
          country_code: deliveryAddress.country_code,
          postal_code: deliveryAddress.postal_code,
          recipient_name: deliveryAddress.recipient_name,
          recipient_phone: deliveryAddress.recipient_phone,
        }
      : null;

    // Currency snapshot (admin clarity). USD checkouts settle in dollars at the
    // gateway using the campaign's static rate (ngn_per_usd_rate, set in the
    // builder); record the dollar total + that rate on the order so the Sales
    // views can show "$X @ ₦rate → ₦total" instead of only Naira. NGN orders
    // keep the defaults (display_currency 'NGN', fx_rate_used 1.0, display_total
    // NULL → shown as "—"). Recording the real rate also fixes the realised-FX
    // posting in addPayment, which books against order.fx_rate_used.
    const displayCurrency = String(
      input.display_currency || "NGN",
    ).toUpperCase();
    const campaignRate =
      campaign.ngn_per_usd_rate !== null &&
      campaign.ngn_per_usd_rate !== undefined
        ? Number(campaign.ngn_per_usd_rate)
        : null;
    let displayTotal = null;
    let fxRateUsed = null; // null → keep the existing NOT NULL default (1.0)
    if (displayCurrency !== "NGN" && campaignRate && campaignRate > 0) {
      // Same conversion the gateway charges: NGN total → whole units, ceil.
      displayTotal = toCurrencyString(
        money(order.total_ngn).dividedBy(money(campaignRate)).ceil(),
      );
      fxRateUsed = campaignRate;
    }

    try {
      await query(
        `UPDATE ${resolvedBrand}.sales_orders
            SET customer_notes = $1,
                internal_notes = $2,
                delivery_address_id = COALESCE($3, delivery_address_id),
                delivery_address_snapshot = COALESCE($4::jsonb, delivery_address_snapshot),
                display_currency = $6,
                display_total = $7,
                fx_rate_used = COALESCE($8, fx_rate_used)
          WHERE order_id = $5`,
        [
          customerParts.length ? customerParts.join("\n") : null,
          Object.keys(internal).length ? JSON.stringify(internal) : null,
          deliveryAddress ? deliveryAddress.address_id : null,
          addressSnapshot ? JSON.stringify(addressSnapshot) : null,
          order.order_id,
          displayCurrency,
          displayTotal,
          fxRateUsed,
        ],
      );
    } catch (err) {
      logger.warn({ err, order_id: order.order_id }, "checkout meta skipped");
    }
  }

  // ── 5. Initiate payment ────────────────────────────────
  // Payment init hits external APIs — kept outside DB transactions so a
  // gateway timeout doesn't hold locks. If it fails the order still exists
  // in pending_payment state and the customer can retry (re-POSTing with the
  // same idempotency key returns this order and re-attempts payment).
  const brandConfig = await getBrandPublic(resolvedBrand);
  const support = buildSupport(resolvedBrand, brandConfig);
  // Same resolution as share links / go-live blasts: prefer the sales
  // subdomain so the gateway returns the buyer to the live sale site.
  const landingBase = main.publicSaleBaseUrl(brandConfig);
  const returnUrlBase = landingBase
    ? `${landingBase}/checkout/${slug}/thank-you`
    : undefined;

  // Buyer's chosen display currency drives gateway routing (USD → Nomba only,
  // NGN → Nomba then Paystack). Declared out here so the catch can branch on it.
  const checkoutCurrency = String(
    input.display_currency || "NGN",
  ).toUpperCase();

  // Per-campaign gateway gate: the owner can disable a rail for this sale in
  // the builder. Enforce it server-side — the public checkout only shows the
  // allowed buttons, so a value outside this set is a stale/tampered client.
  const allowedGateways =
    Array.isArray(campaign.allowed_payment_gateways) &&
    campaign.allowed_payment_gateways.length
      ? campaign.allowed_payment_gateways
      : ["paystack", "nomba"];
  // USD has only the Nomba rail; NGN honours the buyer's pick, else the first
  // gateway the campaign still has enabled.
  const preferredProvider =
    checkoutCurrency === "USD"
      ? "nomba"
      : input.payment_gateway && allowedGateways.includes(input.payment_gateway)
        ? input.payment_gateway
        : allowedGateways[0];
  if (!allowedGateways.includes(preferredProvider)) {
    // Either the buyer forced a disabled rail, or USD checkout hit a campaign
    // that has turned Nomba off — there is no valid rail to settle on.
    throw new AppError(
      "GATEWAY_NOT_AVAILABLE",
      checkoutCurrency === "USD"
        ? "USD payment is not available for this sale."
        : "That payment method is not available for this sale.",
      422,
    );
  }

  try {
    const payResult = await paymentLink.createPaymentLink({
      brand: resolvedBrand,
      order_id: order.order_id,
      currency: checkoutCurrency,
      return_url_base: returnUrlBase,
      // Resolved against the campaign's enabled gateways above; USD forces Nomba.
      preferred_provider: preferredProvider,
    });
    events.emit("checkout_completed", {
      brand: resolvedBrand,
      campaign_id: campaign.campaign_id,
      order_id: order.order_id,
      gateway: payResult.provider,
    });
    const preorder = preorderResponse(order, campaign);
    return {
      order_id: order.order_id,
      payment_url: payResult.checkout_url,
      ...(preorder ? { preorder } : {}),
      ...(order._notices && order._notices.length
        ? { notices: order._notices }
        : {}),
    };
  } catch (err) {
    logger.error(
      {
        err: err.message,
        order_id: order.order_id,
        currency: checkoutCurrency,
      },
      "payment gateway init failed after order creation",
    );
    // USD has no NGN fallback rail (owner: dollar is the universal currency for
    // international buyers, we don't convert them to Naira). Hand the buyer
    // straight to support with their order reference instead of a dead 500.
    if (checkoutCurrency === "USD") {
      throw new AppError(
        "USD_PAYMENT_UNAVAILABLE",
        "USD payment could not be initiated",
        502,
        {
          user_message: `We couldn't start your USD payment right now. ${support.sentence} Your order is saved (reference ${order.order_id}).`,
          metadata: {
            order_id: order.order_id,
            retryable: false,
            support: support.meta,
          },
        },
      );
    }
    // NGN: the order is saved — invite a retry (idempotency-key-safe) and give
    // them support as a backstop.
    throw new AppError(
      "PAYMENT_INIT_FAILED",
      "Order created but payment could not be initiated",
      502,
      {
        user_message:
          "Your order is saved but we couldn't start the payment. Please tap pay again to retry — you won't be charged twice.",
        metadata: {
          order_id: order.order_id,
          retryable: true,
          support: support.meta,
        },
      },
    );
  }
}

async function getOrderStatus({ slug, brand, brandHint, orderId }) {
  const found = await resolveCampaign({ slug, brand, brandHint });
  if (!found) throw new NotFoundError("Campaign");
  const { brand: resolvedBrand } = found;

  const order = await salesRepo.findById({ brand: resolvedBrand, id: orderId });
  if (!order) throw new NotFoundError("Order");

  return {
    order_id: order.order_id,
    order_number: order.order_number,
    status: order.status,
    total_ngn: order.total_ngn,
    currency: "NGN",
  };
}

/**
 * Public product detail for the landing-page product modal.
 *
 * Returns the gallery, long description, variants (size × lace with each
 * option's effective price = anchor + colour/size/lace premiums), and the
 * brand's head-size guide + optional video. The styled product must be
 * either attached to the campaign as a `sales_campaign_products` link OR
 * present inside one of the campaign's attached bundles — otherwise we
 * refuse the lookup so the public endpoint can't be used to enumerate the
 * whole catalogue.
 */
async function getProductDetail({ slug, brand, brandHint, styled_id }) {
  const found = await resolveCampaign({ slug, brand, brandHint });
  if (!found) throw new NotFoundError("Campaign");
  const { campaign, brand: resolvedBrand } = found;
  if (!PUBLIC_STATUSES.has(campaign.status)) {
    throw new NotFoundError("Campaign");
  }

  // Authorisation: the styled product must be referenced by this campaign,
  // either directly via sales_campaign_products or transitively via a
  // bundle on the campaign.
  const { rows: linkRows } = await query(
    `SELECT 1
       FROM ${resolvedBrand}.sales_campaign_products
      WHERE campaign_id = $1 AND styled_id = $2
        AND include_exclude = 'include'
      LIMIT 1`,
    [campaign.campaign_id, styled_id],
  );
  if (!linkRows.length) {
    const { rows: bundleRows } = await query(
      `SELECT 1
         FROM ${resolvedBrand}.sales_campaign_bundles scb
         JOIN ${resolvedBrand}.product_bundle_items bi
           ON bi.bundle_id = scb.bundle_id
        WHERE scb.campaign_id = $1 AND bi.styled_id = $2
        LIMIT 1`,
      [campaign.campaign_id, styled_id],
    );
    if (!bundleRows.length) throw new NotFoundError("Product");
  }

  const styled = await styledRepo.getById({
    brand: resolvedBrand,
    id: styled_id,
  });
  if (!styled || styled.is_deleted || styled.status !== "live") {
    throw new NotFoundError("Product");
  }

  // Gallery: STYLED-ONLY. Every image uploaded through the catalogue for a
  // styled product — including each per-colour multi-angle shot — carries the
  // styled_id (see catalogue styled_variants.service addColourImage, which sets
  // product_id=base AND styled_id AND styled_colour_id). So a single query keyed
  // on styled_id returns the complete multi-angle set. We deliberately do NOT
  // top up with base-product-only images (styled_id IS NULL): the landing page
  // must never surface a raw factory/base shot. If a styled product has only one
  // image, the gallery shows one — fix it by adding angles in the catalogue.
  const { rows: styledRows } = await query(
    `SELECT COALESCE(cdn_url, file_path) AS url, alt_text, is_primary, display_order
       FROM ${resolvedBrand}.product_images
      WHERE styled_id = $1
      ORDER BY is_primary DESC, display_order ASC NULLS LAST
      LIMIT 24`,
    [styled_id],
  );
  const seen = new Set();
  const gallery = [];
  for (const r of styledRows) {
    if (!r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    gallery.push(r);
    if (gallery.length >= 24) break;
  }

  const variants = await styledVariantsRepo.listVariants({
    brand: resolvedBrand,
    styled_id,
  });

  const { rows: tierRows } = await query(
    `SELECT size_code, label, premium_ngn, circumference_min_in,
            circumference_max_in, guidance_text, display_order
       FROM ${resolvedBrand}.styled_size_tiers
      WHERE is_active = true
      ORDER BY display_order`,
  );
  // Only surface lace types that actually have a generated SKU for this
  // styled product — the brand-wide styled_lace_sizes ladder includes every
  // lace type the brand sells, not just the ones generated here, so it must
  // be filtered down to what styled_product_variants actually has.
  const { rows: laceRows } = await query(
    `SELECT ls.lace_code, ls.label, ls.premium_ngn, ls.display_order
       FROM ${resolvedBrand}.styled_lace_sizes ls
      WHERE ls.is_active = true
        AND ls.lace_code IN (
          SELECT DISTINCT lace_code
            FROM ${resolvedBrand}.styled_product_variants
           WHERE styled_id = $1 AND lace_code IS NOT NULL AND is_deleted = false
        )
      ORDER BY ls.display_order`,
    [styled_id],
  );

  const cfg = await styledVariantsRepo.getConfig({ brand: resolvedBrand });

  return {
    styled_id,
    name: styled.name,
    slug: styled.slug,
    short_description: styled.short_description,
    long_description: styled.long_description,
    retail_price_ngn: styled.retail_price_ngn,
    anchor_price_ngn: styled.retail_price_ngn,
    gallery,
    variants: variants.map((v) => ({
      // The styled variant's id IS its primary key (styled_product_variants
      // has no `variant_id` column). The checkout's styled branch expects this
      // value as `styled_variant_id`; the modal forwards it from here.
      variant_id: v.styled_variant_id,
      colour_name: v.colour_name,
      colour_hex: v.colour_hex,
      colour_premium_ngn: Number(v.colour_premium_ngn || 0),
      size_code: v.size_code,
      size_label: v.size_label,
      size_premium_ngn: Number(v.size_premium_ngn || 0),
      lace_code: v.lace_code,
      lace_label: v.lace_label,
      lace_premium_ngn: Number(v.lace_premium_ngn || 0),
      effective_price_ngn: Number(v.effective_price_ngn || 0),
      is_default: Boolean(v.colour_is_default),
    })),
    size_tiers: tierRows.map((r) => ({
      size_code: r.size_code,
      label: r.label,
      premium_ngn: Number(r.premium_ngn || 0),
      circumference_in:
        r.circumference_min_in !== null &&
        r.circumference_min_in !== undefined &&
        r.circumference_max_in !== null &&
        r.circumference_max_in !== undefined
          ? `${r.circumference_min_in}–${r.circumference_max_in}"`
          : null,
      guidance_text: r.guidance_text,
    })),
    lace_sizes: laceRows.map((r) => ({
      lace_code: r.lace_code,
      label: r.label,
      premium_ngn: Number(r.premium_ngn || 0),
    })),
    size_guide: cfg
      ? {
          title: cfg.size_guide_title || "How to find your head size",
          guide_md: cfg.head_size_guide_md || null,
          video_url: cfg.head_size_video_url || null,
        }
      : null,
  };
}

module.exports = {
  getIndex,
  getLanding,
  getStock,
  signup,
  checkout,
  quoteCart,
  getOrderStatus,
  getProductDetail,
  // Exported for unit tests / reuse.
  computeBundleDiscount,
  resolveBundleForCheckout,
};
