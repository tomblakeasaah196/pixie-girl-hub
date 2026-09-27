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
const rewigService = require("../catalogue/rewig.service");
// PR 2 — typed Care & Accessories resolution (PXG-gated, sellable-only).
const retailResolver = require("../catalogue/retail-resolver");
const careGate = require("../catalogue/care-accessories.gate");
const {
  computeAvailability,
  reduceBundleAvailability,
} = require("../catalogue/availability");
const salesService = require("../sales/sales.service");
const bundleRepo = require("../retention/bundle.repo");
const bundleService = require("../retention/bundle.service");
const couponService = require("../retention/coupon.service");
const cartRepo = require("./cart.repo");
const contactsRepo = require("../../shared/contacts/contacts.repo");
const zonesService = require("../logistics/zones.service");
const paymentLink = require("../sales/payment-link.service");
const currencyService = require("../../services/currency.service");
const usdPricing = require("../../services/usd-pricing.service");
const { transaction, query } = require("../../config/database");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");
const jwt = require("jsonwebtoken");
const { config } = require("../../config/env");

const SYSTEM_USER = { user_id: null };

// ── Colour videos → gallery media ──────────────────────────
// A colour can carry ONE merchandising video: a self-hosted upload
// (styled_product_colours.video_url) or a link the owner pastes in the
// Catalogue's "Video / Instagram link" box (external_video_url). The product
// detail gallery renders the SAME shape as the base-level product_videos rows,
// so we classify the pasted URL into that shape here. Same host regexes the
// storefront/landing players already use; unrecognised links are dropped rather
// than shown with a mislabeled play button.
const YT_RE =
  /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/;
const IG_RE = /instagram\.com\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i;
const TT_RE =
  /tiktok\.com\/(?:@[^/]+\/video\/(\d+)|v\/(\d+)|t\/([A-Za-z0-9]+))/i;
const VIDEO_FILE_RE = /\.(mp4|webm|mov|m4v|ogg)(\?.*)?$/i;

/**
 * Turn a raw pasted colour URL into the storefront gallery-video shape
 * ({ source, external_ref, embed_url, thumbnail_url }), or null when it isn't a
 * link we can render. `selfHosted` marks the video_url column — a playable file
 * by contract — so it falls back to a native <video> (direct_upload) when it
 * doesn't match a known host.
 */
function classifyColourVideo(rawUrl, { selfHosted = false } = {}) {
  const url = String(rawUrl || "").trim();
  if (!url) return null;

  const yt = url.match(YT_RE);
  if (yt) {
    return {
      source: "youtube",
      external_ref: yt[1],
      embed_url: url,
      thumbnail_url: `https://i.ytimg.com/vi/${yt[1]}/hqdefault.jpg`,
    };
  }
  const ig = url.match(IG_RE);
  if (ig) {
    return {
      source: "instagram_reel",
      external_ref: ig[1],
      embed_url: url,
      thumbnail_url: null,
    };
  }
  const tt = url.match(TT_RE);
  if (tt) {
    return {
      source: "tiktok",
      external_ref: tt[1] || tt[2] || tt[3] || url,
      embed_url: url,
      thumbnail_url: null,
    };
  }
  if (selfHosted || VIDEO_FILE_RE.test(url)) {
    return {
      source: "direct_upload",
      external_ref: url,
      embed_url: url,
      thumbnail_url: null,
    };
  }
  return null;
}

/**
 * Build gallery-video rows for a product's colours. Each colour surfaces at most
 * one video (its self-hosted upload wins over a pasted link), tagged with
 * styled_colour_id so the detail page scopes it to the matching swatch — the
 * same rule its pictures already follow.
 */
function colourVideos(colours) {
  const out = [];
  for (const c of colours || []) {
    const item =
      classifyColourVideo(c.video_url, { selfHosted: true }) ||
      classifyColourVideo(c.external_video_url);
    if (!item) continue;
    out.push({
      video_id: `colour:${c.colour_id}`,
      styled_colour_id: c.colour_id,
      title: c.name || null,
      caption: null,
      duration_seconds: null,
      is_primary: false,
      ...item,
    });
  }
  return out;
}

// ── Catalogue ──────────────────────────────────────────────

/** Resolve the brand's pre-order policy for computeAvailability (000086).
 *  Defaults to on / 4–8 weeks when the catalogue_config row is missing. */
async function preorderPolicy(brand) {
  const cfg = await styledVariantsRepo.getConfig({ brand }).catch(() => null);
  return {
    enabled: cfg ? cfg.preorder_enabled : true,
    min_weeks: cfg ? cfg.preorder_min_weeks : 4,
    max_weeks: cfg ? cfg.preorder_max_weeks : 8,
  };
}

/**
 * Enrich a set of product cards with their in-stock / pre-order / sold-out
 * state IN PLACE (000086). Batches one availabilityForStyled read + the brand
 * policy, then sets card.availability via computeAvailability — the same result
 * the shop grid derives inline — so home carousels, collection/shade pages,
 * related rails and AI-search cards all read one shared computation. A caller
 * that already resolved the policy can pass it to avoid a second config read.
 * Cards without a styled_id are left untouched.
 */
async function attachAvailability(brand, cards, policy = null) {
  const list = (Array.isArray(cards) ? cards : []).filter(
    (c) => c && c.styled_id,
  );
  if (!list.length) return cards;
  const pol = policy || (await preorderPolicy(brand));
  const rows = await repo.availabilityForStyled({
    brand,
    styled_ids: [...new Set(list.map((c) => c.styled_id))],
  });
  const byId = new Map(rows.map((r) => [r.styled_id, r]));
  for (const card of list) {
    const base = byId.get(card.styled_id) || {};
    card.availability = computeAvailability(base.base_available, {
      base: {
        preorder_enabled: base.preorder_enabled,
        preorder_excluded: base.preorder_excluded,
        expected_ready_date: base.expected_ready_date,
        production_lead_days: base.production_lead_days,
      },
      policy: pol,
    });
  }
  return cards;
}

/**
 * Compute BUNDLE-level availability IN PLACE for one or more bundles (000086).
 * Resolves each component's base availability through the SAME query the cart
 * uses (cart.repo.bundleComponentAvailability), keyed by bundle_id — so the
 * bundle list/detail page and the bag compute from IDENTICAL inputs. That query
 * counts BOTH styled components (styled → base) AND raw base-product components
 * (bundle_offer_products.product_id with a null styled_id), via COALESCE, so a
 * bundle whose out-of-stock item is a raw base product no longer reads
 * "in stock" on the page while the cart shows pre-order/sold-out (a real
 * divergence once catalogue_config.allow_base_in_collections_bundles is on).
 * The component states reduce to a bundle badge via reduceBundleAvailability —
 * sold out if any piece is a hard sold-out, pre-order on the longest window if
 * any piece is made to order, else in stock. Sets bundle.availability.
 */
async function attachBundleAvailability(brand, bundles) {
  const list = (Array.isArray(bundles) ? bundles : [bundles]).filter(Boolean);
  if (!list.length) return bundles;
  const bundleIds = list.map((b) => b.bundle_id).filter(Boolean);
  const [rows, pol] = await Promise.all([
    bundleIds.length
      ? cartRepo.bundleComponentAvailability({ brand, bundle_ids: bundleIds })
      : Promise.resolve([]),
    preorderPolicy(brand),
  ]);
  const byBundle = new Map();
  for (const r of rows) {
    const arr = byBundle.get(r.bundle_id) || [];
    arr.push(r);
    byBundle.set(r.bundle_id, arr);
  }
  for (const b of list) {
    const parts = (byBundle.get(b.bundle_id) || []).map((row) =>
      computeAvailability(row.base_available, {
        base: {
          preorder_enabled: row.preorder_enabled,
          preorder_excluded: row.preorder_excluded,
          expected_ready_date: row.expected_ready_date,
          production_lead_days: row.production_lead_days,
        },
        policy: pol,
      }),
    );
    b.availability = reduceBundleAvailability(parts);
  }
  return bundles;
}

async function listProducts(args) {
  const [result, cfg] = await Promise.all([
    repo.listProducts(args),
    styledVariantsRepo.getConfig({ brand: args.brand }),
  ]);
  const policy = {
    enabled: cfg ? cfg.preorder_enabled : true,
    min_weeks: cfg ? cfg.preorder_min_weeks : 4,
    max_weeks: cfg ? cfg.preorder_max_weeks : 8,
  };
  // Enrich each card with its in-stock / pre-order / sold-out state, then drop
  // the raw base columns the card query carried only to compute it.
  const data = (result.data || []).map((row) => {
    const availability = computeAvailability(row.base_available, {
      base: {
        preorder_enabled: row.preorder_enabled,
        preorder_excluded: row.preorder_excluded,
        expected_ready_date: row.expected_ready_date,
        production_lead_days: row.production_lead_days,
      },
      policy,
    });
    const card = { ...row, availability };
    delete card.base_available;
    delete card.preorder_enabled;
    delete card.preorder_excluded;
    delete card.expected_ready_date;
    delete card.production_lead_days;
    return card;
  });
  return { ...result, data };
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

  const [allVariants, gallery, colours, tiers, laces, cfg, socialProof, videos, relatedProducts, baseAvailable] =
    await Promise.all([
      styledVariantsRepo.listVariants({ brand, styled_id }),
      repo.listStyledGallery({ brand, styled_id }),
      repo.listColourGalleries({ brand, styled_id }),
      styledVariantsRepo.listSizeTiers({ brand, activeOnly: true }),
      styledVariantsRepo.listLaceSizes({ brand, activeOnly: true }),
      styledVariantsRepo.getConfig({ brand }),
      repo.getSocialProof({ brand, styled_id }),
      repo.listProductVideos({ brand, product_id: styled.base_product_id }),
      repo.listRelatedProducts({
        brand,
        base_product_id: styled.base_product_id,
        category_id: styled.category_id,
        exclude_styled_id: styled_id,
      }),
      styledRepo.styledAvailability({ brand, styled_id }),
    ]);

  // In stock / pre-order / sold out (000086). Universal pre-orders: an
  // out-of-stock item is offered as a pre-order on the brand's production
  // window (Catalogue → Config) unless the product is opted out.
  const policy = {
    enabled: cfg ? cfg.preorder_enabled : true,
    min_weeks: cfg ? cfg.preorder_min_weeks : 4,
    max_weeks: cfg ? cfg.preorder_max_weeks : 8,
  };
  const availability = computeAvailability(baseAvailable, {
    base: {
      preorder_enabled: styled.preorder_enabled,
      preorder_excluded: styled.preorder_excluded,
      expected_ready_date: styled.expected_ready_date,
      production_lead_days: styled.production_lead_days,
    },
    policy,
  });
  // "You May Also Love" cards carry the same in-stock / pre-order / sold-out
  // badge as the shop grid (000086). Reuse the policy we just resolved.
  await attachAvailability(brand, relatedProducts, policy);

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
    availability,
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
      // Per-variant stock behind this colour×size's OWN base (falls back to
      // the seed base), so the size picker can grey out sold-out sizes while
      // others stay purchasable.
      available: Number(v.base_available || 0),
      availability: computeAvailability(v.base_available, {
        base: {
          preorder_enabled: styled.preorder_enabled,
          preorder_excluded: styled.preorder_excluded,
          expected_ready_date: styled.expected_ready_date,
          production_lead_days: styled.production_lead_days,
        },
        policy,
      }),
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
    // "As seen on Instagram" badge — null when nothing's been proven-posted
    // tagging this product yet.
    social_proof: socialProof
      ? {
          platform: socialProof.platform,
          url: socialProof.external_url,
          thumbnail_url: socialProof.oembed_thumbnail_url,
          author_handle: socialProof.oembed_author_handle,
        }
      : null,
    // Media gallery videos (YouTube/Reels/TikTok/direct upload). Two sources
    // feed the rail: base-product videos (product_videos, merchandised once and
    // shown on every styled skin — styled_colour_id null so they always show)
    // and each colour's own pasted/uploaded video (scoped to its swatch).
    videos: [
      ...videos.map((v) => ({
        video_id: v.video_id,
        styled_colour_id: null,
        source: v.source,
        external_ref: v.external_ref,
        embed_url: v.embed_url,
        thumbnail_url: v.thumbnail_url,
        title: v.title,
        caption: v.caption,
        duration_seconds: v.duration_seconds,
        is_primary: v.is_primary,
      })),
      ...colourVideos(colours),
    ],
    // "You May Also Love" — curated product_related, topped up from the same
    // category so the rail is never empty.
    related_products: relatedProducts.map((p) => ({
      styled_id: p.styled_id,
      name: p.name,
      slug: p.slug,
      short_description: p.short_description,
      cover_image_url: p.cover_image_url,
      effective_price_ngn: p.effective_price_ngn,
      effective_price_usd: p.effective_price_usd,
      availability: p.availability ?? null,
    })),
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
  // Pre-order / sold-out badge per product card (000086).
  await attachAvailability(brand, collection.products);
  return collection;
}

function listShades({ brand }) {
  return repo.listShades({ brand });
}

async function getShade({ brand, slug }) {
  const shade = await repo.getShadeBySlug({ brand, slug });
  if (!shade) throw new NotFoundError("Shade");
  // Pre-order / sold-out badge per product card (000086).
  await attachAvailability(brand, shade.products);
  return shade;
}

function listCollections({ brand }) {
  return repo.listCollections({ brand });
}

async function listBundles({ brand }) {
  const bundles = await repo.listBundles({ brand });
  // Bundle-level pre-order / sold-out badge on the bundles grid (000086).
  await attachBundleAvailability(brand, bundles);
  return bundles;
}

async function getBundle({ brand, slug }) {
  // URL "slug" is the bundle_code (bundle_offers has no slug column).
  const bundle = await repo.getBundleByCode({ brand, code: slug });
  if (!bundle) throw new NotFoundError("Bundle");
  // Bundle-level pre-order / sold-out badge on the bundle detail (000086).
  await attachBundleAvailability(brand, bundle);
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

// The storefront detail pages (journal, policy) render `body_md` (safe,
// pre-wrapped) or `body_html`. Content posts store the copy in `body`, so
// alias it to `body_md` on the way out. We never emit body_html — no raw HTML
// is injected from operator input.
//
// The listing/detail pages also render a `cover_image_url` — the DB column is
// `hero_image_url`, so that needs the same aliasing (previously missing:
// every published journal post's hero image silently failed to render on
// faitlynhair.com/journal, even though it was correctly stored and shown in
// Storefront Studio). `content_blocks` (journal's rich block body, see
// migration 000338) passes through as-is — it is structured JSON, not markup,
// so there is no injection risk in emitting it verbatim.
function withRenderableBody(post) {
  if (!post) return post;
  return {
    ...post,
    body_md: post.body ?? null,
    cover_image_url: post.hero_image_url ?? null,
    content_blocks: Array.isArray(post.content_blocks) ? post.content_blocks : [],
  };
}

async function listContent({ brand, type }) {
  const posts = await repo.listContentPosts({ brand, type });
  return posts.map(withRenderableBody);
}

async function getContent({ brand, type, slug }) {
  const post = await repo.getContentPost({ brand, type, slug });
  if (!post) throw new NotFoundError("Content");
  return withRenderableBody(post);
}

// ── Public Order Form ──────────────────────────────────────
async function submitOrderForm({ brand, input, request_id }) {
  const productItems = Array.isArray(input.items) ? input.items : [];
  const serviceBookings = Array.isArray(input.service_bookings)
    ? input.service_bookings
    : [];
  if (productItems.length === 0 && serviceBookings.length === 0)
    throw new AppError("NO_ITEMS", "At least one item is required", 422);

  // Nothing in this body is trusted until it is matched against a live order
  // link (see authoriseOrderForm). `bookings` carry the server's prices.
  const authorised = await authoriseOrderForm({
    brand,
    input,
    productItems,
    serviceBookings,
  });
  const linkLineOf = (variant_id) =>
    authorised.substitutions.get(variant_id) || variant_id;

  // Never trust a client-supplied shipping_fee_ngn for a delivery order —
  // re-quote it from the logistics zones every time, exactly like the
  // main storefront checkout (sale/:slug/checkout). Pickup is the only
  // ₦0 fulfilment; a delivery order with no resolvable zone or a
  // "pending" (unconfigured) fee is rejected rather than silently
  // shipped for free or at a client-chosen price. Service-only
  // checkouts ship nothing, so no zone/fee applies.
  const fulfilmentType =
    productItems.length === 0 ? "pickup" : input.fulfilment_type || "delivery";

  // PR 3: which submitted lines are Care & Accessories SKUs? Resolved
  // server-side from the variant ids through the same typed resolver the cart
  // and main checkout use — never from a client-supplied flag, and never from
  // the link row alone (a shopper POSTs the items, so the POST body is what has
  // to be classified). FLH and gated-off PXG simply have no retail rows, so
  // this is a no-op for them and their behaviour is unchanged.
  const retailIds = await retailResolver.retailVariantIds({
    brand,
    variant_ids: productItems.map((it) => it.variant_id),
  });
  const hasRetail = retailIds.size > 0;

  let shipping_fee_ngn = 0;
  if (fulfilmentType === "delivery" && hasRetail) {
    // MONEY PATH STOPPED — identical rule to the main storefront checkout.
    // The owner has not approved the provisional initial-zone-fee assumption
    // (no issue, no discussion, no PR decision exists), so a retail-containing
    // /o delivery must not be charged ANY delivery figure: not a guessed zone
    // fee derived from a wig rate card that would count combs as wigs, and
    // never ₦0. Pickup is the paid self-serve option; staff arrange retail
    // deliveries manually and enter the fee themselves.
    throw new AppError(
      "RETAIL_DELIVERY_ARRANGED",
      "Retail-containing web delivery checkout is gated pending the owner's fee approval",
      422,
      {
        user_message:
          "EXTRA DELIVERY FEES MAY APPLY for orders containing care products. Delivery for these orders is arranged with our team — please choose store pickup, or contact us and we'll set up delivery for you.",
      },
    );
  }
  if (fulfilmentType === "delivery") {
    if (!input.zone_code)
      throw new AppError(
        "ZONE_REQUIRED",
        "A delivery zone (country/state/LGA) is required for delivery orders",
        422,
      );
    // Retail pieces NEVER count as extra wigs in the delivery tier. Today a
    // retail basket can't reach this quote at all (the gate above), but the
    // wig-only quantity stays correct for the day the fee assumption is
    // approved — several combs must not be charged as several wigs.
    const qty = productItems.reduce(
      (s, it) =>
        s + (retailIds.has(it.variant_id) ? 0 : Number(it.quantity || 0)),
      0,
    );
    const quote = await zonesService.quote({
      brand,
      country_code: input.zone_code,
      qty,
    });
    if (quote.fee_status !== "priced" && quote.fee_status !== "free") {
      throw new AppError(
        "DELIVERY_UNPRICED",
        "We couldn't calculate a delivery fee for that location yet — please choose pickup or try again shortly.",
        422,
      );
    }
    shipping_fee_ngn = Number(quote.fee_ngn) || 0;
  }

  // Staff-picked styled variant pricing: what a styled product costs depends
  // on the chosen head size / lace, picked by the operator when sharing the
  // catalogue and stored on the order-link row. Resolve those prices FROM THE
  // LINK ROW (never the POST body a shopper could tamper with) and apply them
  // as the line unit price, so the customer's order total matches the price
  // they were shown for that size/lace.
  const styledUnitPriceByVariant = await resolveStyledUnitPrices({
    brand,
    order_link_slug: input.order_link_slug,
  });

  // Shop-facing name/SKU/provenance per line, same "trust the link row"
  // rule as the price above — see resolveOrderLinkLineMeta.
  const lineMetaByVariant = await resolveOrderLinkLineMeta({
    brand,
    order_link_slug: input.order_link_slug,
  });

  // Credit the catalogue sharer for a link-driven checkout (Performance →
  // Insights). Resolved from the link row, never the POST body. Null for a
  // plain public order form → the sale counts in totals but is unattributed.
  const closedByUserId = await resolveOrderLinkSharer({
    brand,
    order_link_slug: input.order_link_slug,
  });

  // Lines without a staff-picked link price are charged at the variant's
  // channel price — refuse any that would be ₦0.
  await assertOrderFormPriced({
    brand,
    salesChannel: input.sales_channel || "public_form",
    variantIds: productItems
      .filter((it) => !styledUnitPriceByVariant.has(linkLineOf(it.variant_id)))
      .map((it) => it.variant_id),
  });

  const result = await transaction(async (client) => {
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

    // 1b. Inline welcome-form mirror (order links for threads with no
    //     linked customer): social handles + default delivery address
    //     land in the same tables the Online QR form writes.
    await upsertCheckoutContactExtras({ client, contact, input });

    // 2. Raise the order through the Sales engine (pricing/VAT/stock are
    //    its responsibility). Tag the channel for attribution. Service-
    //    only checkouts raise no product order — bookings carry the value.
    const order =
      productItems.length === 0
        ? null
        : await salesService.createOrder({
      brand,
      user: SYSTEM_USER,
      request_id,
      input: {
        contact_id: contact.contact_id,
        sales_channel: input.sales_channel || "public_form",
        order_type: fulfilmentType === "pickup" ? "collection" : "dispatch",
        lines: productItems.map((it) => ({
          variant_id: it.variant_id,
          quantity: it.quantity,
          // Apply the staff-picked styled variant price when this line's
          // variant was priced in the signed token; otherwise Sales prices
          // it by the variant's channel price as usual. A size-adjacent
          // sibling keeps the price of the link line it stands in for.
          ...(styledUnitPriceByVariant.has(linkLineOf(it.variant_id))
            ? { unit_price_ngn: styledUnitPriceByVariant.get(linkLineOf(it.variant_id)) }
            : {}),
          // Shop-facing name/SKU/provenance (resolved from the link row, never
          // the POST body) — without this a styled pick sells through its base
          // stock variant with no name override, so Sales falls back to the
          // raw base-product name on the invoice/receipt.
          ...(lineMetaByVariant.get(linkLineOf(it.variant_id)) || {}),
        })),
        shipping_fee_ngn,
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
        // Flexi Pay (PR-2): raise the order on the chosen plan. createOrder
        // re-validates instalment availability for this channel + snapshots the
        // deposit policy; the customer pays via the pay link they receive.
        payment_plan:
          input.payment_plan === "instalment" ? "instalment" : "full",
        client_idempotency_key: input.client_idempotency_key,
        stylist_referral_code: await resolveStylistReferral(
          input.referral_code,
        ),
        // Specific Instructions (Q1=A order-level, Q3=A checkbox)
        specific_instructions: (input.specific_instructions && String(input.specific_instructions).trim()) ? String(input.specific_instructions).trim().slice(0,2000) : undefined,
        // Attribute the sale to whoever shared the order link (if any).
        closed_by_user_id: closedByUserId,
      },
    });

    // 3. Order-link completion: mark the link used (single-use), file the
    //    service booking requests (at the SERVER's prices — see
    //    authoriseOrderForm), and announce everything in the thread. An
    //    idempotent replay of the link's own order skips this (already done).
    let bookings = [];
    let linkTaken = false;
    if (authorised.link && !authorised.replay) {
      // Savepoint: a thread-post/booking hiccup is logged and the order
      // stands, without poisoning the surrounding transaction.
      await client.query("SAVEPOINT order_link_completion");
      try {
        const orderLinks = require("../smartcomm/smartcomm.order-links.service");
        const done = await orderLinks.completeOrder({
          client,
          link_id: authorised.link.link_id,
          order_id: order ? order.order_id : null,
          order_number: order ? order.order_number : null,
          total_ngn: order ? order.total_ngn : null,
          contact_id: contact.contact_id,
          bookings: authorised.bookings,
        });
        // null = another checkout used this single-use link between our
        // check and now — this second order must not stand.
        if (!done) linkTaken = true;
        else bookings = done.bookings;
        await client.query("RELEASE SAVEPOINT order_link_completion");
      } catch (err) {
        await client
          .query("ROLLBACK TO SAVEPOINT order_link_completion")
          .catch(() => {});
        logger.warn(
          { err: err.message },
          "order-form: order-link completion failed (order stands)",
        );
      }
    } else if (!authorised.link && authorised.bookings.length) {
      // Service bookings can also arrive without a link (direct form use).
      const orderLinks = require("../smartcomm/smartcomm.order-links.repo");
      for (const b of authorised.bookings) {
        bookings.push(
          await orderLinks.createBookingRequest({
            client,
            booking: {
              business: brand,
              contact_id: contact.contact_id,
              service_id: b.service_id,
              order_id: order ? order.order_id : null,
              qty: b.qty,
              price_ngn: b.price_ngn,
              requested_for: b.requested_for,
              note: b.note,
            },
          }),
        );
      }
    }
    if (linkTaken)
      throw new AppError(
        "LINK_ALREADY_USED",
        "This order link has already been used to place an order",
        409,
        { user_message: "This order link has already been used. Ask the team for a fresh one." },
      );

    // The amount to charge at the gateway RIGHT NOW so the checkout page can
    // redirect straight to payment: the full balance for a pay-in-full order,
    // or the plan's deposit (min first payment) for an instalment order.
    // Computed server-side (the client never decides what to charge). Null
    // for service-only checkouts (no product order → nothing to pay yet).
    let pay_now_ngn = null;
    if (order) {
      if (order.payment_plan === "instalment") {
        try {
          const paymentSettings = require("../sales/payment-settings.service");
          const settings = await paymentSettings.getSettings(brand);
          pay_now_ngn = toCurrencyString(
            paymentSettings.minNextPaymentNgn(settings, order),
          );
        } catch {
          pay_now_ngn = null; // fall back to full balance at the pay step
        }
      } else {
        pay_now_ngn = toCurrencyString(money(order.total_ngn));
      }
    }

    return {
      order_id: order ? order.order_id : null,
      order_number: order ? order.order_number : null,
      total_ngn: order ? order.total_ngn : null,
      payment_model: order ? order.payment_model : null,
      payment_plan: order ? order.payment_plan : null,
      pay_now_ngn,
      public_tracking_token: (order && order.public_tracking_token) || null,
      contact_id: contact.contact_id,
      booking_count: bookings.length,
      // Pre-order notice threaded off the created order (000086) so the /o
      // order-link page can tell the buyer some items are made to order.
      preorder:
        order && order._preorder && order._preorder.is_preorder
          ? order._preorder
          : null,
      // PR 3: the exact owner-approved delivery disclosure, for both /o hosts
      // to render wherever this order's delivery amount is shown. "MAY" is
      // deliberate — a staff member calculates the real fee after the order is
      // placed, so this is a warning, not a promise, and not consent.
      has_care_items: hasRetail,
      care_delivery_notice: hasRetail ? "EXTRA DELIVERY FEES MAY APPLY" : null,
      // Retail never goes to Stylist Studio and is never made to order; the
      // confirmation copy on both /o pages keys off this so it can't promise
      // wig production for a bottle of oil.
      care_only: hasRetail && productItems.every((it) => retailIds.has(it.variant_id)),
    };
  });

  // Straight to the payment gateway for an order-link checkout: mint the
  // gateway checkout link server-side (exactly like the cart checkout) and
  // return it, so the /o page redirects the buyer to Nomba in ONE step — no
  // "we'll WhatsApp you a link" detour. Runs AFTER the transaction commits
  // (never hold the DB open across an external gateway call). A gateway hiccup
  // never fails the confirmed order — payment_url stays null and the page
  // retries via the public pay link (keyed by the tracking token, so no
  // duplicate order). Full plan charges the whole balance; instalment charges
  // the deposit. Nomba is preferred (Paystack/Stripe only if it's down).
  let payment_url = null;
  // Gate on the ORDER (not public_tracking_token). The token column has no
  // default and is null at creation, so requiring it here skipped the gateway
  // step entirely — the /o page fell back to "we'll WhatsApp you a link"
  // instead of redirecting to Nomba. createPaymentLink resolves the order by
  // order_id (exactly like the cart checkout), so the token isn't needed here.
  if (input.order_link_slug && result.order_id) {
    try {
      // A USD link (staff chose $ when sharing it): lock the order's dollar
      // total from the link's catalogue USD prices — the exact figures the /o
      // page showed — so the checkout below charges that, in dollars.
      const orderLinksRepo = require("../smartcomm/smartcomm.order-links.repo");
      const link = await orderLinksRepo.getBySlug({
        slug: input.order_link_slug,
      });
      if (link && link.business === brand && link.currency === "USD") {
        const salesRepo = require("../sales/sales.repo");
        const orderLinks = require("../smartcomm/smartcomm.order-links.service");
        const placed = await salesRepo.findById({ brand, id: result.order_id });
        const usd = placed
          ? await orderLinks.lockUsdForLinkOrder({
              brand,
              link_items: link.items,
              order: placed,
              picks: input.link_picks,
            })
          : null;
        if (usd && usd.fx_rate)
          await salesRepo.lockSettlementCurrency({
            brand,
            id: result.order_id,
            currency: "USD",
            fx_rate: usd.fx_rate,
            display_total: usd.usd_total,
          });
      }
      // Nomba — the only gateway for ₦ and $ (owner, Sept 2026). A client-sent
      // payment_gateway from an older /o page is ignored.
      const preferredProvider = "nomba";
      const pay = await paymentLink.createPaymentLink({
        brand,
        order_id: result.order_id,
        amount_ngn:
          result.payment_plan === "instalment" ? result.pay_now_ngn : undefined,
        // The link's currency (a USD order was just locked above; a USD link
        // the engine couldn't price fails here rather than charging Naira).
        currency: link && link.currency === "USD" ? "USD" : undefined,
        preferred_provider: preferredProvider,
        return_url_base: input.return_url_base || undefined,
      });
      payment_url = pay.checkout_url || null;
    } catch (err) {
      logger.error(
        { err: err.message, order_id: result.order_id },
        "order-link payment init failed after order (order stands; page will retry)",
      );
    }
  }

  return { ...result, payment_url };
}

/**
 * Checkout-side mirror of the Online QR welcome form: WhatsApp +
 * Instagram handles and the structured delivery address land in
 * shared.contact_social_handles / shared.contact_addresses exactly like
 * an onboarding submission. Best-effort — never fails the order.
 */
async function upsertCheckoutContactExtras({ client, contact, input }) {
  const run = client ? client.query.bind(client) : query;
  try {
    const handles = [
      input.whatsapp_number
        ? { platform: "whatsapp", handle: String(input.whatsapp_number).trim() }
        : null,
      input.instagram_handle
        ? {
            platform: "instagram",
            handle: String(input.instagram_handle).trim().replace(/^@/, ""),
          }
        : null,
    ].filter(Boolean);
    for (const h of handles) {
      if (!h.handle) continue;
      await run(
        `INSERT INTO shared.contact_social_handles (contact_id, platform, handle)
         SELECT $1, $2, $3
          WHERE NOT EXISTS (
            SELECT 1 FROM shared.contact_social_handles
             WHERE contact_id = $1 AND platform = $2)`,
        [contact.contact_id, h.platform, h.handle],
      );
    }
    if (input.whatsapp_number && !contact.whatsapp_number) {
      await run(
        `UPDATE shared.contacts SET whatsapp_number = $2
          WHERE contact_id = $1 AND whatsapp_number IS NULL`,
        [contact.contact_id, String(input.whatsapp_number).trim()],
      );
    }
    // Structured address (from the capture/checkout page) → default
    // delivery row, only when the contact has none yet — checkout must
    // never silently overwrite an address the team already verified.
    const a = input.address;
    if (a && a.line1) {
      const { rows: existing } = await run(
        `SELECT 1 FROM shared.contact_addresses
          WHERE contact_id = $1 AND address_type = 'delivery' LIMIT 1`,
        [contact.contact_id],
      );
      if (!existing.length) {
        await run(
          `INSERT INTO shared.contact_addresses
             (contact_id, address_type, line1, line2, area, city, state,
              country, country_code, landmark, is_default)
           VALUES ($1,'delivery',$2,$3,$4,COALESCE($5,'Lagos'),
                   COALESCE($6,'Lagos'),COALESCE($7,'Nigeria'),
                   COALESCE($8,'NG'),$9,true)`,
          [
            contact.contact_id,
            a.line1,
            a.line2 || null,
            a.area || null,
            a.city || null,
            a.state || null,
            a.country || null,
            a.country_code || null,
            a.landmark || null,
          ],
        );
      }
    }
  } catch (err) {
    logger.warn(
      { err: err.message, contact_id: contact.contact_id },
      "order-form: contact extras upsert failed (order stands)",
    );
  }
}

/**
 * Resolve staff-picked styled variant prices from the order-link row (looked
 * up by slug), keyed by the sellable base variant_id, so the checkout can
 * apply them as line unit prices. The price comes ONLY from the persisted
 * link row (set when staff shared the catalogue) — never from the public POST
 * body — so a shopper can't rewrite it. Gated to styled items that actually
 * carried a picked styled_variant_id; every other line prices normally through
 * Sales. An unknown/cross-brand slug yields an empty map (order prices as
 * usual, never fails the checkout).
 */
/**
 * Authorise what a PUBLIC order-form POST may buy. The body is written by the
 * shopper's browser, so nothing in it is trusted on its own:
 *
 *  - Product lines need a live order link (`/o/<slug>`, the only UI that
 *    posts here). Without one, any variant id — a private hair base, often
 *    ₦0 — could be ordered straight off the API.
 *  - The link must belong to this brand and still be usable: revoked and
 *    expired links are refused, and a link that already produced an order is
 *    only accepted for an idempotent replay of THAT order (same client key).
 *    Before, the "single-use" mark silently no-oped and a second order went
 *    through at the link's staff-set prices.
 *  - Every posted variant must be one of the link's resolved lines. A styled
 *    or bundle line may land on a size-adjacent sibling of the same base
 *    family (the rewig donor can change with stock between page load and
 *    submit); that sibling is mapped back to its link line so it keeps the
 *    staff-picked price and name.
 *  - Quantities stay within what the page allows (1–100 of each link item).
 *  - Service bookings must be services on the link (or, with no link, an
 *    active service) and carry the SERVER's price, never the posted one.
 *  - `bundle_id` must be a bundle on the link.
 *
 * Returns the link row, `substitutions` (posted variant → link-line variant),
 * price-corrected `bookings`, and whether this is an idempotent `replay`.
 */
async function authoriseOrderForm({ brand, input, productItems, serviceBookings }) {
  const resolvers = require("../smartcomm/smartcomm.order-links.resolvers");
  const slug = input.order_link_slug || null;
  const substitutions = new Map();

  if (!slug) {
    if (productItems.length)
      throw new AppError(
        "ORDER_LINK_REQUIRED",
        "Products can only be ordered through a shop order link",
        422,
        { user_message: "Please order through the link we sent you, or shop on our website." },
      );
    const bookings = [];
    for (const b of serviceBookings) {
      const svc = await resolvers.resolveServiceItem(brand, { service_id: b.service_id, qty: b.qty });
      if (svc.unresolved_reason)
        throw new AppError("SERVICE_UNAVAILABLE", "That service isn't available", 409);
      bookings.push({ ...b, price_ngn: svc.price_ngn });
    }
    return { link: null, substitutions, bookings, replay: false };
  }

  const orderLinksRepo = require("../smartcomm/smartcomm.order-links.repo");
  const link = await orderLinksRepo.getBySlug({ slug });
  if (!link || link.business !== brand)
    throw new AppError("LINK_INVALID", "This order link isn't valid.", 404);
  if (link.status === "revoked")
    throw new AppError("LINK_REVOKED", "This order link was cancelled. Ask the team for a fresh one.", 410);
  let replay = false;
  if (link.status === "ordered") {
    const salesRepo = require("../sales/sales.repo");
    const existing = input.client_idempotency_key
      ? await salesRepo.findByIdempotencyKey({ brand, key: input.client_idempotency_key })
      : null;
    if (!existing || !link.order_id || existing !== link.order_id)
      throw new AppError(
        "LINK_ALREADY_USED",
        "This order link has already been used to place an order",
        409,
        { user_message: "This order link has already been used. Ask the team for a fresh one." },
      );
    replay = true;
  } else if (
    link.status === "expired" ||
    (link.expires_at && new Date(link.expires_at).getTime() < Date.now())
  ) {
    throw new AppError("LINK_EXPIRED", "This order link has expired. Ask the team for a fresh one.", 410);
  }

  const resolved = await resolvers.resolveItems(brand, Array.isArray(link.items) ? link.items : []);

  // Allowed product lines: variant → { cap, familyOk }.
  const allowed = new Map();
  for (const r of resolved) {
    if (r.kind === "service") continue;
    const base = Math.max(1, Number(r.qty) || 1);
    for (const l of r.lines || []) {
      if (!l.variant_id) continue;
      const perUnit = (Number(l.quantity) || 1) / base;
      const prev = allowed.get(l.variant_id) || { cap: 0, familyOk: false };
      allowed.set(l.variant_id, {
        cap: prev.cap + Math.ceil(perUnit * 100),
        familyOk: prev.familyOk || r.kind === "styled" || r.kind === "bundle",
      });
    }
  }

  const unknown = [...new Set(productItems.map((it) => it.variant_id))].filter(
    (v) => !allowed.has(v),
  );
  if (unknown.length) {
    // Map a size-adjacent sibling back to its styled/bundle link line.
    const familyTargets = [...allowed].filter(([, a]) => a.familyOk).map(([v]) => v);
    const { rows } = familyTargets.length
      ? await query(
          `SELECT pv.variant_id, p.base_family_id, p.catalogue_role
             FROM ${brand}.product_variants pv
             JOIN ${brand}.products p ON p.product_id = pv.product_id
            WHERE pv.variant_id = ANY($1::uuid[])
              AND pv.is_active = true AND p.is_deleted = false`,
          [[...unknown, ...familyTargets]],
        )
      : { rows: [] };
    const fam = new Map(rows.map((r) => [r.variant_id, r]));
    for (const v of unknown) {
      const mine = fam.get(v);
      const target =
        mine && mine.catalogue_role === "base" && mine.base_family_id
          ? familyTargets.find((t) => {
              const tr = fam.get(t);
              return tr && tr.catalogue_role === "base" && tr.base_family_id === mine.base_family_id;
            })
          : null;
      if (!target)
        throw new AppError(
          "ORDER_ITEM_NOT_IN_LINK",
          `Variant ${v} is not part of this order link`,
          409,
          { user_message: "One of your items is no longer available. Please refresh the page and try again." },
        );
      substitutions.set(v, target);
    }
  }

  const ordered = new Map();
  for (const it of productItems) {
    const key = substitutions.get(it.variant_id) || it.variant_id;
    ordered.set(key, (ordered.get(key) || 0) + (Number(it.quantity) || 0));
  }
  for (const [key, qty] of ordered) {
    if (qty > allowed.get(key).cap)
      throw new AppError(
        "ORDER_QTY_EXCEEDED",
        "Quantity exceeds what this order link allows",
        422,
        { user_message: "That quantity isn't available on this link — message us for a larger order." },
      );
  }

  if (input.bundle_id) {
    const onLink = resolved.some((r) => r.kind === "bundle" && r.bundle_id === input.bundle_id);
    if (!onLink)
      throw new AppError("ORDER_ITEM_NOT_IN_LINK", "That bundle is not part of this order link", 409);
  }

  const linkServices = new Map(
    resolved
      .filter((r) => r.kind === "service" && r.service_id && !r.unresolved_reason)
      .map((r) => [r.service_id, r]),
  );
  const bookings = serviceBookings.map((b) => {
    const svc = linkServices.get(b.service_id);
    if (!svc)
      throw new AppError(
        "ORDER_ITEM_NOT_IN_LINK",
        `Service ${b.service_id} is not part of this order link`,
        409,
        { user_message: "One of your items is no longer available. Please refresh the page and try again." },
      );
    return { ...b, price_ngn: svc.price_ngn };
  });

  return { link, substitutions, bookings, replay };
}

/**
 * A public order line with no staff-picked link price is charged at its
 * variant's channel price. Refuse any that resolves to ₦0 — a bare base
 * variant with no selling price must never become a free order line.
 */
async function assertOrderFormPriced({ brand, salesChannel, variantIds }) {
  const ids = [...new Set(variantIds.filter(Boolean))];
  if (!ids.length) return;
  const { channelPrice } = require("../sales/pricing/channel-price");
  const { rows } = await query(
    `SELECT variant_id, price_storefront_ngn, price_pos_ngn,
            price_wholesale_ngn, price_partner_ngn
       FROM ${brand}.product_variants WHERE variant_id = ANY($1::uuid[])`,
    [ids],
  );
  const byId = new Map(rows.map((r) => [r.variant_id, r]));
  for (const id of ids) {
    const row = byId.get(id);
    const price = row ? channelPrice(row, salesChannel) : null;
    if (price === null || price === undefined || !(Number(price) > 0))
      throw new AppError(
        "ITEM_UNPRICED",
        `Variant ${id} has no selling price on the ${salesChannel} channel`,
        409,
        { user_message: "One of your items can't be priced online right now — message us and we'll complete your order." },
      );
  }
}

/**
 * Resolve the staff member who SHARED a catalogue/order link, so a checkout
 * completed through that link is credited to them on the Performance → Insights
 * leaderboard (Q4 owner decision: "when we share catalogue we see who shared the
 * catalogue with the order link that was clicked that made the order"). Comes
 * ONLY from the persisted link row's `created_by`; a direct order-form checkout
 * (no link) has no sharer and stays unattributed. An unknown/cross-brand slug
 * yields null (order stands, credited to nobody) and never fails the checkout.
 */
async function resolveOrderLinkSharer({ brand, order_link_slug }) {
  if (!order_link_slug) return null;
  try {
    const orderLinksRepo = require("../smartcomm/smartcomm.order-links.repo");
    const link = await orderLinksRepo.getBySlug({ slug: order_link_slug });
    if (!link || link.business !== brand) return null;
    return link.created_by || null;
  } catch {
    return null;
  }
}

async function resolveStyledUnitPrices({ brand, order_link_slug }) {
  const map = new Map();
  if (!order_link_slug) return map;
  try {
    const orderLinksRepo = require("../smartcomm/smartcomm.order-links.repo");
    const resolvers = require("../smartcomm/smartcomm.order-links.resolvers");
    const link = await orderLinksRepo.getBySlug({ slug: order_link_slug });
    if (!link || link.business !== brand || !Array.isArray(link.items)) {
      return map;
    }
    const resolved = await resolvers.resolveItems(brand, link.items);
    for (const r of resolved) {
      if (
        r.kind !== "styled" ||
        !r.styled_variant_id ||
        r.price_ngn === null ||
        r.price_ngn === undefined
      ) {
        continue;
      }
      for (const l of r.lines || []) {
        if (l.variant_id) map.set(l.variant_id, String(r.price_ngn));
      }
    }
  } catch {
    // unknown / cross-brand slug — no overrides.
  }
  return map;
}

/**
 * Resolve the shop-facing name/SKU/provenance for each order-link line,
 * keyed by the sellable base variant_id — the same "trust the link row, not
 * the POST body" rule as resolveStyledUnitPrices above. Without this, a
 * styled/base pick shared via an order link (WhatsApp/Instagram "Tap to
 * order", or a walk-in Online QR checkout) sells through its base stock
 * variant but the order line has no name override to fall back on, so Sales
 * stamps the raw base-product name as product_name_snapshot — the customer's
 * invoice shows a warehouse SKU they never saw, not what they actually
 * bought. A bundle expands to N component lines with no per-component name
 * from the resolver, so it is deliberately left out here — those lines keep
 * pricing/naming from Sales as before (unchanged, not made worse).
 */
async function resolveOrderLinkLineMeta({ brand, order_link_slug }) {
  const map = new Map();
  if (!order_link_slug) return map;
  try {
    const orderLinksRepo = require("../smartcomm/smartcomm.order-links.repo");
    const resolvers = require("../smartcomm/smartcomm.order-links.resolvers");
    const link = await orderLinksRepo.getBySlug({ slug: order_link_slug });
    if (!link || link.business !== brand || !Array.isArray(link.items)) {
      return map;
    }
    const resolved = await resolvers.resolveItems(brand, link.items);
    for (const r of resolved) {
      const lines = r.lines || [];
      if (lines.length !== 1) continue; // bundle — left as-is, see above
      if (r.kind !== "styled" && r.kind !== "base" && r.kind !== "retail") continue;
      // A retail line snapshots the retail PRODUCT name and its EXACT SKU
      // (`PXG-OIL-50`, not the product code) — the customer picked that size on
      // the /o page, so the invoice/receipt must say so. line_kind stays
      // 'product': retail is an ordinary physical sales line and must never be
      // stamped 'styled', which is what auto-opens a Stylist Studio job.
      if (r.kind === "retail") {
        const retailMeta = {
          product_name_snapshot: r.name || undefined,
          variant_label_snapshot: r.variant_label || undefined,
          sku_snapshot: r.sku || undefined,
          line_kind: "product",
        };
        if (lines[0].variant_id) map.set(lines[0].variant_id, retailMeta);
        continue;
      }
      const meta = {
        product_name_snapshot: r.name || undefined,
        sku_snapshot: r.product_code || undefined,
      };
      if (r.kind === "styled" && r.ref_id) {
        meta.styled_id = r.ref_id;
        meta.line_kind = "styled";
      }
      if (lines[0].variant_id) map.set(lines[0].variant_id, meta);
    }
  } catch {
    // unknown/cross-brand slug — no overrides; lines price/name as before.
  }
  return map;
}

// Stylist referral capture (§6.26 Q17): only a code that resolves to an
// ACTIVE partner is stamped on the order — a stale/garbage ?ref= silently
// drops instead of failing the checkout.
async function resolveStylistReferral(code) {
  if (!code) return undefined;
  const stylistReferrals = require("../stylist_programme/referral.service");
  const hit = await stylistReferrals.validateCode({ code }).catch(() => null);
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

/**
 * Rewig adjacency (000088): if `originProductId`'s own stock can't cover
 * `quantity`, draw from a size-adjacent sibling base instead — one size up or
 * down only, same styling job, no separate service or SKU. The decision
 * itself is shared (catalogue/rewig.service) with the sales-campaign and
 * WhatsApp order-link checkout paths, which resolve a styled variant to a
 * base variant the same way but independently of this file. Returns the
 * variant_id to actually reserve against; falls back to `fallbackVariantId`
 * (the variant's own base) whenever rewig is off, not applicable, or no
 * eligible donor has enough — the existing pre-order safety net in
 * sales.service.js takes it from there.
 */
async function pickRewigSourceVariant({
  brand,
  styled,
  originProductId,
  fallbackVariantId,
  quantity,
}) {
  const donorProductId = await rewigService.pickRewigDonorProductId({
    brand,
    styled,
    originProductId,
    quantity,
  });
  if (!donorProductId) return fallbackVariantId;
  const donorVariantId = await defaultVariantId({
    brand,
    product_id: donorProductId,
  });
  return donorVariantId || fallbackVariantId;
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
  // Stock/fulfilment attaches to the picked variant's OWN base when it has
  // one (a size repointed to its per-size base SKU deducts from that SKU);
  // otherwise the styled-level pin, then the seed base's default variant —
  // the same resolution order the availability reads use (styledStockSql).
  let baseVariantId = null;
  if (v.base_product_id && v.base_product_id !== styled.base_product_id) {
    baseVariantId = await defaultVariantId({
      brand,
      product_id: v.base_product_id,
    });
  }
  if (!baseVariantId) baseVariantId = styled.base_variant_id;
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
  // Rewig adjacency (000088): the resolved base above is deterministic, not
  // stock-aware — if it's short, draw from a size-adjacent sibling base
  // instead so the reservation below (sales.service.js) actually succeeds
  // against real inventory rather than falling through to pre-order.
  baseVariantId = await pickRewigSourceVariant({
    brand,
    styled,
    originProductId: v.base_product_id || styled.base_product_id,
    fallbackVariantId: baseVariantId,
    quantity: item.quantity,
  });
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
    // Carry the styled provenance so Sales stamps line_kind='styled' and Studio
    // auto-opens a job on order.paid (V2.2 §6.24).
    styled_id,
    line_kind: "styled",
    // The exact variant's catalogue (₦, $) pair for the USD engine. Not an
    // order-line column: resolveCartToOrderLines strips it before createOrder.
    usd_pair: usdPricing.pairFromStyled({
      styled,
      variant: v,
      unstyled: item.unstyled,
    }),
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
      // Rewig adjacency (000088) — same fallback as a direct styled line.
      if (variant_id && styled) {
        variant_id = await pickRewigSourceVariant({
          brand,
          styled,
          originProductId: styled.base_product_id,
          fallbackVariantId: variant_id,
          quantity: compQty * units,
        });
      }
    }
    if (!variant_id && comp.product_id)
      variant_id = await defaultVariantId({
        brand,
        product_id: comp.product_id,
      });
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
      // Bundle component was a styled SKU — keep the provenance so Sales writes
      // line_kind='styled' and Studio opens a job for the styling work.
      ...(comp.styled_id
        ? { styled_id: comp.styled_id, line_kind: "styled" }
        : {}),
    });
  }
  // discount_ngn is per single bundle (decorateBundle) → × copies.
  const discountNgn = money(bundle.discount_ngn || 0).times(units);
  return { orderLines, discountNgn };
}

// Resolve every cart line to sellable order lines + the accumulated bundle
// discount. Styled → base variant + styled price; bundle → expanded components
// + discount; Care & Accessories → its exact live SKU. A bare hair-base line is
// refused (bases are never sold publicly). Prices never trusted from the client.
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
      const line = await resolveStyledLine({
        brand,
        item: {
          styled_variant_id: ci.styled_variant_id,
          unstyled: ci.unstyled,
          quantity: ci.quantity,
        },
      });
      delete line.usd_pair;
      orderLines.push(line);
    } else {
      // Generic product line. Retail SKUs are re-validated against the live
      // catalogue RIGHT HERE (publication, exact variant, live price) — a
      // stale, unpublished or forged line never reaches createOrder. The
      // cart's snapshot price is display history only; createOrder re-prices
      // from the live channel price regardless.
      const resolved = ci.variant_id
        ? await retailResolver
            .resolveSellableVariants({
              brand,
              variant_ids: [ci.variant_id],
              channel: "storefront",
            })
            .catch(() => new Map())
        : new Map();
      const retail = ci.variant_id ? resolved.get(ci.variant_id) : null;
      // The ONLY generic (non-styled, non-bundle) line a public checkout may
      // sell is a live Care & Accessories SKU. Anything else here is a private
      // hair-base variant — never storefront-visible (000043), usually priced
      // ₦0 because the wig sells through its styled record — and letting it
      // through would hand out stock at whatever its base channel price is.
      // A stale/gated retail line and a base line both refuse the same way.
      if (!retail)
        throw new AppError(
          "CART_ITEM_UNRESOLVED",
          "One of your items is no longer available. Please remove it and try again.",
          409,
          {
            user_message:
              "One of your items is no longer available. Please remove it and try again.",
          },
        );
      orderLines.push({
        variant_id: retail.variant_id,
        quantity: ci.quantity,
        product_name_snapshot: retail.name,
        variant_label_snapshot: retail.variant_label || null,
        sku_snapshot: retail.sku,
      });
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
async function checkout({ brand, cart_id, sessionCustomerId = null, input = {} }) {
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
  //    P0-5 guard: an anonymous caller who supplies an email that matches an
  //    existing customer must NEVER be treated as that customer. We record
  //    whether the resolved contact matches the authenticated session; that
  //    flag gates default-address overwrite here and points redemption below.
  const { contact, deliveryAddress, isSessionMatch, contactWasNew } =
    await transaction(async (client) => {
      const email = (c.email || "").toLowerCase().trim() || null;
      const phone = normalizePhone(c.phone);
      const displayName =
        [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
        email ||
        phone ||
        "Customer";
      let ct = await contactsRepo.findByPhoneOrEmail({ client, phone, email });
      const wasNew = !ct;
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
      // The caller "owns" this contact only when the authed session belongs to
      // it. A newly-created contact is owned by definition (nothing to steal).
      const sessionMatch =
        wasNew ||
        (Boolean(sessionCustomerId) && sessionCustomerId === ct.contact_id);
      if (isPickup) {
        return {
          contact: ct,
          deliveryAddress: null,
          isSessionMatch: sessionMatch,
          contactWasNew: wasNew,
        };
      }

      const addr = c.address;
      let savedAddress = null;
      await client.query("SAVEPOINT pgh_addr");
      try {
        // Only overwrite the contact's default delivery address when the
        // caller has proven they are that contact. An anonymous guest whose
        // email matches an existing customer must NOT be able to replace the
        // shipping address the operations team has already verified — that is
        // the P0-5 tamper vector. Instead, add the new address as
        // non-default (or default only if none exists yet).
        const existing = await contactsRepo.listAddresses({
          client,
          contact_id: ct.contact_id,
        });
        const hasDefaultDelivery = existing.some(
          (a) => a.address_type === "delivery" && a.is_default,
        );
        const canOverwriteDefault = sessionMatch || !hasDefaultDelivery;
        if (canOverwriteDefault && hasDefaultDelivery) {
          await contactsRepo.clearDefaultAddresses({
            client,
            contact_id: ct.contact_id,
            address_type: "delivery",
          });
        }
        savedAddress = await contactsRepo.addAddress({
          client,
          contact_id: ct.contact_id,
          input: {
            address_type: "delivery",
            is_default: canOverwriteDefault,
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
      return {
        contact: ct,
        deliveryAddress: savedAddress,
        isSessionMatch: sessionMatch,
        contactWasNew: wasNew,
      };
    });

  // P0-5 guard: an unauthenticated checkout that resolved onto an existing
  // customer must not be able to debit that customer's loyalty balance.
  // Redemption requires a session whose contact matches the resolved contact.
  // The storefront checkout page only shows the redeem input when signed in;
  // this is defence in depth on the server.
  if (input.redeem_points && Number(input.redeem_points) > 0 && !isSessionMatch) {
    throw new AppError(
      "AUTH_REQUIRED_FOR_POINTS",
      "Sign in to redeem loyalty points on this order",
      401,
      {
        user_message:
          "Please sign in to your account to redeem loyalty points.",
      },
    );
  }

  // P0-5 guard: a coupon carrying per-customer restrictions (first_time_only
  // or per_customer_limit) is scoped to a particular account. An anonymous
  // caller matched onto an existing contact via an email guess must not be
  // able to burn those allowances. Codes with no per-customer restriction
  // (e.g. a broad marketing promo) still work for guests.
  if (input.coupon_code && !isSessionMatch && !contactWasNew) {
    const preview = await couponService
      .validateCoupon({
        brand,
        code: input.coupon_code,
        contact_id: contact.contact_id,
        order_subtotal_ngn: 0,
      })
      .catch(() => null);
    if (
      preview &&
      preview.valid &&
      preview.coupon &&
      (preview.coupon.first_time_only ||
        (preview.coupon.per_customer_limit || 0) > 0)
    ) {
      throw new AppError(
        "AUTH_REQUIRED_FOR_COUPON",
        "Sign in to use this code",
        401,
        {
          user_message:
            "This code is tied to an account. Please sign in to use it.",
        },
      );
    }
  }

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
  // PR 2: which of these lines are Care & Accessories SKUs?
  const retailIds = await retailResolver.retailVariantIds({
    brand,
    variant_ids: orderLines.map((l) => l.variant_id),
  });
  const hasRetail = retailIds.size > 0;
  if (!isPickup && hasRetail) {
    // MONEY PATH STOPPED (owner approval pending): the provisional
    // initial-zone-fee assumption in the Care & Accessories guide has not
    // been approved, so a retail-containing website cart must not be charged
    // ANY delivery figure — not a guessed zone fee, and never ₦0. Pickup is
    // the paid self-serve option; staff arrange retail deliveries manually
    // (Quick Sale/quote with an agreed fee). Wig-only carts below are
    // untouched by this rule.
    throw new AppError(
      "RETAIL_DELIVERY_ARRANGED",
      "Retail-containing web delivery checkout is gated pending the owner's fee approval",
      422,
      {
        user_message:
          "EXTRA DELIVERY FEES MAY APPLY for orders containing care products. Delivery for these orders is arranged with our team — please choose store pickup, or contact us and we'll set up delivery for you.",
      },
    );
  }
  if (!isPickup) {
    const addr = c.address || {};
    const zoneCode = addr.zone_code || addr.country_code || null;
    // Retail pieces NEVER count as extra wigs in the delivery tier. (Today a
    // retail cart can't reach a zone quote — see the gate above — but the
    // wig-only quantity stays correct when the fee assumption is approved.)
    const wigQty = orderLines.reduce(
      (s, l) => s + (retailIds.has(l.variant_id) ? 0 : Number(l.quantity) || 0),
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

  const stylistReferralCode = await resolveStylistReferral(input.referral_code);

  // 4. Create the sales order (same engine + outbox as every channel).
  const order = await salesService.createOrder({
    brand,
    user: { user_id: null },
    request_id: input.client_idempotency_key,
    input: {
      contact_id: contact.contact_id,
      sales_channel: "storefront",
      order_type: isPickup ? "collection" : "dispatch",
      lines: orderLines,
      shipping_fee_ngn: shippingFeeNgn,
      // Flexi Pay (PR-2): the buyer's plan choice. createOrder re-validates
      // instalment availability (storefront channel config) and snapshots the
      // deposit policy on the order.
      payment_plan: input.payment_plan === "instalment" ? "instalment" : "full",
      coupon_code: input.coupon_code || null,
      stylist_referral_code: stylistReferralCode,
      // P0-3 customer referral rail: forwarded verbatim; createOrder resolves
      // the code against shared.referrals (brand-scoped), applies the friend
      // discount via the floor-respecting allocator, and stamps
      // referral_code_used on the order so retention.subscribers can credit
      // the referrer on order.paid.
      customer_referral_code: input.customer_referral_code || null,
      specific_instructions: (input.specific_instructions && String(input.specific_instructions).trim()) ? String(input.specific_instructions).trim().slice(0,2000) : undefined,
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

  // 5. Metadata + currency snapshot. NGN display settles NGN; any foreign
  //    display settles USD (Nomba charges NGN + USD only). A USD order is
  //    priced by the USD engine (usd-pricing) from the SAME live cart pass the
  //    bag showed — each item's catalogue USD price, adjustments at the goods'
  //    dollar ratio, delivery at the catalogue rate — and locked on the order:
  //    display_total = the dollar total, fx_rate_used = its effective ₦ per $,
  //    which the pay link divides by and the webhook credits at.
  const displayCurrency = String(input.display_currency || "NGN").toUpperCase();
  const settlementCurrency = await currencyService.resolveSettlementCurrency({
    displayCurrency,
  });
  let displayTotal = null;
  let fxRateUsed = null;
  if (settlementCurrency !== "NGN") {
    const { priced } = await priceCartItems({ brand, items });
    const usd = usdPricing.orderUsd({
      lines: usdEngineLines(priced),
      total_ngn: order.total_ngn,
      delivery_ngn: order.shipping_fee_ngn ?? shippingFeeNgn,
      rate: await usdPricing.catalogueRate(brand),
    });
    if (usd && usd.fx_rate) {
      displayTotal = usd.usd_total;
      fxRateUsed = usd.fx_rate;
    }
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
        settlementCurrency,
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

  // 7. Initiate payment on the SETTLEMENT currency, on Nomba — the only
  //    gateway for ₦ and $ (owner, Sept 2026). A client-sent payment_gateway
  //    is ignored.
  const checkoutCurrency = settlementCurrency;
  const preferredProvider = "nomba";
  // Flexi Pay (PR-2): full plan charges the whole balance; instalment charges
  // the chosen first payment (or the snapshotted deposit). createPaymentLink
  // enforces the minimum and clamps to the outstanding balance. The storefront
  // checkout has no strict schema, so parse the amount defensively (a bad value
  // falls back to the deposit rather than crashing the checkout).
  const firstPaymentReq = Number(input.first_payment_ngn);
  const hasDeposit =
    order.required_deposit_ngn !== null &&
    order.required_deposit_ngn !== undefined;
  const firstAmountNgn =
    order.payment_plan === "instalment"
      ? Number.isFinite(firstPaymentReq) && firstPaymentReq > 0
        ? String(firstPaymentReq)
        : hasDeposit
          ? String(order.required_deposit_ngn)
          : undefined
      : undefined;
  let payResult;
  try {
    payResult = await paymentLink.createPaymentLink({
      brand,
      order_id: order.order_id,
      amount_ngn: firstAmountNgn,
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
    // PR 2: lets the thank-you page repeat the delivery disclosure where the
    // order contained Care & Accessories items (pickup orders only today).
    has_care_items: hasRetail,
    care_delivery_notice: hasRetail ? "EXTRA DELIVERY FEES MAY APPLY" : null,
    // Pre-order notice threaded off the created order (000086) so the website
    // checkout + thank-you page can tell the buyer some items are made to order.
    preorder:
      order._preorder && order._preorder.is_preorder ? order._preorder : null,
    // Flexi Pay (PR-2): plan + balance summary so the thank-you page can show
    // the running balance and the permanent pay link.
    ...(order.payment_plan === "instalment"
      ? {
          flexi_pay: {
            payment_plan: "instalment",
            total_ngn: String(order.total_ngn),
            first_payment_ngn: firstAmountNgn || String(order.total_ngn),
          },
        }
      : {}),
  };
}

/**
 * Price every cart item LIVE from the catalogue — the one pass both the cart
 * quote and checkout's USD figure run, so the dollars a buyer sees in the bag
 * are the dollars checkout charges. Each item carries its Naira unit price and
 * its catalogue (₦, $) pair for the USD engine (usd-pricing).
 *
 * PR 2: generic (non-styled, non-bundle) lines are re-priced LIVE from the
 * catalogue — the old branch kept the add-time snapshot forever, so a price
 * change or an unpublished Care SKU quoted at a stale number right up to
 * checkout. Retail lines resolve through the typed resolver; an unresolvable
 * line keeps its snapshot for display but is flagged unavailable so the UI
 * blocks the purchase (checkout re-validates and rejects it anyway).
 */
async function priceCartItems({ brand, items }) {
  const noPair = { catalogue_ngn: null, catalogue_usd: null };
  const genericIds = items
    .filter((ci) => !ci.styled_variant_id && !ci.bundle_id && ci.variant_id)
    .map((ci) => ci.variant_id);
  let liveGeneric = new Map();
  if (genericIds.length) {
    liveGeneric = await retailResolver
      .resolveSellableVariants({
        brand,
        variant_ids: genericIds,
        channel: "storefront",
      })
      .catch(() => new Map());
  }
  let careCount = 0;
  const priced = [];
  for (const ci of items) {
    let unit;
    let pair = noPair;
    let unavailable = false;
    let lineVatRate = null;
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
      if (resolved) pair = resolved.usd_pair;
    } else if (ci.bundle_id) {
      // Bundle: the decorated effective price (matches what checkout charges).
      const b = await bundleService
        .getBundle({ brand, id: ci.bundle_id })
        .catch(() => null);
      unit = b
        ? money(b.effective_price_ngn || 0)
        : money(ci.unit_price_ngn || 0);
      pair = await usdPricing
        .bundlePair({ brand, bundle_id: ci.bundle_id })
        .catch(() => noPair);
      // A bundle carrying a Care & Accessories component checks out through
      // the same retail delivery gate (checkout classifies the EXPANDED
      // lines), so the quote must not offer a delivery fee checkout refuses.
      const comps = await bundleRepo
        .listComponents({ brand, bundle_id: ci.bundle_id })
        .catch(() => []);
      const compProductIds = comps
        .map((c) => c.match_product_id || c.product_id)
        .filter(Boolean);
      if (compProductIds.length) {
        const { rows: compRetail } = await query(
          `SELECT 1 FROM ${brand}.products
            WHERE product_id = ANY($1::uuid[]) AND catalogue_role = 'retail'
            LIMIT 1`,
          [compProductIds],
        );
        if (compRetail.length) careCount += 1;
      }
    } else {
      const live = ci.variant_id ? liveGeneric.get(ci.variant_id) : null;
      if (live && live.kind === "retail") {
        careCount += 1;
        unit = money(live.unit_price_ngn);
        // createOrder ADDS a taxable product's VAT on top of the price.
        if (live.taxable && live.vat_rate) lineVatRate = money(live.vat_rate);
        pair = {
          catalogue_ngn: live.unit_price_ngn,
          catalogue_usd: live.unit_price_usd,
        };
      } else {
        // Not a live Care SKU: a retail line that went stale/gated, or a bare
        // hair-base line (never publicly sellable — checkout refuses both).
        // Keep the snapshot for display and mark the line blocked.
        unit = money(ci.unit_price_ngn || 0);
        unavailable = true;
        if (ci.variant_id) {
          const { rows: role } = await query(
            `SELECT p.catalogue_role FROM ${brand}.product_variants pv
               JOIN ${brand}.products p ON p.product_id = pv.product_id
              WHERE pv.variant_id = $1`,
            [ci.variant_id],
          );
          if (role[0] && role[0].catalogue_role === "retail") careCount += 1;
        }
      }
      if (ci.variant_id && pair === noPair)
        pair = await usdPricing
          .variantPair({ brand, variant_id: ci.variant_id, unit_ngn: unit })
          .catch(() => noPair);
    }
    priced.push({ ci, unit, pair, unavailable, vatRate: lineVatRate });
  }
  return { priced, careCount };
}

/** Engine input lines for a priced cart (see priceCartItems). */
function usdEngineLines(priced) {
  return priced.map(({ ci, unit, pair }) => ({
    unit_ngn: unit,
    quantity: ci.quantity || 1,
    ...(pair || {}),
  }));
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

  const { priced, careCount } = await priceCartItems({ brand, items });
  let subtotal = money(0);
  // VAT on taxable Care & Accessories lines. createOrder ADDS it on top of
  // the price (pricing/totals.js), so a quote without it would show less than
  // the gateway charges. Styled/bundle lines are unchanged.
  let taxNgn = money(0);
  const lines = [];
  for (const { ci, unit, unavailable, vatRate } of priced) {
    const lineTotal = unit.times(ci.quantity || 1);
    subtotal = subtotal.plus(lineTotal);
    if (vatRate && !unavailable)
      taxNgn = taxNgn.plus(money(toCurrencyString(lineTotal.times(vatRate))));
    lines.push({
      cart_item_id: ci.cart_item_id,
      name: ci.product_name_snapshot,
      variant_label: ci.variant_label_snapshot || null,
      quantity: ci.quantity,
      unit_price_ngn: toCurrencyString(unit),
      line_total_ngn: toCurrencyString(lineTotal),
      ...(unavailable ? { unavailable: true } : {}),
    });
  }

  // PR 2 delivery policy: a cart with Care & Accessories items never quotes a
  // web delivery fee until the owner approves the initial-zone-fee assumption
  // (see checkout's RETAIL_DELIVERY_ARRANGED gate). The disclosure is exact:
  // EXTRA DELIVERY FEES MAY APPLY — "MAY" is deliberate.
  let deliveryNgn = 0;
  let deliveryAvailable = true;
  let deliveryUnavailableReason = null;
  const zoneCode = address && (address.zone_code || address.country_code);
  if (careCount > 0) {
    deliveryAvailable = false;
    deliveryUnavailableReason = "care_items_staff_arranged";
  } else if (zoneCode) {
    const wigQty = items.reduce((s, ci) => s + (Number(ci.quantity) || 0), 0);
    const dq = await zonesService
      .quote({ brand, country_code: zoneCode, qty: wigQty })
      .catch(() => null);
    if (dq && dq.fee_ngn !== null && dq.fee_ngn !== undefined)
      deliveryNgn = Number(dq.fee_ngn) || 0;
  }

  // Coupon preview: the authoritative discount is applied at checkout by
  // createOrder. This is display-only, but the P0-4 audit found the query
  // selected the wrong column (`code` vs the real `coupon_code`), so every
  // discount silently rendered ₦0.00 in the cart quote. The swallow-all
  // try/catch also hid the column drift; drop it so schema drift fails
  // loud in dev instead of degrading silently in prod.
  let discountNgn = money(0);
  let appliedCode = null;
  if (cart.applied_coupon_id) {
    const { rows } = await query(
      `SELECT coupon_code FROM shared.coupons WHERE coupon_id = $1`,
      [cart.applied_coupon_id],
    );
    appliedCode = rows[0] ? rows[0].coupon_code : null;
    if (appliedCode) {
      const res = await couponService.validateCoupon({
        brand,
        code: appliedCode,
        order_subtotal_ngn: Number(toCurrencyString(subtotal)),
      });
      if (res && res.valid) discountNgn = money(res.discount_ngn || 0);
    }
  }

  const totalNgn = subtotal
    .minus(discountNgn)
    .plus(taxNgn)
    .plus(money(deliveryNgn));
  // Dollar figures come from the USD engine (usd-pricing): each item's
  // catalogue USD price, the coupon scaled at the goods' dollar ratio, delivery
  // at the catalogue rate — the SAME engine checkout locks onto the order, so
  // the bag's $ total is the $ charged. Any non-NGN display is priced in USD
  // (the storefront offers ₦ and $ only; Nomba charges nothing else).
  const cur =
    String(display_currency || "NGN").toUpperCase() === "NGN" ? "NGN" : "USD";
  const fxRate = cur === "NGN" ? null : await usdPricing.catalogueRate(brand);
  const usd =
    cur === "NGN"
      ? null
      : usdPricing.orderUsd({
          lines: usdEngineLines(priced),
          total_ngn: totalNgn,
          delivery_ngn: deliveryNgn,
          rate: fxRate,
        });
  if (usd)
    usd.lines.forEach((l, i) => {
      lines[i].unit_price_usd = l.unit_price_usd;
      lines[i].line_total_usd = toCurrencyString(
        money(l.unit_price_usd).times(lines[i].quantity || 1),
      );
    });
  const negate = (v) => toCurrencyString(money(0).minus(money(v)));
  // The engine folds everything beyond goods + delivery (discount AND Care
  // VAT) into one adjustment at the goods' $/₦ ratio; split the VAT back out
  // at that same ratio so each summary row shows its own dollar figure.
  let taxUsd = money(0);
  if (usd && taxNgn.gt(0)) {
    const goodsNgn = priced.reduce(
      (sum, { ci, unit }) => sum.plus(unit.times(ci.quantity || 1)),
      money(0),
    );
    const ratio = goodsNgn.gt(0)
      ? money(usd.goods_usd).dividedBy(goodsNgn)
      : fxRate
        ? money(1).dividedBy(money(fxRate))
        : money(0);
    taxUsd = taxNgn.times(ratio).toDecimalPlaces(2);
  }

  return {
    lines,
    subtotal_ngn: toCurrencyString(subtotal),
    discount_ngn: toCurrencyString(discountNgn),
    // VAT added on top of taxable Care & Accessories lines (0.00 otherwise).
    tax_ngn: toCurrencyString(taxNgn),
    delivery_ngn: toCurrencyString(money(deliveryNgn)),
    total_ngn: toCurrencyString(totalNgn),
    // PR 2 Care & Accessories signals for the cart/checkout UI:
    has_care_items: careCount > 0,
    care_delivery_notice: careCount > 0 ? "EXTRA DELIVERY FEES MAY APPLY" : null,
    delivery_available: deliveryAvailable,
    delivery_unavailable_reason: deliveryUnavailableReason,
    display_currency: cur,
    subtotal_display: usd ? usd.goods_usd : null,
    // Adjustments hold the discount (negative) and any Care VAT (positive);
    // the discount's dollar figure is the adjustment without the VAT share.
    discount_display: usd
      ? negate(money(usd.adjustments_usd).minus(taxUsd))
      : null,
    tax_display: usd ? toCurrencyString(taxUsd) : null,
    delivery_display: usd ? usd.delivery_usd : null,
    total_display: usd ? usd.usd_total : null,
    // The discounted goods in dollars (Care VAT included), before delivery —
    // the checkout page adds its live delivery quote to this (delivery:
    // ₦ ÷ fx_rate_used, rounded up to the dollar, exactly as checkout prices it).
    goods_total_display: usd
      ? toCurrencyString(money(usd.goods_usd).plus(money(usd.adjustments_usd)))
      : null,
    fx_rate_used: cur === "USD" ? fxRate : null,
    // Applied coupon (if any) so the checkout page can pre-fill the promo
    // field and forward the code on submit.
    applied_coupon_code: appliedCode,
  };
}

// ── Care & Accessories (PR 2) — typed public retail reads ──
// PXG-only (the resolver's gate 404s every other brand). One row per ACTIVE
// variant — a 50 ml / 100 ml product is two individually sellable options.
async function listCareProducts({ brand, q, category_id, page, page_size }) {
  return retailResolver.listSellable({ brand, q, category_id, page, page_size });
}

// Canonical /care-and-accessories/:slug detail — live retail products only.
async function getCareProduct({ brand, slug }) {
  return retailResolver.getProductBySlug({ brand, slug });
}

// Is Care & Accessories sellable on this brand? Drives the storefront nav
// link + routes so FLH (or a switched-off PXG) never offers the section.
async function careEnabled({ brand }) {
  return careGate.enabled(brand);
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
  attachAvailability,
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
  listCareProducts,
  getCareProduct,
  careEnabled,
  startSession,
  recordPageView,
  recordFunnelEvent,
  getInstallHub,
  // Exported for unit tests.
  authoriseOrderForm,
};
