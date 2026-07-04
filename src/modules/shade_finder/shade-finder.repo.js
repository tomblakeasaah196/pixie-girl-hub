/**
 * Shade Finder — read-only catalogue queries (per-brand schema).
 *
 * The AI never free-types a product: everything it can recommend comes from
 * these rows. Both queries scope to LIVE, storefront-visible styled products
 * exactly like the public shade pages (storefront.repo), so a deeplink from
 * the chat always lands on a page that exists.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");
// Pricing SSOT — the same LATERAL the storefront cards use, so a price quoted
// in chat can never disagree with the product page it deeplinks to.
const { fromPriceLateral } = require("../storefront/storefront.repo");

/**
 * All active shades with their live-product colour swatches (name + hex).
 * ~7 rows per brand by design — small enough to hand the whole list to the
 * LLM as a closed enum of slugs.
 */
async function listActiveShadesWithSwatches({ brand }) {
  const { rows } = await query(
    `SELECT sh.shade_id, sh.shade_code, sh.name, sh.slug,
            sh.short_description, sh.cover_image_url, sh.display_order,
            (SELECT count(*)::int FROM ${t(brand, "styled_products")} s
              WHERE s.shade_id = sh.shade_id AND s.status = 'live'
                AND s.is_visible_storefront = true AND s.is_deleted = false)
              AS product_count,
            COALESCE((
              SELECT json_agg(DISTINCT jsonb_build_object('name', c.name, 'hex', c.hex))
                FROM ${t(brand, "styled_products")} s
                JOIN ${t(brand, "styled_product_colours")} c ON c.styled_id = s.styled_id
               WHERE s.shade_id = sh.shade_id AND s.status = 'live'
                 AND s.is_visible_storefront = true AND s.is_deleted = false
                 AND c.is_active = true AND c.hex IS NOT NULL
            ), '[]'::json) AS swatches
       FROM ${t(brand, "styled_shades")} sh
      WHERE sh.is_active = true AND sh.deleted_at IS NULL
      ORDER BY sh.display_order, sh.name`,
  );
  return rows;
}

/**
 * Live styled products under the given shades — the card shape the storefront
 * renders (same fields as storefront.repo.getShadeBySlug) plus the colour
 * list (name + hex) so the LLM can reason about specific colourways.
 */
async function listProductsForShades({ brand, shade_ids, limit = 40 }) {
  if (!shade_ids || shade_ids.length === 0) return [];
  const { rows } = await query(
    `SELECT s.styled_id, s.shade_id, s.name, s.slug, s.short_description,
            s.retail_price_ngn, s.retail_price_usd,
            COALESCE(fp.from_price_ngn, s.retail_price_ngn) AS effective_price_ngn,
            COALESCE(fp.from_price_usd, s.retail_price_usd) AS effective_price_usd,
            (SELECT img.cdn_url FROM ${t(brand, "product_images")} img
              WHERE img.styled_id = s.styled_id
              ORDER BY img.is_primary DESC, img.display_order LIMIT 1)
              AS cover_image_url,
            COALESCE((
              SELECT json_agg(jsonb_build_object('name', c.name, 'hex', c.hex)
                              ORDER BY c.display_order)
                FROM ${t(brand, "styled_product_colours")} c
               WHERE c.styled_id = s.styled_id AND c.is_active = true
            ), '[]'::json) AS colours
       FROM ${t(brand, "styled_products")} s
       ${fromPriceLateral(brand)}
      WHERE s.shade_id = ANY($1) AND s.status = 'live'
        AND s.is_visible_storefront = true AND s.is_deleted = false
      ORDER BY s.published_at DESC NULLS LAST, s.name
      LIMIT $2`,
    [shade_ids, limit],
  );
  return rows;
}

// ── Brand-brain sources (public-safe, read-only) ────────────
// Everything below feeds the conversational grounding pack. Only columns
// that already render on the public storefront (or on printed receipts)
// are selected — nothing internal ever reaches the prompt.

/** Public identity of the brand — the facts Praxis may state as its own. */
async function getBrandIdentity({ brand }) {
  const { rows } = await query(
    `SELECT display_name, support_email, email, phone, address, website,
            storefront_domain, mission_statement, payment_methods
       FROM shared.business_config
      WHERE business_key = $1`,
    [brand],
  );
  return rows[0] || null;
}

/**
 * Published content posts of the given types (FAQ entries, care guides,
 * journal articles, policy pages). Empty today for brands that have not
 * published any — the brain treats absence as "say you don't have that
 * detail", never as licence to improvise.
 */
async function listPublishedPosts({ brand, types, limit = 60 }) {
  const { rows } = await query(
    `SELECT post_id, post_type, slug, title, excerpt, body,
            faq_category, faq_question
       FROM ${t(brand, "storefront_content_posts")}
      WHERE post_type = ANY($1) AND status = 'published'
      ORDER BY display_order, published_at DESC NULLS LAST
      LIMIT $2`,
    [types, limit],
  );
  return rows;
}

/**
 * Storefront-visible services with the public detail fields (what's
 * included, aftercare, deposit) — all of which already render on the
 * public /services pages.
 */
async function listPublicServices({ brand }) {
  const { rows } = await query(
    `SELECT slug, name, short_description, base_price_ngn,
            compare_at_price_ngn, price_is_from, duration_minutes,
            location_type, deposit_required, deposit_pct,
            whats_included, aftercare_notes
       FROM shared.service_offerings
      WHERE business = $1 AND is_visible_storefront = true AND is_active = true
      ORDER BY is_featured DESC, sort_order ASC, name ASC`,
    [brand],
  );
  return rows;
}

module.exports = {
  listActiveShadesWithSwatches,
  listProductsForShades,
  getBrandIdentity,
  listPublishedPosts,
  listPublicServices,
};
