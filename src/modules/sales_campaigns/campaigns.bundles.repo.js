/**
 * Sales Campaigns v2 — Bundles repository.
 *
 * SINGLE SOURCE OF TRUTH: bundles live ONLY in the Catalogue (retention
 * `bundle_offers` + `bundle_offer_products`). A campaign merely REFERENCES a
 * Catalogue bundle via `sales_campaign_bundles.bundle_id → bundle_offers`.
 * There is no campaign-side mirror table anymore — every read below resolves
 * components, prices, images and stock LIVE from the Catalogue, so an edit in
 * Catalogue → Bundles reflects on the live campaign immediately, no re-import.
 *
 * Reads are parameter-bound; the brand is whitelisted exactly like
 * campaigns.repo. No business logic here.
 */

"use strict";

const { query } = require("../../config/database");
const { VALID_BRANDS } = require("../../config/brands");

function t(brand, table) {
  if (!VALID_BRANDS.has(brand)) throw new Error(`Invalid brand: ${brand}`);
  return `${brand}.${table}`;
}
function ex(client) {
  return client ? client.query.bind(client) : query;
}

// ── bundle components (read LIVE from the Catalogue SSOT) ─────────────────
// Resolve a Catalogue bundle's components (bundle_offer_products) to the row
// shape the public checkout/quote + the admin detail modal already consume.
// Mirrors retention `bundle.repo.listComponents`, adding the base
// variant/product the checkout needs to turn a styled component into a
// sellable order line. The column names are kept identical to the previous
// product_bundle_items query so callers (campaigns.public.service) are
// unchanged: bundle_item_id, styled_id/styled_slug/styled_name/styled_base_*,
// product_id, variant_id, quantity, unit_price_ngn, display_name, hero_image_url.
async function listBundleItems({ client, brand, bundle_id }) {
  const { rows } = await ex(client)(
    `SELECT bop.bundle_product_id      AS bundle_item_id,
            bop.bundle_id,
            bop.product_id,
            bop.variant_id,
            bop.styled_id,
            bop.quantity,
            bop.display_order           AS display_position,
            COALESCE(sp.name, p.name)   AS display_name,
            p.name                      AS product_name,
            sp.name                     AS styled_name,
            sp.slug                     AS styled_slug,
            sp.base_variant_id          AS styled_base_variant_id,
            sp.base_product_id          AS styled_base_product_id,
            pv.sku                      AS variant_sku,
            COALESCE(
              sp.retail_price_ngn,
              pv.price_storefront_ngn,
              (SELECT dv.price_storefront_ngn
                 FROM ${t(brand, "product_variants")} dv
                WHERE dv.product_id = bop.product_id
                ORDER BY dv.is_default DESC, dv.display_order
                LIMIT 1)
            )                           AS unit_price_ngn,
            COALESCE(
              pi_styled.image_url,
              pi_variant.image_url,
              pi_product.image_url
            )                           AS hero_image_url
       FROM ${t(brand, "bundle_offer_products")} bop
       LEFT JOIN ${t(brand, "products")} p          ON p.product_id  = bop.product_id
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = bop.variant_id
       LEFT JOIN ${t(brand, "styled_products")} sp  ON sp.styled_id  = bop.styled_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(cdn_url, file_path) AS image_url
           FROM ${t(brand, "product_images")}
          WHERE styled_id = bop.styled_id AND bop.styled_id IS NOT NULL
          ORDER BY is_primary DESC, display_order ASC NULLS LAST LIMIT 1
       ) pi_styled ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(cdn_url, file_path) AS image_url
           FROM ${t(brand, "product_images")}
          WHERE variant_id = bop.variant_id AND bop.variant_id IS NOT NULL
          ORDER BY is_primary DESC, display_order ASC NULLS LAST LIMIT 1
       ) pi_variant ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(cdn_url, file_path) AS image_url
           FROM ${t(brand, "product_images")}
          WHERE product_id = bop.product_id AND bop.product_id IS NOT NULL
            AND styled_id IS NULL AND variant_id IS NULL
          ORDER BY is_primary DESC, display_order ASC NULLS LAST LIMIT 1
       ) pi_product ON true
      WHERE bop.bundle_id = $1
      ORDER BY bop.display_order ASC`,
    [bundle_id],
  );
  return rows;
}

// ── sales_campaign_bundles (attachment) ──────────────────
// The link now joins straight to bundle_offers, so the offer's pricing is read
// directly (src_*) — no fragile display-name reconciliation. Components, hero
// fallback and live stock all resolve from bundle_offer_products.
async function listCampaignBundles({ client, brand, campaign_id }) {
  const { rows } = await ex(client)(
    `SELECT scb.*,
            bo.bundle_code   AS bundle_slug,
            bo.display_name  AS bundle_name,
            bo.description   AS bundle_description,
            COALESCE(bo.hero_image_url, fallback_img.image_url) AS bundle_hero_image_url,
            bo.pricing_model    AS src_pricing_model,
            bo.discount_value   AS src_discount_value,
            bo.bundle_price_ngn AS src_bundle_price_ngn,
            live_stk.live_stock AS live_bundle_stock
       FROM ${t(brand, "sales_campaign_bundles")} scb
       JOIN ${t(brand, "bundle_offers")} bo ON bo.bundle_id = scb.bundle_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(
           (SELECT COALESCE(pi.cdn_url, pi.file_path)
              FROM ${t(brand, "product_images")} pi
             WHERE pi.styled_id = bop0.styled_id AND bop0.styled_id IS NOT NULL
             ORDER BY pi.is_primary DESC, pi.display_order ASC NULLS LAST LIMIT 1),
           (SELECT COALESCE(pi.cdn_url, pi.file_path)
              FROM ${t(brand, "product_images")} pi
             WHERE pi.variant_id = bop0.variant_id AND bop0.variant_id IS NOT NULL
             ORDER BY pi.is_primary DESC, pi.display_order ASC NULLS LAST LIMIT 1),
           (SELECT COALESCE(pi.cdn_url, pi.file_path)
              FROM ${t(brand, "product_images")} pi
             WHERE pi.product_id = bop0.product_id AND bop0.product_id IS NOT NULL
               AND pi.styled_id IS NULL AND pi.variant_id IS NULL
             ORDER BY pi.is_primary DESC, pi.display_order ASC NULLS LAST LIMIT 1)
         ) AS image_url
           FROM ${t(brand, "bundle_offer_products")} bop0
          WHERE bop0.bundle_id = bo.bundle_id
          ORDER BY bop0.display_order ASC
          LIMIT 1
       ) fallback_img ON bo.hero_image_url IS NULL
       LEFT JOIN LATERAL (
         SELECT MIN(
           COALESCE(
             (SELECT SUM(sl.available)
                FROM ${t(brand, "stock_levels")} sl
                JOIN ${t(brand, "stock_locations")} loc ON loc.location_id = sl.location_id
               WHERE sl.variant_id = COALESCE(
                       bop.variant_id,
                       sp.base_variant_id,
                       (SELECT pv.variant_id
                          FROM ${t(brand, "product_variants")} pv
                         WHERE pv.product_id = COALESCE(sp.base_product_id, bop.product_id)
                           AND pv.is_active = true
                         ORDER BY pv.is_default DESC, pv.display_order ASC
                         LIMIT 1)
                     )
                 AND loc.available_for_storefront = true),
             0
           ) / GREATEST(bop.quantity, 1)
         )::INTEGER AS live_stock
           FROM ${t(brand, "bundle_offer_products")} bop
           LEFT JOIN ${t(brand, "styled_products")} sp ON sp.styled_id = bop.styled_id
          WHERE bop.bundle_id = scb.bundle_id
            AND (bop.variant_id IS NOT NULL OR bop.styled_id IS NOT NULL OR bop.product_id IS NOT NULL)
       ) live_stk ON true
      WHERE scb.campaign_id = $1
      ORDER BY scb.display_order ASC, scb.created_at ASC`,
    [campaign_id],
  );
  return rows;
}

// Fetch a single campaign↔bundle link so the public checkout/quote can price a
// bundle. Returns the link PLUS the Catalogue offer's pricing (read directly
// from bundle_offers — the link IS the offer now), so checkout charges the same
// discount the storefront shows the instant it is edited in Catalogue.
// Returns null when the bundle isn't attached to the campaign.
async function getCampaignBundle({ client, brand, campaign_id, bundle_id }) {
  const { rows } = await ex(client)(
    `SELECT scb.*,
            bo.display_name     AS bundle_name,
            bo.pricing_model    AS src_pricing_model,
            bo.discount_value   AS src_discount_value,
            bo.bundle_price_ngn AS src_bundle_price_ngn
       FROM ${t(brand, "sales_campaign_bundles")} scb
       JOIN ${t(brand, "bundle_offers")} bo ON bo.bundle_id = scb.bundle_id
      WHERE scb.campaign_id = $1 AND scb.bundle_id = $2
      LIMIT 1`,
    [campaign_id, bundle_id],
  );
  return rows[0] || null;
}

async function attachCampaignBundle({ client, brand, campaign_id, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "sales_campaign_bundles")}
       (campaign_id, bundle_id, per_item_discount_ngn, campaign_bundle_price_ngn,
        preorder_enabled, preorder_loss_pct, preorder_lead_weeks,
        starting_stock, is_featured, display_order)
     VALUES ($1,$2,$3,$4, COALESCE($5,false), $6, $7, $8, COALESCE($9,false), COALESCE($10,0))
     ON CONFLICT (campaign_id, bundle_id) DO UPDATE SET
       per_item_discount_ngn   = EXCLUDED.per_item_discount_ngn,
       campaign_bundle_price_ngn = EXCLUDED.campaign_bundle_price_ngn,
       preorder_enabled        = EXCLUDED.preorder_enabled,
       preorder_loss_pct       = EXCLUDED.preorder_loss_pct,
       preorder_lead_weeks     = EXCLUDED.preorder_lead_weeks,
       starting_stock          = EXCLUDED.starting_stock,
       is_featured             = EXCLUDED.is_featured,
       display_order           = EXCLUDED.display_order
     RETURNING *`,
    [
      campaign_id,
      input.bundle_id,
      input.per_item_discount_ngn ?? null,
      input.campaign_bundle_price_ngn ?? null,
      input.preorder_enabled,
      input.preorder_loss_pct ?? null,
      input.preorder_lead_weeks ?? null,
      input.starting_stock ?? null,
      input.is_featured,
      input.display_order ?? null,
    ],
  );
  // Stock is computed live in listCampaignBundles from bundle_offer_products;
  // no snapshot to refresh (the old fn_refresh_campaign_bundle_stock is gone).
  return rows[0];
}

async function detachCampaignBundle({ client, brand, link_id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "sales_campaign_bundles")} WHERE link_id = $1`,
    [link_id],
  );
  return rowCount > 0;
}

// ── quantity tiers ───────────────────────────────────────
async function listTiers({ client, brand, campaign_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "sales_campaign_quantity_tiers")}
      WHERE campaign_id = $1 AND is_active = true
      ORDER BY min_quantity ASC`,
    [campaign_id],
  );
  return rows;
}

async function upsertTier({ client, brand, campaign_id, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "sales_campaign_quantity_tiers")}
       (campaign_id, min_quantity, fixed_discount_ngn, label,
        scope_bundle_ids, scope_product_ids, display_order)
     VALUES ($1,$2,$3,$4, COALESCE($5,'{}'::uuid[]), COALESCE($6,'{}'::uuid[]), COALESCE($7,0))
     ON CONFLICT (campaign_id, min_quantity) DO UPDATE SET
       fixed_discount_ngn = EXCLUDED.fixed_discount_ngn,
       label              = EXCLUDED.label,
       scope_bundle_ids   = EXCLUDED.scope_bundle_ids,
       scope_product_ids  = EXCLUDED.scope_product_ids,
       display_order      = EXCLUDED.display_order,
       is_active          = true
     RETURNING *`,
    [
      campaign_id,
      input.min_quantity,
      input.fixed_discount_ngn,
      input.label || null,
      input.scope_bundle_ids || null,
      input.scope_product_ids || null,
      input.display_order ?? null,
    ],
  );
  return rows[0];
}

async function deleteTier({ client, brand, tier_id }) {
  const { rowCount } = await ex(client)(
    `UPDATE ${t(brand, "sales_campaign_quantity_tiers")} SET is_active=false WHERE tier_id = $1`,
    [tier_id],
  );
  return rowCount > 0;
}

// ── cart upsells ─────────────────────────────────────────
async function listUpsells({ client, brand, campaign_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "sales_campaign_cart_upsells")}
      WHERE campaign_id = $1 AND is_active = true
      ORDER BY rung ASC, display_order ASC`,
    [campaign_id],
  );
  return rows;
}

async function upsertUpsell({ client, brand, campaign_id, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "sales_campaign_cart_upsells")}
       (campaign_id, rung, trigger_type, min_cart_qty, min_cart_value_ngn,
        trigger_bundle_id, offer_label, offer_subline, reward_type, reward_value,
        reward_bundle_id, display_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9,'fixed_amount'), $10, $11, COALESCE($12,0))
     RETURNING *`,
    [
      campaign_id,
      input.rung,
      input.trigger_type,
      input.min_cart_qty ?? null,
      input.min_cart_value_ngn ?? null,
      input.trigger_bundle_id || null,
      input.offer_label,
      input.offer_subline || null,
      input.reward_type,
      input.reward_value ?? null,
      input.reward_bundle_id || null,
      input.display_order ?? null,
    ],
  );
  return rows[0];
}

async function deleteUpsell({ client, brand, upsell_id }) {
  const { rowCount } = await ex(client)(
    `UPDATE ${t(brand, "sales_campaign_cart_upsells")} SET is_active=false WHERE upsell_id = $1`,
    [upsell_id],
  );
  return rowCount > 0;
}

// ── ambassadors ──────────────────────────────────────────
async function listCampaignAmbassadors({ client, brand, campaign_id }) {
  const { rows } = await ex(client)(
    `SELECT sca.*,
            c.first_name,
            c.last_name,
            c.ambassador_profile->'social_handles'->>'instagram' AS instagram_handle,
            c.email,
            c.primary_phone AS phone
       FROM ${t(brand, "sales_campaign_ambassadors")} sca
       LEFT JOIN shared.contacts c ON c.contact_id = sca.contact_id
      WHERE sca.campaign_id = $1
      ORDER BY sca.revenue_ngn DESC, sca.created_at ASC`,
    [campaign_id],
  );
  return rows;
}

async function addCampaignAmbassador({ client, brand, campaign_id, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "sales_campaign_ambassadors")}
       (campaign_id, contact_id, utm_source, commission_pct, share_link, qr_url)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (campaign_id, contact_id) DO UPDATE SET
       utm_source     = EXCLUDED.utm_source,
       commission_pct = EXCLUDED.commission_pct,
       share_link     = EXCLUDED.share_link,
       qr_url         = EXCLUDED.qr_url
     RETURNING *`,
    [
      campaign_id,
      input.contact_id,
      input.utm_source,
      input.commission_pct ?? null,
      input.share_link || null,
      input.qr_url || null,
    ],
  );
  return rows[0];
}

async function removeCampaignAmbassador({ client, brand, ambassador_link_id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "sales_campaign_ambassadors")} WHERE ambassador_link_id = $1`,
    [ambassador_link_id],
  );
  return rowCount > 0;
}

// ── ambassadors (shared.contacts promotion) ──────────────
async function listAmbassadorContacts({ client, brand, q, limit = 50 }) {
  const params = [brand];
  let i = 2;
  let qFilter = "";
  if (q) {
    qFilter = ` AND (c.first_name ILIKE $${i} OR c.last_name ILIKE $${i} OR c.ambassador_profile->'social_handles'->>'instagram' ILIKE $${i})`;
    params.push(`%${q}%`);
    i++;
  }
  const { rows } = await ex(client)(
    `SELECT c.contact_id,
            c.first_name,
            c.last_name,
            c.ambassador_profile->'social_handles'->>'instagram' AS instagram_handle,
            c.email,
            c.primary_phone AS phone,
            c.ambassador_profile
       FROM shared.contacts c
      WHERE c.is_ambassador = true
        AND (c.visible_to = '{}' OR $1 = ANY(c.visible_to))${qFilter}
      ORDER BY c.first_name ASC, c.last_name ASC
      LIMIT $${i}`,
    [...params, limit],
  );
  return rows;
}

async function promoteContactToAmbassador({
  client,
  brand,
  contact_id,
  profile = {},
}) {
  // brand passed for audit context; the contact is visible by visible_to.
  const { rows } = await ex(client)(
    `UPDATE shared.contacts
        SET is_ambassador = true,
            ambassador_profile = COALESCE(ambassador_profile, '{}'::jsonb) || $2::jsonb
      WHERE contact_id = $1
      RETURNING contact_id, first_name, last_name,
                ambassador_profile->'social_handles'->>'instagram' AS instagram_handle,
                ambassador_profile`,
    [contact_id, JSON.stringify(profile)],
  );
  void brand;
  return rows[0] || null;
}

async function demoteAmbassador({ client, brand, contact_id }) {
  await ex(client)(
    `UPDATE shared.contacts SET is_ambassador = false WHERE contact_id = $1`,
    [contact_id],
  );
  void brand;
}

module.exports = {
  // bundle components (read from the Catalogue SSOT)
  listBundleItems,
  // campaign attachment
  listCampaignBundles,
  getCampaignBundle,
  attachCampaignBundle,
  detachCampaignBundle,
  // tiers
  listTiers,
  upsertTier,
  deleteTier,
  // upsells
  listUpsells,
  upsertUpsell,
  deleteUpsell,
  // ambassadors
  listCampaignAmbassadors,
  addCampaignAmbassador,
  removeCampaignAmbassador,
  listAmbassadorContacts,
  promoteContactToAmbassador,
  demoteAmbassador,
};
