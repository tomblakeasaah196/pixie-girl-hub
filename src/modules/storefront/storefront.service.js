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
// Reuse the catalogue's canonical composers — DON'T re-derive pricing here.
// listVariants already returns effective_price_ngn AND effective_price_usd;
// size tiers / lace ladder / size-guide config come from the same module.
const styledRepo = require("../catalogue/styled.repo");
const styledVariantsRepo = require("../catalogue/styled_variants.repo");
const salesService = require("../sales/sales.service");
const bundleRepo = require("../retention/bundle.repo");
const bundleService = require("../retention/bundle.service");
const couponService = require("../retention/coupon.service");
const cartRepo = require("./cart.repo");
const contactsRepo = require("../../shared/contacts/contacts.repo");
const zonesService = require("../logistics/zones.service");
const paymentLink = require("../sales/payment-link.service");
const { transaction, query } = require("../../config/database");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");
const jwt = require("jsonwebtoken");
const { config } = require("../../config/env");

const SYSTEM_USER = { user_id: null };

// ── Catalogue ──────────────────────────────────────────────
function listProducts(args) {
  return repo.listProducts(args);
}

/**
 * Product detail composed from the CATALOGUE composers (single source of truth),
 * mirroring sales_campaigns getProductDetail's shape but WITHOUT the campaign
 * coupling and WITH the USD twin forwarded. Pricing comes from
 * styled_variants.listVariants (effective_price_ngn/usd); we only assemble.
 */
async function getProduct({ brand, slug }) {
  const styled_id = await repo.getLiveStyledIdBySlug({ brand, slug });
  if (!styled_id) throw new NotFoundError("Product");

  const styled = await styledRepo.getById({ brand, id: styled_id });
  if (!styled || styled.is_deleted || styled.status !== "live") {
    throw new NotFoundError("Product");
  }

  const [allVariants, gallery, colours, tiers, laces, cfg] = await Promise.all([
    styledVariantsRepo.listVariants({ brand, styled_id }),
    repo.listStyledGallery({ brand, styled_id }),
    repo.listColourGalleries({ brand, styled_id }),
    styledVariantsRepo.listSizeTiers({ brand, activeOnly: true }),
    styledVariantsRepo.listLaceSizes({ brand, activeOnly: true }),
    styledVariantsRepo.getConfig({ brand }),
  ]);

  // Show ONLY variants a buyer can actually purchase — the same is_active +
  // is_deleted gate add-to-cart applies (listVariants already drops is_deleted).
  // Without dropping DEACTIVATED rows here, a colour/size/lace switched off in
  // the catalogue kept showing on the storefront, then failed at add-to-cart.
  const variants = allVariants.filter((v) => v.is_active);

  const num = (x) =>
    x === null ? (x === undefined ? null : Number(x)) : Number(x);
  // Surface only sizes/lace types this product actually has a live, ACTIVE
  // variant for — so an option whose variants were all removed or deactivated
  // stops appearing here (and can't be picked into a doomed add-to-cart).
  const usedLace = new Set(variants.map((v) => v.lace_code).filter(Boolean));
  const usedSize = new Set(variants.map((v) => v.size_code).filter(Boolean));

  return {
    styled_id,
    name: styled.name,
    slug: styled.slug,
    short_description: styled.short_description,
    long_description: styled.long_description,
    retail_price_ngn: styled.retail_price_ngn,
    retail_price_usd: styled.retail_price_usd,
    anchor_price_ngn: styled.retail_price_ngn,
    anchor_price_usd: styled.retail_price_usd,
    cover_image_url: styled.primary_image_url || null,
    gallery: gallery.map((g) => ({
      image_id: g.image_id,
      styled_colour_id: g.styled_colour_id,
      url: g.url,
      alt_text: g.alt_text,
      is_primary: g.is_primary,
    })),
    colours,
    variants: variants.map((v) => ({
      styled_variant_id: v.styled_variant_id,
      colour_id: v.colour_id,
      colour_name: v.colour_name,
      colour_hex: v.colour_hex,
      colour_premium_ngn: Number(v.colour_premium_ngn || 0),
      colour_premium_usd: num(v.colour_premium_usd),
      size_code: v.size_code,
      size_label: v.size_label,
      size_premium_ngn: Number(v.size_premium_ngn || 0),
      size_premium_usd: num(v.size_premium_usd),
      lace_code: v.lace_code,
      lace_label: v.lace_label,
      lace_premium_ngn: Number(v.lace_premium_ngn || 0),
      lace_premium_usd: num(v.lace_premium_usd),
      sku: v.sku,
      effective_price_ngn: Number(v.effective_price_ngn || 0),
      effective_price_usd: num(v.effective_price_usd),
      is_default: Boolean(v.colour_is_default),
    })),
    size_tiers: tiers
      .filter((r) => usedSize.has(r.size_code))
      .map((r) => ({
        size_code: r.size_code,
        label: r.label,
        premium_ngn: Number(r.premium_ngn || 0),
        premium_usd: num(r.premium_usd),
        circumference_in:
          r.circumference_min_in !== null &&
          r.circumference_min_in !== undefined &&
          r.circumference_max_in !== null &&
          r.circumference_max_in !== undefined
            ? `${r.circumference_min_in}–${r.circumference_max_in}"`
            : null,
        guidance_text: r.guidance_text,
      })),
    lace_sizes: laces
      .filter((l) => usedLace.has(l.lace_code))
      .map((l) => ({
        lace_code: l.lace_code,
        label: l.label,
        premium_ngn: Number(l.premium_ngn || 0),
        premium_usd: num(l.premium_usd),
        description: l.description || null,
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

async function listCategories({ brand }) {
  // Categories are hidden entirely when the brand has them disabled (§5.1).
  const cfg = await styledVariantsRepo.getConfig({ brand }).catch(() => null);
  if (cfg && cfg.categories_enabled === false) return [];
  return repo.listCategories({ brand });
}

async function getCollection({ brand, slug }) {
  const collection = await repo.getCollectionBySlug({ brand, slug });
  if (!collection) throw new NotFoundError("Collection");
  return collection;
}

function listShades({ brand }) {
  return repo.listShades({ brand });
}

async function getShade({ brand, slug }) {
  const shade = await repo.getShadeBySlug({ brand, slug });
  if (!shade) throw new NotFoundError("Shade");
  return shade;
}

function listCollections({ brand }) {
  return repo.listCollections({ brand });
}

function listBundles({ brand }) {
  return repo.listBundles({ brand });
}

async function getBundle({ brand, slug }) {
  // URL "slug" is the bundle_code (bundle_offers has no slug column).
  const bundle = await repo.getBundleByCode({ brand, code: slug });
  if (!bundle) throw new NotFoundError("Bundle");
  return bundle;
}

// Published Studio config for the SSR shell. Always resolves (empty/null
// sections until themes are seeded/published) so the website renders the baked
// Aura fallback tokens rather than erroring.
// A valid Studio preview token (minted by storefront_studio for an authed
// operator) flips /site to the DRAFT config so they can preview before publish.
function previewValid(token, brand) {
  try {
    const p = jwt.verify(token, config.JWT_SECRET);
    return !!p && p.typ === "sf_preview" && p.brand === brand;
  } catch {
    return false;
  }
}

async function getSite({ brand, path, previewToken }) {
  if (previewToken && previewValid(previewToken, brand)) {
    const site = await repo.getDraftSite({ brand, path });
    return { ...site, preview: true };
  }
  return repo.getPublishedSite({ brand, path });
}

function listContent({ brand, type }) {
  return repo.listContentPosts({ brand, type });
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
        // Resolve discounts in Sales: forward the campaign + coupon so the
        // storefront order is priced like any other channel (campaign discount,
        // coupon discount, sales_order_discounts + coupon_redemption all on the
        // order).
        sales_campaign_id: input.sales_campaign_id,
        campaign_slug: input.campaign_slug,
        coupon_code: input.coupon_code,
        redeem_points: input.redeem_points,
        bundle_id: input.bundle_id,
        client_idempotency_key: input.client_idempotency_key,
        stylist_referral_code: await resolveStylistReferral(
          input.referral_code,
        ),
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

// Stylist referral capture (§6.26 Q17): only a code that resolves to an
// ACTIVE partner is stamped on the order — a stale/garbage ?ref= silently
// drops instead of failing the checkout.
async function resolveStylistReferral(code) {
  if (!code) return undefined;
  const stylistReferrals = require("../stylist_programme/referral.service");
  const hit = await stylistReferrals
    .validateCode({ code })
    .catch(() => null);
  return hit ? String(code) : undefined;
}

// ── Persistent-cart checkout (own path; mirrors the proven sale sequence) ──

function normalizePhone(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/[^\d+]/g, "");
  return digits || null;
}

async function defaultVariantId({ brand, product_id }) {
  if (!product_id) return null;
  const { rows } = await query(
    `SELECT variant_id FROM ${brand}.product_variants
      WHERE product_id = $1 AND is_active = true
      ORDER BY is_default DESC, display_order ASC, created_at ASC LIMIT 1`,
    [product_id],
  );
  return rows[0] ? rows[0].variant_id : null;
}

// Re-price a styled cart line server-side (snapshots are never trusted) using
// the catalogue composer, and resolve the base variant for stock/fulfilment.
async function resolveStyledLine({ brand, item }) {
  const { rows: r0 } = await query(
    `SELECT styled_id FROM ${brand}.styled_product_variants
      WHERE styled_variant_id = $1 AND is_active = true AND is_deleted = false`,
    [item.styled_variant_id],
  );
  if (!r0[0])
    throw new AppError(
      "STYLED_VARIANT_UNAVAILABLE",
      "One of your items is no longer available. Please remove it and try again.",
      409,
    );
  const styled_id = r0[0].styled_id;
  const [variants, styled] = await Promise.all([
    styledVariantsRepo.listVariants({ brand, styled_id }),
    styledRepo.getById({ brand, id: styled_id }),
  ]);
  const v = variants.find(
    (x) => x.styled_variant_id === item.styled_variant_id,
  );
  if (!v || !styled || styled.is_deleted || styled.status !== "live")
    throw new AppError(
      "STYLED_VARIANT_UNAVAILABLE",
      "One of your items is no longer available. Please remove it and try again.",
      409,
    );
  const unit = item.unstyled
    ? money(styled.retail_price_ngn || 0)
    : money(v.effective_price_ngn || 0);
  if (!unit.gt(0))
    throw new AppError(
      "STYLED_NOT_PRICED",
      "This item isn't available for purchase right now.",
      409,
    );
  let baseVariantId = styled.base_variant_id;
  if (!baseVariantId)
    baseVariantId = await defaultVariantId({
      brand,
      product_id: styled.base_product_id,
    });
  if (!baseVariantId)
    throw new AppError(
      "STYLED_NO_BASE_VARIANT",
      "This item isn't available for purchase right now.",
      409,
    );
  const label = item.unstyled
    ? [v.colour_name, v.size_label, "Unstyled"].filter(Boolean).join(" · ")
    : [v.colour_name, v.size_label, v.lace_label || v.lace_code]
        .filter(Boolean)
        .join(" · ");
  return {
    variant_id: baseVariantId,
    quantity: item.quantity,
    unit_price_ngn: toCurrencyString(unit),
    product_name_snapshot: styled.name,
    variant_label_snapshot: label || null,
    sku_snapshot: v.sku || null,
  };
}

// Expand a bundle to base-variant order lines + the bundle discount. The
// discount comes from the retention module's decorated economics (discount_ngn)
// — the SAME figure the storefront displayed — so checkout never diverges from
// the cart. Components resolve styled → base variant for stock, like a styled
// line. Mirrors the campaign's resolveBundleForCheckout, for bundle_offers.
async function resolveStorefrontBundle({ brand, bundle_id, copies }) {
  const units = Math.max(1, Number(copies) || 1);
  const bundle = await bundleService
    .getBundle({ brand, id: bundle_id })
    .catch(() => null);
  if (!bundle || !bundle.is_active)
    throw new AppError(
      "BUNDLE_UNAVAILABLE",
      "This bundle is no longer available. Please remove it and try again.",
      409,
    );
  const components = await bundleRepo.listComponents({ brand, bundle_id });
  if (!components.length)
    throw new AppError("BUNDLE_EMPTY", "This bundle has no items.", 409);

  const orderLines = [];
  for (const comp of components) {
    const compQty = Number(comp.quantity) || 1;
    let variant_id = comp.variant_id;
    if (!variant_id && comp.styled_id) {
      const styled = await styledRepo.getById({ brand, id: comp.styled_id });
      variant_id =
        (styled && styled.base_variant_id) ||
        (await defaultVariantId({
          brand,
          product_id: styled && styled.base_product_id,
        }));
    }
    if (!variant_id && comp.product_id)
      variant_id = await defaultVariantId({ brand, product_id: comp.product_id });
    if (!variant_id)
      throw new AppError(
        "BUNDLE_COMPONENT_UNAVAILABLE",
        "One of the items in your bundle is no longer available. Please remove the bundle and try again.",
        409,
      );
    orderLines.push({
      variant_id,
      quantity: compQty * units,
      unit_price_ngn: toCurrencyString(money(comp.unit_price_ngn || 0)),
      product_name_snapshot: comp.styled_name || comp.product_name || null,
    });
  }
  // discount_ngn is per single bundle (decorateBundle) → × copies.
  const discountNgn = money(bundle.discount_ngn || 0).times(units);
  return { orderLines, discountNgn };
}

// Resolve every cart line to sellable order lines + the accumulated bundle
// discount. Styled → base variant + styled price; bundle → expanded components
// + discount; base product → its variant. Prices never trusted from the client.
async function resolveCartToOrderLines({ brand, items }) {
  const orderLines = [];
  let bundleDiscountNgn = money(0);
  for (const ci of items) {
    if (ci.bundle_id) {
      const resolved = await resolveStorefrontBundle({
        brand,
        bundle_id: ci.bundle_id,
        copies: ci.quantity,
      });
      orderLines.push(...resolved.orderLines);
      bundleDiscountNgn = bundleDiscountNgn.plus(resolved.discountNgn);
    } else if (ci.styled_variant_id) {
      orderLines.push(
        await resolveStyledLine({
          brand,
          item: {
            styled_variant_id: ci.styled_variant_id,
            unstyled: ci.unstyled,
            quantity: ci.quantity,
          },
        }),
      );
    } else {
      let variant_id = ci.variant_id;
      if (!variant_id)
        variant_id = await defaultVariantId({
          brand,
          product_id: ci.product_id,
        });
      if (!variant_id)
        throw new AppError(
          "CART_ITEM_UNRESOLVED",
          "One of your items is no longer available. Please remove it and try again.",
          409,
        );
      orderLines.push({ variant_id, quantity: ci.quantity });
    }
  }
  return { orderLines, bundleDiscountNgn };
}

/**
 * Storefront checkout. Loads the persistent cart, upserts the contact + address,
 * resolves the cart to server-priced order lines, quotes delivery (fail-closed),
 * raises the order through salesService.createOrder (channel 'storefront' → same
 * outbox as every channel), snapshots the display currency via
 * catalogue_config.usd_fx_rate, marks the cart converted, and returns a payment
 * link. Prices are NEVER trusted from the client.
 */
async function checkout({ brand, cart_id, input = {} }) {
  const cart = await cartRepo.findCartById({ id: cart_id });
  if (!cart || cart.business !== brand || cart.status !== "active")
    throw new NotFoundError("Cart");
  const items = await cartRepo.listCartItems({ cart_id });
  if (!items.length)
    throw new AppError("EMPTY_CART", "Your cart is empty.", 400);

  const c = input.contact || {};
  const isPickup = input.fulfilment_type === "pickup";
  if (!isPickup) {
    const a = c.address;
    if (!a || !a.line1 || !a.city)
      throw new AppError(
        "ADDRESS_REQUIRED",
        "Please enter your delivery address (or choose store pickup).",
        422,
      );
  }

  // 1. Contact + address upsert (own transaction; address save in a SAVEPOINT).
  const { contact, deliveryAddress } = await transaction(async (client) => {
    const email = (c.email || "").toLowerCase().trim() || null;
    const phone = normalizePhone(c.phone);
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
          source: "storefront_checkout",
          visible_to: [brand],
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
        "storefront checkout address save fell back to existing",
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

  // 2. Resolve cart → order lines (server-priced) + bundle discount.
  const { orderLines, bundleDiscountNgn } = await resolveCartToOrderLines({
    brand,
    items,
  });
  if (!orderLines.length)
    throw new AppError("EMPTY_ORDER", "No valid items in the cart", 400);

  // 3. Delivery fee (fail closed: a delivery order must resolve a real zone
  //    AND a real, positive fee — zero exceptions, see the guard below).
  let shippingFeeNgn = 0;
  let deliveryQuote = null;
  if (!isPickup) {
    const addr = c.address || {};
    const zoneCode = addr.zone_code || addr.country_code || null;
    const wigQty = orderLines.reduce(
      (s, l) => s + (Number(l.quantity) || 0),
      0,
    );
    if (!zoneCode)
      throw new AppError(
        "DELIVERY_LOCATION_REQUIRED",
        "Delivery order has no resolvable zone/country code",
        422,
        {
          user_message:
            "Please pick your country from the list (and your state, plus your LGA for Lagos) so we can calculate delivery before you pay.",
        },
      );
    deliveryQuote = await zonesService
      .quote({ brand, country_code: zoneCode, qty: wigQty })
      .catch((err) => {
        logger.warn(
          { err: err.message, zoneCode },
          "storefront delivery quote failed",
        );
        return null;
      });
    if (
      !deliveryQuote ||
      deliveryQuote.fee_ngn === null ||
      deliveryQuote.fee_status === "unserviceable"
    )
      throw new AppError(
        "DELIVERY_UNAVAILABLE",
        `No delivery zone covers '${zoneCode}'`,
        422,
        {
          user_message:
            "We couldn't calculate delivery for that location. Please double-check your country, state and city — or contact us and we'll complete your order.",
        },
      );
    shippingFeeNgn = Number(deliveryQuote.fee_ngn) || 0;
    // ── FAIL CLOSED — ZERO EXCEPTIONS (owner mandate) ──────
    // A delivery order MUST carry a real, positive shipping fee. There is no
    // longer any escape hatch: not a "free"-marked zone, not a "pending"
    // config-gap, not a campaign threshold — if the resolved fee is not
    // strictly greater than ₦0, the checkout is refused outright. Pickup is the
    // only fulfilment that ships at ₦0. If someone picks delivery, they do not
    // leave this point without a delivery fee that has an amount.
    if (!(shippingFeeNgn > 0))
      throw new AppError(
        "DELIVERY_FEE_REQUIRED",
        `Delivery order resolved to a non-billable shipping fee (zone='${zoneCode}', status='${deliveryQuote.fee_status}')`,
        422,
        {
          user_message:
            "We couldn't charge a delivery fee for that address. Please double-check your country, state and city — or choose store pickup. We can't take a delivery order without a delivery fee.",
        },
      );
  }

  const stylistReferralCode = await resolveStylistReferral(
    input.referral_code,
  );

  // 4. Create the sales order (same engine + outbox as every channel).
  const order = await salesService.createOrder({
    brand,
    user: { user_id: null },
    request_id: input.client_idempotency_key,
    input: {
      contact_id: contact.contact_id,
      sales_channel: "storefront",
      order_type: "dispatch",
      lines: orderLines,
      shipping_fee_ngn: shippingFeeNgn,
      coupon_code: input.coupon_code || null,
      stylist_referral_code: stylistReferralCode,
      // Loyalty points redemption (optional) — createOrder validates + caps it.
      redeem_points: input.redeem_points || undefined,
      // Bundle savings folded into the order-level deal discount (floor-respecting
      // in createOrder). Same mechanism the campaign checkout uses; the figure is
      // the decorated bundle discount the storefront already displayed.
      campaign_deal_discount_ngn: bundleDiscountNgn.gt(money(0))
        ? toCurrencyString(bundleDiscountNgn)
        : undefined,
      client_idempotency_key: input.client_idempotency_key,
      utm_source: input.utm?.utm_source || null,
      utm_medium: input.utm?.utm_medium || null,
      utm_campaign: input.utm?.utm_campaign || null,
    },
  });

  // 5. Metadata + currency snapshot (storefront uses catalogue_config.usd_fx_rate).
  const cfg = await styledVariantsRepo.getConfig({ brand }).catch(() => null);
  const displayCurrency = String(input.display_currency || "NGN").toUpperCase();
  const fxRate =
    cfg && cfg.usd_fx_rate !== null && cfg.usd_fx_rate !== undefined
      ? Number(cfg.usd_fx_rate)
      : null;
  let displayTotal = null;
  let fxRateUsed = null;
  if (displayCurrency !== "NGN" && fxRate && fxRate > 0) {
    displayTotal = toCurrencyString(
      money(order.total_ngn).dividedBy(money(fxRate)).ceil(),
    );
    fxRateUsed = fxRate;
  }
  const internal = {
    fulfilment_type: isPickup ? "pickup" : "delivery",
    channel: "storefront",
  };
  if (!isPickup && deliveryQuote && deliveryQuote.zone_id) {
    internal.delivery = {
      zone_name: deliveryQuote.zone_name,
      courier_key: deliveryQuote.courier_key,
      country_code: deliveryQuote.country_code,
      fee_ngn: shippingFeeNgn,
      fee_status: deliveryQuote.fee_status || null,
    };
  }
  const addressSnapshot = deliveryAddress
    ? {
        line1: deliveryAddress.line1,
        line2: deliveryAddress.line2,
        city: deliveryAddress.city,
        state: deliveryAddress.state,
        country: deliveryAddress.country,
        country_code: deliveryAddress.country_code,
        recipient_name: deliveryAddress.recipient_name,
        recipient_phone: deliveryAddress.recipient_phone,
      }
    : null;
  const customerParts = [];
  if (c.notes) customerParts.push(c.notes);
  if (isPickup) customerParts.push("PICKUP / collect in store — no delivery.");
  else if (internal.delivery) {
    customerParts.push(
      `Delivery zone: ${internal.delivery.zone_name} (${internal.delivery.courier_key}).`,
    );
  }
  try {
    await query(
      `UPDATE ${brand}.sales_orders
          SET customer_notes = $1, internal_notes = $2,
              delivery_address_id = COALESCE($3, delivery_address_id),
              delivery_address_snapshot = COALESCE($4::jsonb, delivery_address_snapshot),
              display_currency = $6, display_total = $7,
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
    logger.warn(
      { err, order_id: order.order_id },
      "storefront checkout meta skipped",
    );
  }

  // 6. Mark the cart converted (best-effort; the order is the source of truth).
  try {
    await cartRepo.updateCart({
      cart_id,
      patch: { status: "converted", converted_order_id: order.order_id },
    });
  } catch (err) {
    logger.warn({ err, cart_id }, "cart convert flag skipped");
  }

  // 7. Initiate payment. NGN → buyer's pick (Nomba default, Paystack); USD → Nomba.
  const checkoutCurrency = displayCurrency;
  const allowed = ["nomba", "paystack"];
  const preferredProvider =
    checkoutCurrency === "USD"
      ? "nomba"
      : input.payment_gateway && allowed.includes(input.payment_gateway)
        ? input.payment_gateway
        : "nomba";
  let payResult;
  try {
    payResult = await paymentLink.createPaymentLink({
      brand,
      order_id: order.order_id,
      currency: checkoutCurrency,
      preferred_provider: preferredProvider,
      // Return the buyer to the storefront thank-you page (gateway appends
      // ?ref & order_id). Falls back to the Hub default when not provided.
      return_url_base: input.return_url_base || undefined,
    });
  } catch (err) {
    logger.error(
      {
        err: err.message,
        order_id: order.order_id,
        currency: checkoutCurrency,
      },
      "storefront payment init failed after order creation",
    );
    throw new AppError(
      "PAYMENT_INIT_FAILED",
      "Order created but payment could not be initiated",
      502,
      {
        user_message:
          "Your order is saved but we couldn't start the payment. Please tap pay again to retry — you won't be charged twice.",
        metadata: {
          order_id: order.order_id,
          retryable: checkoutCurrency !== "USD",
        },
      },
    );
  }

  return {
    order_id: order.order_id,
    order_number: order.order_number,
    payment_url: payResult.checkout_url,
    public_tracking_token: order.public_tracking_token || null,
  };
}

/**
 * Server-authoritative cart quote for the cart/checkout page. Re-prices lines
 * (styled via the catalogue composer), quotes delivery if an address is given,
 * and totals in NGN + the display currency (USD via catalogue_config.usd_fx_rate).
 * Coupon discounts are applied at checkout (createOrder), not in this preview.
 */
async function quoteCart({
  brand,
  cart_id,
  address = null,
  display_currency = "NGN",
}) {
  const cart = await cartRepo.findCartById({ id: cart_id });
  if (!cart || cart.business !== brand) throw new NotFoundError("Cart");
  const items = await cartRepo.listCartItems({ cart_id });

  let subtotal = money(0);
  const lines = [];
  for (const ci of items) {
    let unit;
    if (ci.styled_variant_id) {
      const resolved = await resolveStyledLine({
        brand,
        item: {
          styled_variant_id: ci.styled_variant_id,
          unstyled: ci.unstyled,
          quantity: ci.quantity,
        },
      }).catch(() => null);
      unit = resolved
        ? money(resolved.unit_price_ngn)
        : money(ci.unit_price_ngn || 0);
    } else if (ci.bundle_id) {
      // Bundle: the decorated effective price (matches what checkout charges).
      const b = await bundleService
        .getBundle({ brand, id: ci.bundle_id })
        .catch(() => null);
      unit = b ? money(b.effective_price_ngn || 0) : money(ci.unit_price_ngn || 0);
    } else {
      unit = money(ci.unit_price_ngn || 0);
    }
    const lineTotal = unit.times(ci.quantity || 1);
    subtotal = subtotal.plus(lineTotal);
    lines.push({
      cart_item_id: ci.cart_item_id,
      name: ci.product_name_snapshot,
      variant_label: ci.variant_label_snapshot || null,
      quantity: ci.quantity,
      unit_price_ngn: toCurrencyString(unit),
      line_total_ngn: toCurrencyString(lineTotal),
    });
  }

  let deliveryNgn = 0;
  const zoneCode = address && (address.zone_code || address.country_code);
  if (zoneCode) {
    const wigQty = items.reduce((s, ci) => s + (Number(ci.quantity) || 0), 0);
    const dq = await zonesService
      .quote({ brand, country_code: zoneCode, qty: wigQty })
      .catch(() => null);
    if (dq && dq.fee_ngn !== null && dq.fee_ngn !== undefined)
      deliveryNgn = Number(dq.fee_ngn) || 0;
  }

  // Coupon preview (best-effort): the authoritative discount is applied at
  // checkout by createOrder. Here we just show the buyer an estimate.
  let discountNgn = money(0);
  if (cart.applied_coupon_id) {
    try {
      const { rows } = await query(
        `SELECT code FROM shared.coupons WHERE coupon_id = $1`,
        [cart.applied_coupon_id],
      );
      const code = rows[0] && rows[0].code;
      if (code) {
        const res = await couponService.validateCoupon({
          brand,
          code,
          order_subtotal_ngn: Number(toCurrencyString(subtotal)),
        });
        if (res && res.valid) discountNgn = money(res.discount_ngn || 0);
      }
    } catch {
      /* preview only — ignore coupon errors here */
    }
  }

  const totalNgn = subtotal.minus(discountNgn).plus(money(deliveryNgn));
  const cfg = await styledVariantsRepo.getConfig({ brand }).catch(() => null);
  const fxRate =
    cfg && cfg.usd_fx_rate !== null && cfg.usd_fx_rate !== undefined
      ? Number(cfg.usd_fx_rate)
      : null;
  const cur = String(display_currency || "NGN").toUpperCase();
  const toDisplay = (m) =>
    cur === "USD" && fxRate && fxRate > 0
      ? toCurrencyString(m.dividedBy(money(fxRate)).ceil())
      : null;

  return {
    lines,
    subtotal_ngn: toCurrencyString(subtotal),
    discount_ngn: toCurrencyString(discountNgn),
    delivery_ngn: toCurrencyString(money(deliveryNgn)),
    total_ngn: toCurrencyString(totalNgn),
    display_currency: cur,
    subtotal_display: toDisplay(subtotal),
    discount_display: toDisplay(discountNgn),
    delivery_display: toDisplay(money(deliveryNgn)),
    total_display: toDisplay(totalNgn),
    fx_rate_used: cur === "USD" ? fxRate : null,
  };
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

  // Nearby-stylists is hidden until the stylist site (stylist.<brand>) exists
  // (guide §5.7) — keep the block but serve [] for now.
  const careGuides = await repo.listCareGuides({ brand }).catch(() => []);
  const stylists = [];

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
  listShades,
  getShade,
  listCollections,
  listBundles,
  getBundle,
  getSite,
  listContent,
  getContent,
  submitOrderForm,
  checkout,
  quoteCart,
  startSession,
  recordPageView,
  recordFunnelEvent,
  getInstallHub,
};
