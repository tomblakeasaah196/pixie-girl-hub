/**
 * E-Commerce Storefront & Channel Sync (V2.2 §6.4) — repository.
 *
 * Public catalogue reads (visible, non-deleted products) + storefront
 * analytics writes (sessions / page_views / funnel_events, per-brand) +
 * a contact upsert used by the no-login order form. Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

const { VALID_BRANDS } = require("../../config/brands");
const ex = (c) => (c ? c.query.bind(c) : query);
const t = (brand, tbl) => {
  if (!VALID_BRANDS.has(brand)) throw new Error(`Invalid brand: ${brand}`);
  return `${brand}.${tbl}`;
};

// SINGLE SOURCE for the storefront "from" price (lowest variant price) in BOTH
// currencies. The expression MIRRORS catalogue/styled_variants.repo.listVariants
// (effective_price_ngn/usd) so list cards and the detail page never diverge — we
// keep it in one place rather than re-deriving pricing per query. Used as a
// LATERAL correlated on the outer `s` (a styled_products row aliased `s`).
function fromPriceLateral(brand) {
  return `LEFT JOIN LATERAL (
    SELECT min(COALESCE(v.price_override_ngn,
                 s.retail_price_ngn + c.premium_ngn + stt.premium_ngn
                   + COALESCE(ls.premium_ngn, 0))) AS from_price_ngn,
           min(CASE WHEN s.retail_price_usd IS NULL AND v.price_override_usd IS NULL
                    THEN NULL
                    ELSE COALESCE(v.price_override_usd,
                           s.retail_price_usd + COALESCE(c.premium_usd, 0)
                             + COALESCE(stt.premium_usd, 0)
                             + COALESCE(ls.premium_usd, 0))
               END) AS from_price_usd
      FROM ${t(brand, "styled_product_variants")} v
      JOIN ${t(brand, "styled_product_colours")} c ON c.colour_id = v.colour_id
      JOIN ${t(brand, "styled_size_tiers")} stt ON stt.size_code = v.size_code
      LEFT JOIN ${t(brand, "styled_lace_sizes")} ls ON ls.lace_code = v.lace_code
     WHERE v.styled_id = s.styled_id AND v.is_deleted = false AND v.is_active = true
       AND c.is_active = true
  ) fp ON true`;
}

// Resolve a live, storefront-visible styled product id from its slug. Pricing
// and the rest of the detail are then composed from the catalogue repos
// (styled_variants.listVariants etc.) so there's no duplicated price math here.
async function getLiveStyledIdBySlug({ brand, slug }) {
  const { rows } = await query(
    `SELECT styled_id FROM ${t(brand, "styled_products")}
      WHERE slug = $1 AND status = 'live'
        AND is_visible_storefront = true AND is_deleted = false`,
    [slug],
  );
  return rows[0]?.styled_id || null;
}

// Styled-ONLY gallery (never base/factory shots), incl. per-colour shots so the
// product page can swap images on swatch select. Mirrors the rule the campaign
// detail enforces. Display data only — no pricing.
async function listStyledGallery({ brand, styled_id }) {
  const { rows } = await query(
    `SELECT image_id, styled_colour_id,
            COALESCE(cdn_url, file_path) AS url,
            alt_text, is_primary, display_order
       FROM ${t(brand, "product_images")}
      WHERE styled_id = $1
      ORDER BY is_primary DESC, display_order ASC NULLS LAST`,
    [styled_id],
  );
  return rows;
}

// ── Public catalogue ───────────────────────────────────────
// The website only ever shows STYLED products (storefront skins over a base),
// never base products themselves — a base is the China-origin, stock-bearing
// record and must never be published. A styled product reaches the web only
// when status='live' AND is_visible_storefront=true.
async function listProducts({ brand, filters = {}, page = 1, page_size = 24 }) {
  const where = [
    "s.status = 'live'",
    "s.is_visible_storefront = true",
    "s.is_deleted = false",
  ];
  const params = [];
  let i = 1;
  if (filters.category_slug) {
    where.push(`cat.slug = $${i++}`);
    params.push(filters.category_slug);
  }
  if (filters.q) {
    where.push(`(s.name ILIKE $${i} OR s.styled_code ILIKE $${i})`);
    params.push(`%${filters.q}%`);
    i++;
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM ${t(brand, "styled_products")} s
       LEFT JOIN ${t(brand, "product_categories")} cat ON cat.category_id = s.category_id
      ${whereSql}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT s.styled_id, s.styled_code, s.name, s.slug, s.short_description,
            s.retail_price_ngn, s.retail_price_usd, s.compare_at_price_ngn,
            s.published_at,
            COALESCE(fp.from_price_ngn, s.retail_price_ngn) AS effective_price_ngn,
            COALESCE(fp.from_price_usd, s.retail_price_usd) AS effective_price_usd,
            (SELECT img.cdn_url FROM ${t(brand, "product_images")} img
              WHERE img.styled_id = s.styled_id
              ORDER BY img.is_primary DESC, img.display_order LIMIT 1)
              AS cover_image_url
       FROM ${t(brand, "styled_products")} s
       LEFT JOIN ${t(brand, "product_categories")} cat ON cat.category_id = s.category_id
       ${fromPriceLateral(brand)}
      ${whereSql}
      ORDER BY s.published_at DESC NULLS LAST, s.name
      LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: countRows[0].total };
}

// Per-colour image galleries for the detail page (swatch → swap images).
// Display data only; pricing comes from listVariants (catalogue). Returns one
// row per active colour with its ordered images.
async function listColourGalleries({ brand, styled_id }) {
  const { rows } = await query(
    `SELECT c.colour_id, c.name, c.hex, c.video_url, c.external_video_url,
            c.display_order, c.is_default,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'image_id', pi.image_id,
                        'url', COALESCE(pi.cdn_url, pi.file_path),
                        'alt_text', pi.alt_text, 'display_order', pi.display_order)
                        ORDER BY pi.is_primary DESC, pi.display_order)
                 FROM ${t(brand, "product_images")} pi
                WHERE pi.styled_colour_id = c.colour_id),
              '[]'::json) AS images
       FROM ${t(brand, "styled_product_colours")} c
      WHERE c.styled_id = $1 AND c.is_active = true
      ORDER BY c.display_order, c.name`,
    [styled_id],
  );
  return rows;
}

async function listCategories({ brand }) {
  const { rows } = await query(
    `SELECT category_id, parent_category_id, name, slug, display_order
       FROM ${t(brand, "product_categories")}
      WHERE is_active = true ORDER BY display_order, name`,
  );
  return rows;
}

async function getCollectionBySlug({ brand, slug }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "product_collections")}
      WHERE slug = $1 AND is_active = true AND is_visible_storefront = true`,
    [slug],
  );
  if (!rows[0]) return null;
  const collection = rows[0];
  // Collection membership points at the STYLED product directly (000047); show
  // the LIVE styled products in this collection (base products never reach the
  // web). DISTINCT ON keeps one row per styled product.
  const { rows: products } = await query(
    `SELECT DISTINCT ON (s.styled_id)
            s.styled_id, s.name, s.slug, s.short_description,
            s.retail_price_ngn, s.retail_price_usd,
            COALESCE(fp.from_price_ngn, s.retail_price_ngn) AS effective_price_ngn,
            COALESCE(fp.from_price_usd, s.retail_price_usd) AS effective_price_usd,
            (SELECT img.cdn_url FROM ${t(brand, "product_images")} img
              WHERE img.styled_id = s.styled_id
              ORDER BY img.is_primary DESC, img.display_order LIMIT 1) AS cover_image_url
       FROM ${t(brand, "product_collection_members")} m
       JOIN ${t(brand, "styled_products")} s ON s.styled_id = m.styled_id
       ${fromPriceLateral(brand)}
      WHERE m.collection_id = $1 AND m.styled_id IS NOT NULL
        AND s.status = 'live' AND s.is_visible_storefront = true
        AND s.is_deleted = false
      ORDER BY s.styled_id, s.published_at DESC NULLS LAST`,
    [collection.collection_id],
  );
  return { ...collection, products };
}

// Promotional bundles that are live on the storefront (visible + active +
// inside their validity window), with their components for display.
async function listBundles({ brand }) {
  const { rows } = await query(
    `SELECT b.bundle_id, b.bundle_code, b.display_name, b.description,
            b.pricing_model, b.bundle_price_ngn, b.discount_value,
            b.hero_image_url, b.display_order,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'product_id', bp.product_id, 'variant_id', bp.variant_id,
                        'styled_id', bp.styled_id,
                        'name', sp.name, 'slug', sp.slug,
                        'price_ngn', sp.retail_price_ngn,
                        'image_url', (SELECT img.cdn_url
                                        FROM ${t(brand, "product_images")} img
                                       WHERE img.styled_id = sp.styled_id
                                       ORDER BY img.is_primary DESC, img.display_order
                                       LIMIT 1),
                        'quantity', bp.quantity, 'role', bp.role)
                        ORDER BY bp.display_order)
                 FROM ${t(brand, "bundle_offer_products")} bp
                 LEFT JOIN ${t(brand, "styled_products")} sp
                        ON sp.styled_id = bp.styled_id
                WHERE bp.bundle_id = b.bundle_id),
              '[]'::json) AS components
       FROM ${t(brand, "bundle_offers")} b
      WHERE b.is_visible_storefront = true AND b.is_active = true
        AND (b.valid_from IS NULL OR b.valid_from <= now())
        AND (b.valid_to IS NULL OR b.valid_to >= now())
      ORDER BY b.display_order, b.display_name`,
  );
  return rows;
}

// Browse-by-shade: list active shades (000062) with a live-product count so the
// shades index can show "N styles" per shade. Soft-deleted shades excluded.
async function listShades({ brand }) {
  const { rows } = await query(
    `SELECT sh.shade_id, sh.shade_code, sh.name, sh.slug, sh.short_description,
            sh.cover_image_url, sh.display_order,
            (SELECT count(*)::int FROM ${t(brand, "styled_products")} s
              WHERE s.shade_id = sh.shade_id AND s.status = 'live'
                AND s.is_visible_storefront = true AND s.is_deleted = false)
              AS product_count
       FROM ${t(brand, "styled_shades")} sh
      WHERE sh.is_active = true AND sh.deleted_at IS NULL
      ORDER BY sh.display_order, sh.name`,
  );
  return rows;
}

// A shade page: the shade itself + every LIVE styled product carrying its
// shade_id (one shade per styled product, per 000062).
async function getShadeBySlug({ brand, slug }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "styled_shades")}
      WHERE slug = $1 AND is_active = true AND deleted_at IS NULL`,
    [slug],
  );
  if (!rows[0]) return null;
  const shade = rows[0];
  const { rows: products } = await query(
    `SELECT s.styled_id, s.name, s.slug, s.short_description,
            s.retail_price_ngn, s.retail_price_usd,
            COALESCE(fp.from_price_ngn, s.retail_price_ngn) AS effective_price_ngn,
            COALESCE(fp.from_price_usd, s.retail_price_usd) AS effective_price_usd,
            (SELECT img.cdn_url FROM ${t(brand, "product_images")} img
              WHERE img.styled_id = s.styled_id
              ORDER BY img.is_primary DESC, img.display_order LIMIT 1)
              AS cover_image_url
       FROM ${t(brand, "styled_products")} s
       ${fromPriceLateral(brand)}
      WHERE s.shade_id = $1 AND s.status = 'live'
        AND s.is_visible_storefront = true AND s.is_deleted = false
      ORDER BY s.published_at DESC NULLS LAST, s.name`,
    [shade.shade_id],
  );
  return { ...shade, products };
}

// Browse-by-collection index (the detail-by-slug lives in getCollectionBySlug).
async function listCollections({ brand }) {
  const { rows } = await query(
    `SELECT collection_id, name, slug, description, hero_image_url,
            display_image_url, display_order
       FROM ${t(brand, "product_collections")}
      WHERE is_active = true AND is_visible_storefront = true
      ORDER BY display_order, name`,
  );
  return rows;
}

// Single live bundle by its code (bundle_offers has no slug — bundle_code is the
// stable, human-readable identifier used in the URL). Same shape as listBundles.
async function getBundleByCode({ brand, code }) {
  const { rows } = await query(
    `SELECT b.bundle_id, b.bundle_code, b.display_name, b.description,
            b.pricing_model, b.bundle_price_ngn, b.discount_value,
            b.hero_image_url, b.display_order,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'product_id', bp.product_id, 'variant_id', bp.variant_id,
                        'styled_id', bp.styled_id,
                        'name', sp.name, 'slug', sp.slug,
                        'price_ngn', sp.retail_price_ngn,
                        'image_url', (SELECT img.cdn_url
                                        FROM ${t(brand, "product_images")} img
                                       WHERE img.styled_id = sp.styled_id
                                       ORDER BY img.is_primary DESC, img.display_order
                                       LIMIT 1),
                        'quantity', bp.quantity, 'role', bp.role)
                        ORDER BY bp.display_order)
                 FROM ${t(brand, "bundle_offer_products")} bp
                 LEFT JOIN ${t(brand, "styled_products")} sp
                        ON sp.styled_id = bp.styled_id
                WHERE bp.bundle_id = b.bundle_id),
              '[]'::json) AS components
       FROM ${t(brand, "bundle_offers")} b
      WHERE b.bundle_code = $1
        AND b.is_visible_storefront = true AND b.is_active = true
        AND (b.valid_from IS NULL OR b.valid_from <= now())
        AND (b.valid_to IS NULL OR b.valid_to >= now())`,
    [code],
  );
  return rows[0] || null;
}

// Published Storefront Studio config the website renders at SSR (theme tokens,
// navigation, pages, active popups). PUBLISHED rows only, public-safe columns
// only — drafts/internal fields never leave the building. Studio admin (which
// edits drafts) is untouched; this is the read side the storefront consumes.
// Shared tables keyed by business=brand. Optional `path` narrows to one page.
async function getPublishedSite({ brand, path }) {
  const [theme, nav, pages, popups] = await Promise.all([
    query(
      `SELECT tokens FROM shared.storefront_themes
        WHERE business = $1 AND status = 'published' LIMIT 1`,
      [brand],
    ),
    query(
      `SELECT header_items, footer_columns, socials
         FROM shared.storefront_navigation
        WHERE business = $1 AND status = 'published' LIMIT 1`,
      [brand],
    ),
    path
      ? query(
          `SELECT page_key, template_key, url_path, meta_title,
                  meta_description, og_image_url, slots
             FROM shared.storefront_pages
            WHERE business = $1 AND status = 'published' AND url_path = $2`,
          [brand, path],
        )
      : query(
          `SELECT page_key, template_key, url_path, meta_title,
                  meta_description, og_image_url, slots
             FROM shared.storefront_pages
            WHERE business = $1 AND status = 'published'
            ORDER BY page_key`,
          [brand],
        ),
    query(
      `SELECT popup_key, trigger_type, trigger_value, audience, content,
              display_rules, display_order
         FROM shared.storefront_popups
        WHERE business = $1 AND status = 'published' AND is_active = true
        ORDER BY display_order`,
      [brand],
    ),
  ]);

  return {
    theme: theme.rows[0] || null, // { tokens } | null → website falls back to baked tokens
    navigation: nav.rows[0] || null,
    pages: pages.rows,
    popups: popups.rows,
  };
}

async function getContentPost({ brand, type, slug }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "storefront_content_posts")}
      WHERE post_type = $1 AND slug = $2`,
    [type, slug],
  );
  return rows[0] || null;
}

// ── Contact upsert (no-login order form) ───────────────────
async function findContactByEmailOrPhone({ client, email, phone }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.contacts
      WHERE is_deleted = false
        AND ( ($1::citext IS NOT NULL AND email = $1)
           OR ($2::text  IS NOT NULL AND primary_phone = $2) )
      ORDER BY created_at LIMIT 1`,
    [email || null, phone || null],
  );
  return rows[0] || null;
}

async function createContact({ client, brand, contact }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.contacts
       (contact_type, display_name, first_name, last_name, primary_phone,
        whatsapp_number, email, date_of_birth, visible_to)
     VALUES (ARRAY['customer'], $1, $2, $3, $4, $5, $6, $7, ARRAY[$8])
     RETURNING *`,
    [
      contact.display_name,
      contact.first_name || null,
      contact.last_name || null,
      contact.primary_phone || null,
      contact.whatsapp_number || null,
      contact.email || null,
      contact.date_of_birth || null,
      brand,
    ],
  );
  return rows[0];
}

// ── Analytics ──────────────────────────────────────────────
async function createSession({ brand, session }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "storefront_sessions")}
       (visitor_id, contact_id, referrer, utm_source, utm_medium, utm_campaign,
        utm_content, utm_term, country_code, detected_currency, device_type,
        os, browser, user_agent, ip_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING session_id`,
    [
      session.visitor_id,
      session.contact_id || null,
      session.referrer || null,
      session.utm_source || null,
      session.utm_medium || null,
      session.utm_campaign || null,
      session.utm_content || null,
      session.utm_term || null,
      session.country_code || null,
      session.detected_currency || null,
      session.device_type || null,
      session.os || null,
      session.browser || null,
      session.user_agent || null,
      session.ip_address || null,
    ],
  );
  return rows[0];
}

async function recordPageView({ brand, view }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "storefront_page_views")}
       (session_id, page_url, page_type, product_id, variant_id, category_id,
        collection_id, content_post_id, time_on_page_seconds, scroll_depth_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING page_view_id`,
    [
      view.session_id,
      view.page_url,
      view.page_type,
      view.product_id || null,
      view.variant_id || null,
      view.category_id || null,
      view.collection_id || null,
      view.content_post_id || null,
      view.time_on_page_seconds || null,
      view.scroll_depth_pct || null,
    ],
  );
  // Keep the session page_count roughly in sync for quick funnel reads.
  await query(
    `UPDATE ${t(brand, "storefront_sessions")}
        SET page_count = page_count + 1 WHERE session_id = $1`,
    [view.session_id],
  );
  return rows[0];
}

async function recordFunnelEvent({ brand, event }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "storefront_funnel_events")}
       (session_id, event_type) VALUES ($1,$2) RETURNING event_id`,
    [event.session_id, event.event_type],
  );
  return rows[0];
}

// ── Install Hub composition (V2.2 §6.10) ───────────────────
async function findOrderByTrackingToken({ token }) {
  for (const brand of VALID_BRANDS) {
    const { rows } = await query(
      `SELECT order_id, order_number, contact_id, sales_channel,
              delivery_address_snapshot
         FROM ${t(brand, "sales_orders")}
        WHERE public_tracking_token = $1`,
      [token],
    );
    if (rows[0]) {
      const { rows: lines } = await query(
        `SELECT line_id, product_id, variant_id, product_name_snapshot,
                variant_label_snapshot
           FROM ${t(brand, "sales_order_lines")}
          WHERE order_id = $1 ORDER BY display_order`,
        [rows[0].order_id],
      );
      return { brand, order: { ...rows[0], lines } };
    }
  }
  return null;
}

async function listCareGuides({ brand, limit = 4 }) {
  const { rows } = await query(
    `SELECT post_id, slug, title FROM ${t(brand, "storefront_content_posts")}
      WHERE post_type = 'guide' ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

async function nearbyStylists({ city, limit = 3 }) {
  const params = [];
  let where = "status = 'certified'";
  if (city) {
    where += " AND city ILIKE $1";
    params.push(city);
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT stylist_id, display_name, city, state, current_tier_key
       FROM shared.stylist_partners
      WHERE ${where}
      ORDER BY display_name LIMIT $${params.length}`,
    params,
  );
  return rows;
}

module.exports = {
  listProducts,
  getLiveStyledIdBySlug,
  listStyledGallery,
  listColourGalleries,
  listCategories,
  getCollectionBySlug,
  listShades,
  getShadeBySlug,
  listCollections,
  listBundles,
  getBundleByCode,
  getPublishedSite,
  getContentPost,
  findContactByEmailOrPhone,
  createContact,
  createSession,
  recordPageView,
  recordFunnelEvent,
  findOrderByTrackingToken,
  listCareGuides,
  nearbyStylists,
};
