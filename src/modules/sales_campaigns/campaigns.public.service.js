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
const main = require("./campaigns.service");
const events = require("./campaigns.events");
const salesService = require("../sales/sales.service");
const salesRepo = require("../sales/sales.repo");
const paymentLink = require("../sales/payment-link.service");
const contactsRepo = require("../../shared/contacts/contacts.repo");
const styledRepo = require("../catalogue/styled.repo");
const styledVariantsRepo = require("../catalogue/styled_variants.repo");
const { transaction, query } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

const { BRANDS } = require("../../config/brands");

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

const NIGERIAN_CITIES = [
  "Lagos",
  "Abuja",
  "Port Harcourt",
  "Ibadan",
  "Lekki",
  "Ikeja",
  "Victoria Island",
  "Ikoyi",
  "Ajah",
  "Surulere",
  "Yaba",
  "Enugu",
  "Kaduna",
  "Benin City",
  "Warri",
];

function generateSimulatedSocialProof(campaign, bundles) {
  const bundleNames = bundles.map((b) => b.bundle_name).filter(Boolean);
  if (!bundleNames.length) return { recent_orders: [], live_viewers: 0 };

  const now = Date.now();
  const recent_orders = [];
  const count = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    recent_orders.push({
      bundle_name: bundleNames[Math.floor(Math.random() * bundleNames.length)],
      city: NIGERIAN_CITIES[Math.floor(Math.random() * NIGERIAN_CITIES.length)],
      at: now - Math.floor(Math.random() * 30 * 60_000),
    });
  }
  recent_orders.sort((a, b) => b.at - a.at);

  const floor = campaign.viewer_count_floor || 15;
  const live_viewers =
    floor + Math.floor(Math.random() * Math.ceil(floor * 0.6));

  return { recent_orders, live_viewers };
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

  if (state === "live") {
    const proof = generateSimulatedSocialProof(campaign, bundles || []);
    payload.recent_orders = proof.recent_orders;
    payload.live_viewers = proof.live_viewers;
  }

  payload.starts_at = campaign.starts_at;
  payload.ends_at = campaign.ends_at;
  payload.exit_intent_enabled = campaign.exit_intent_enabled || false;
  payload.exit_intent_code = campaign.exit_intent_code || null;
  payload.exit_intent_discount_ngn = campaign.exit_intent_discount_ngn || null;
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
      product_id: p.product_id,
      stock_remaining: p.current_stock_snapshot,
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

  // ── 1. Find or create CRM contact + address ────────────
  // Runs in its own transaction so it doesn't nest inside salesService's.
  const contact = await transaction(async (client) => {
    const c = input.contact;
    const email = c.email.toLowerCase().trim();
    const phone = c.phone.trim();

    let ct = await contactsRepo.findByPhoneOrEmail({ client, phone, email });
    if (!ct) {
      ct = await contactsRepo.create({
        client,
        input: {
          contact_type: ["customer"],
          display_name: `${c.first_name} ${c.last_name}`,
          first_name: c.first_name,
          last_name: c.last_name,
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

    const addr = c.address;
    const addresses = await contactsRepo.listAddresses({
      client,
      contact_id: ct.contact_id,
    });
    // NB: shared.contact_addresses.address_type CHECK allows only
    // 'delivery' | 'billing' | 'office' | 'home' | 'other'. Using 'shipping'
    // tripped a 23514 (→ INVALID_VALUE) on every checkout. 'delivery' is the
    // canonical customer-shipping type (and the column default).
    if (!addresses.some((a) => a.address_type === "delivery" && a.is_default)) {
      await contactsRepo.addAddress({
        client,
        contact_id: ct.contact_id,
        input: {
          address_type: "delivery",
          address_type: "delivery",
          is_default: true,
          line1: addr.line1,
          line2: addr.line2 || null,
          city: addr.city,
          state: addr.state || null,
          country: addr.country || "Nigeria",
        },
        user_id: null,
      });
    }
    return ct;
  });

  // ── 2. Map cart items → order lines (variant-level) ────
  // The client sends bundle_id or product_id. We resolve each to its
  // constituent variant(s) so salesService.createOrder can do its job.
  // Prices are NEVER trusted from the client.
  const orderLines = [];

  for (const cartItem of input.cart) {
    if (cartItem.bundle_id) {
      const items = await bundleRepo.listBundleItems({
        brand: resolvedBrand,
        bundle_id: cartItem.bundle_id,
      });
      if (!items.length) {
        throw new AppError(
          "BUNDLE_EMPTY",
          `Bundle ${cartItem.bundle_id} has no items`,
          409,
        );
      }
      for (const bi of items) {
        if (!bi.variant_id) continue;
        orderLines.push({
          variant_id: bi.variant_id,
          quantity: (bi.quantity || 1) * cartItem.quantity,
        });
      }
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
    }
  }

  if (!orderLines.length) {
    throw new AppError("EMPTY_ORDER", "No valid items in the cart", 400);
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
      coupon_code: input.coupon_code || null,
      client_idempotency_key: input.client_idempotency_key,
      utm_source: input.utm?.utm_source || null,
      utm_medium: input.utm?.utm_medium || null,
      utm_campaign: input.utm?.utm_campaign || campaign.slug,
    },
  });

  // ── 4. Record checkout metadata (best-effort) ──────────
  // sales_orders carries customer_notes (human, fulfilment-facing) and
  // internal_notes (structured: gift instructions, consent, request origin).
  const c = input.contact;
  if (c.notes || c.gift || c.consent) {
    const internal = {};
    if (c.gift) {
      internal.gift = c.gift;
      if (c.gift.ship_to_recipient && c.gift.recipient_address) {
        internal.ship_to = "recipient";
        internal.recipient_address = c.gift.recipient_address;
      }
    }
    if (c.consent) internal.consent = c.consent;
    internal.ip = ip;
    internal.user_agent = user_agent;

    const customerParts = [];
    if (c.notes) customerParts.push(c.notes);
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
    try {
      await query(
        `UPDATE ${resolvedBrand}.sales_orders
            SET customer_notes = $1, internal_notes = $2
          WHERE order_id = $3`,
        [
          customerParts.length ? customerParts.join("\n") : null,
          Object.keys(internal).length ? JSON.stringify(internal) : null,
          order.order_id,
        ],
      );
    } catch (err) {
      logger.warn({ err, order_id: order.order_id }, "checkout meta skipped");
    }
  }

  // ── 5. Initiate payment ────────────────────────────────
  // Payment init hits external APIs — kept outside DB transactions so a
  // gateway timeout doesn't hold locks. If it fails the order still exists
  // in pending_payment state and the customer can retry via the pay link.
  //
  // The return_url_base points the gateway callback to the landing thank-you
  // page so the customer is redirected back after payment.
  const brandConfig = await getBrandPublic(resolvedBrand);
  // Same resolution as share links / go-live blasts: prefer the sales
  // subdomain so the gateway returns the buyer to the live sale site.
  const landingBase = main.publicSaleBaseUrl(brandConfig);
  const returnUrlBase = landingBase
    ? `${landingBase}/checkout/${slug}/thank-you`
    : undefined;

  try {
    // Pass the buyer's chosen display currency through so getActiveChain
    // routes the right rail (USD → Nomba only, NGN → Nomba then Paystack).
    // Order remains in NGN base; the gateway charges in the chosen currency
    // and the webhook stamps display_currency + fx_rate_used at settlement.
    const checkoutCurrency = String(
      input.display_currency || "NGN",
    ).toUpperCase();
    const payResult = await paymentLink.createPaymentLink({
      brand: resolvedBrand,
      order_id: order.order_id,
      currency: checkoutCurrency,
      return_url_base: returnUrlBase,
      // USD only ships on the Nomba rail — ignore any buyer-preferred
      // provider override when currency forces the chain.
      preferred_provider:
        checkoutCurrency === "USD" ? "nomba" : input.payment_gateway,
    });
    events.emit("checkout_completed", {
      brand: resolvedBrand,
      campaign_id: campaign.campaign_id,
      order_id: order.order_id,
      gateway: payResult.provider,
    });
    return { order_id: order.order_id, payment_url: payResult.checkout_url };
  } catch (err) {
    logger.error(
      { err, order_id: order.order_id },
      "payment gateway init failed after order creation",
    );
    throw new AppError(
      "PAYMENT_INIT_FAILED",
      "Order created but payment could not be initiated. Please try again.",
      502,
      { metadata: { order_id: order.order_id } },
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

  // Gallery: prefer images attached to the styled row directly; fall back to
  // the base product's gallery. Both join points are indexed.
  const { rows: galleryRows } = await query(
    `SELECT COALESCE(cdn_url, file_path) AS url, alt_text, is_primary, display_order
       FROM ${resolvedBrand}.product_images
      WHERE styled_id = $1
      ORDER BY is_primary DESC, display_order ASC NULLS LAST
      LIMIT 24`,
    [styled_id],
  );
  let gallery = galleryRows;
  if (gallery.length === 0 && styled.base_product_id) {
    const { rows: baseRows } = await query(
      `SELECT COALESCE(cdn_url, file_path) AS url, alt_text, is_primary, display_order
         FROM ${resolvedBrand}.product_images
        WHERE product_id = $1 AND styled_id IS NULL AND variant_id IS NULL
        ORDER BY is_primary DESC, display_order ASC NULLS LAST
        LIMIT 24`,
      [styled.base_product_id],
    );
    gallery = baseRows;
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
  const { rows: laceRows } = await query(
    `SELECT lace_code, label, premium_ngn, display_order
       FROM ${resolvedBrand}.styled_lace_sizes
      WHERE is_active = true
      ORDER BY display_order`,
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
      variant_id: v.variant_id,
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
  getOrderStatus,
  getProductDetail,
};
