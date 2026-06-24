/**
 * Sales Campaigns v2 — Bundles repository.
 *
 * Bundles are first-class catalogue entities (per Faith: "Bundles live
 * in Catalogue, reusable across campaigns" + "one-off escape hatch").
 * Reads / writes are parameter-bound; the brand is whitelisted exactly
 * like campaigns.repo. No business logic here.
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

// ── product_bundles ──────────────────────────────────────
const BUNDLE_COLS = [
  "slug",
  "name",
  "description",
  "hero_image_url",
  "category_id",
  "is_fixed_composition",
  "default_per_item_discount_ngn",
  "default_preorder_loss_pct",
  "status",
  "display_order",
];

async function listBundles({
  client,
  brand,
  filters = {},
  limit = 100,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  } else {
    where.push(`status <> 'archived'`);
  }
  if (filters.q) {
    where.push(`(name ILIKE $${i} OR slug ILIKE $${i})`);
    params.push(`%${filters.q}%`);
    i++;
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "product_bundles")} ${whereSql}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "product_bundles")} ${whereSql}
      ORDER BY display_order ASC, created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...params, limit, offset],
  );
  return {
    data: rows,
    meta: { total: c[0].total, has_more: offset + rows.length < c[0].total },
  };
}

async function findBundle({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_bundles")} WHERE bundle_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function findBundleBySlug({ client, brand, slug }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_bundles")} WHERE slug = $1`,
    [slug],
  );
  return rows[0] || null;
}

async function createBundle({ client, brand, input, user_id }) {
  const cols = [];
  const placeholders = [];
  const params = [];
  let i = 1;
  for (const col of BUNDLE_COLS) {
    if (input[col] === undefined) continue;
    cols.push(col);
    placeholders.push(`$${i++}`);
    params.push(input[col]);
  }
  cols.push("created_by");
  placeholders.push(`$${i++}`);
  params.push(user_id);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "product_bundles")} (${cols.join(", ")})
     VALUES (${placeholders.join(", ")}) RETURNING *`,
    params,
  );
  return rows[0];
}

async function updateBundle({ client, brand, id, patch }) {
  const sets = [];
  const params = [];
  let i = 1;
  for (const col of BUNDLE_COLS) {
    if (patch[col] === undefined) continue;
    sets.push(`${col} = $${i++}`);
    params.push(patch[col]);
  }
  if (sets.length === 0) return findBundle({ client, brand, id });
  params.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "product_bundles")} SET ${sets.join(", ")}
      WHERE bundle_id = $${i} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function deleteBundle({ client, brand, id }) {
  const { rowCount } = await ex(client)(
    `UPDATE ${t(brand, "product_bundles")} SET status='archived' WHERE bundle_id = $1`,
    [id],
  );
  return rowCount > 0;
}

// ── bundle_items ─────────────────────────────────────────
async function listBundleItems({ client, brand, bundle_id }) {
  // Image lookup follows the storefront fallback chain: styled gallery first
  // (the styled product is what the buyer is shopping for), then the pinned
  // variant, then the base product's main image. Each LATERAL keeps the join
  // single-row so the bundle item never duplicates.
  const { rows } = await ex(client)(
    `SELECT bi.*,
            COALESCE(sp.name, p.name) AS display_name,
            p.name                    AS product_name,
            sp.name                   AS styled_name,
            sp.slug                   AS styled_slug,
            pv.sku                    AS variant_sku,
            COALESCE(
              sp.retail_price_ngn,
              pv.price_storefront_ngn,
              (SELECT dv.price_storefront_ngn
                 FROM ${t(brand, "product_variants")} dv
                WHERE dv.product_id = bi.product_id
                ORDER BY dv.is_default DESC, dv.display_order
                LIMIT 1)
            )                         AS unit_price_ngn,
            COALESCE(
              pi_styled.image_url,
              pi_variant.image_url,
              pi_product.image_url
            )                         AS hero_image_url
       FROM ${t(brand, "product_bundle_items")} bi
       LEFT JOIN ${t(brand, "products")} p          ON p.product_id  = bi.product_id
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = bi.variant_id
       LEFT JOIN ${t(brand, "styled_products")} sp  ON sp.styled_id  = bi.styled_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(cdn_url, file_path) AS image_url
           FROM ${t(brand, "product_images")}
          WHERE styled_id = bi.styled_id AND bi.styled_id IS NOT NULL
          ORDER BY is_primary DESC, display_order ASC NULLS LAST LIMIT 1
       ) pi_styled ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(cdn_url, file_path) AS image_url
           FROM ${t(brand, "product_images")}
          WHERE variant_id = bi.variant_id AND bi.variant_id IS NOT NULL
          ORDER BY is_primary DESC, display_order ASC NULLS LAST LIMIT 1
       ) pi_variant ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(cdn_url, file_path) AS image_url
           FROM ${t(brand, "product_images")}
          WHERE product_id = bi.product_id AND bi.product_id IS NOT NULL
            AND styled_id IS NULL AND variant_id IS NULL
          ORDER BY is_primary DESC, display_order ASC NULLS LAST LIMIT 1
       ) pi_product ON true
      WHERE bi.bundle_id = $1
      ORDER BY bi.display_position ASC`,
    [bundle_id],
  );
  return rows;
}

async function addBundleItem({ client, brand, bundle_id, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "product_bundle_items")}
       (bundle_id, product_id, variant_id, styled_id, quantity, per_item_discount_ngn, display_position)
     VALUES ($1,$2,$3,$4, COALESCE($5,1), $6, COALESCE($7,0))
     RETURNING *`,
    [
      bundle_id,
      input.product_id || null,
      input.variant_id || null,
      input.styled_id || null,
      input.quantity ?? null,
      input.per_item_discount_ngn ?? null,
      input.display_position ?? null,
    ],
  );
  return rows[0];
}

async function removeBundleItem({ client, brand, bundle_item_id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "product_bundle_items")} WHERE bundle_item_id = $1`,
    [bundle_item_id],
  );
  return rowCount > 0;
}

async function reorderBundleItems({ client, brand, bundle_id, ordered_ids }) {
  for (let i = 0; i < ordered_ids.length; i++) {
    await ex(client)(
      `UPDATE ${t(brand, "product_bundle_items")} SET display_position = $1
        WHERE bundle_item_id = $2 AND bundle_id = $3`,
      [i, ordered_ids[i], bundle_id],
    );
  }
}

// ── sales_campaign_bundles (attachment) ──────────────────
async function listCampaignBundles({ client, brand, campaign_id }) {
  const { rows } = await ex(client)(
    `SELECT scb.*,
            pb.slug AS bundle_slug, pb.name AS bundle_name,
            pb.description AS bundle_description,
            pb.hero_image_url AS bundle_hero_image_url,
            pb.default_per_item_discount_ngn,
            pb.default_preorder_loss_pct
       FROM ${t(brand, "sales_campaign_bundles")} scb
       JOIN ${t(brand, "product_bundles")} pb ON pb.bundle_id = scb.bundle_id
      WHERE scb.campaign_id = $1
      ORDER BY scb.display_order ASC, scb.created_at ASC`,
    [campaign_id],
  );
  return rows;
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
  // refresh stock snapshot from the variant inventory
  await ex(client)(
    `SELECT ${brand}.fn_refresh_campaign_bundle_stock($1::uuid)`,
    [rows[0].link_id],
  );
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
  // bundles
  listBundles,
  findBundle,
  findBundleBySlug,
  createBundle,
  updateBundle,
  deleteBundle,
  listBundleItems,
  addBundleItem,
  removeBundleItem,
  reorderBundleItems,
  // campaign attachment
  listCampaignBundles,
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
