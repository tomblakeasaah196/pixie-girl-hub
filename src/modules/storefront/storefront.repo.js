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

// ── Public catalogue ───────────────────────────────────────
async function listProducts({ brand, filters = {}, page = 1, page_size = 24 }) {
  const where = ["p.is_visible_storefront = true", "p.is_deleted = false"];
  const params = [];
  let i = 1;
  if (filters.category_slug) {
    where.push(`cat.slug = $${i++}`);
    params.push(filters.category_slug);
  }
  if (filters.q) {
    where.push(`p.name ILIKE $${i++}`);
    params.push(`%${filters.q}%`);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM ${t(brand, "products")} p
       LEFT JOIN ${t(brand, "product_categories")} cat ON cat.category_id = p.category_id
      ${whereSql}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT p.product_id, p.name, p.slug, p.short_description, p.brand_name,
            p.published_at,
            (SELECT min(pv.price_storefront_ngn)
               FROM ${t(brand, "product_variants")} pv
              WHERE pv.product_id = p.product_id AND pv.is_active = true) AS from_price_ngn,
            (SELECT img.cdn_url FROM ${t(brand, "product_images")} img
              WHERE img.product_id = p.product_id
              ORDER BY img.is_primary DESC, img.display_order LIMIT 1) AS primary_image_url
       FROM ${t(brand, "products")} p
       LEFT JOIN ${t(brand, "product_categories")} cat ON cat.category_id = p.category_id
      ${whereSql}
      ORDER BY p.published_at DESC NULLS LAST, p.name
      LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: countRows[0].total };
}

async function getProductBySlug({ brand, slug }) {
  const { rows } = await query(
    `SELECT p.* FROM ${t(brand, "products")} p
      WHERE p.slug = $1 AND p.is_visible_storefront = true AND p.is_deleted = false`,
    [slug],
  );
  if (!rows[0]) return null;
  const product = rows[0];
  const { rows: variants } = await query(
    `SELECT variant_id, sku, variant_name, price_storefront_ngn, payment_model
       FROM ${t(brand, "product_variants")}
      WHERE product_id = $1 AND is_active = true
      ORDER BY created_at`,
    [product.product_id],
  );
  const { rows: images } = await query(
    `SELECT image_id, variant_id, cdn_url, alt_text, is_primary, display_order
       FROM ${t(brand, "product_images")}
      WHERE product_id = $1 ORDER BY is_primary DESC, display_order`,
    [product.product_id],
  );
  return { ...product, variants, images };
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
      WHERE slug = $1 AND is_active = true`,
    [slug],
  );
  if (!rows[0]) return null;
  const collection = rows[0];
  const { rows: products } = await query(
    `SELECT p.product_id, p.name, p.slug, p.short_description
       FROM ${t(brand, "product_collection_members")} m
       JOIN ${t(brand, "products")} p ON p.product_id = m.product_id
      WHERE m.collection_id = $1
        AND p.is_visible_storefront = true AND p.is_deleted = false`,
    [collection.collection_id],
  );
  return { ...collection, products };
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
        email, visible_to)
     VALUES (ARRAY['customer'], $1, $2, $3, $4, $5, ARRAY[$6])
     RETURNING *`,
    [
      contact.display_name,
      contact.first_name || null,
      contact.last_name || null,
      contact.primary_phone,
      contact.email || null,
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
  getProductBySlug,
  listCategories,
  getCollectionBySlug,
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
