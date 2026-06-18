/**
 * Catalogue (V2.2 §6.4/§6.9) — repository. Parameterised SQL only.
 * Tables: product_categories, products, product_variants (per-brand).
 * Uniqueness (product_code, slug, sku) is enforced by the DB; the error
 * handler maps 23505 → CONFLICT, so no pre-checks needed here.
 */

"use strict";

const { query } = require("../../config/database");

const { VALID } = require("../../config/brands");
const t = (b, tbl) => {
  if (!VALID.has(b)) throw new Error(`Invalid brand: ${b}`);
  return `${b}.${tbl}`;
};
const ex = (c) => (c ? c.query.bind(c) : query);

const JSONB = new Set(["channel_external_ids", "channel_sync_state"]);

const CAT_COLS = [
  "parent_category_id",
  "name",
  "slug",
  "description",
  "hero_image_url",
  "meta_title",
  "meta_description",
  "display_order",
  "is_visible_storefront",
  "is_active",
];
const PROD_COLS = [
  "category_id",
  "product_code",
  "name",
  "slug",
  "short_description",
  "long_description",
  "texture_type",
  "lace_type",
  "hair_length_inches",
  "density",
  "cap_size",
  "primary_colour",
  "hair_origin",
  "care_instructions",
  "product_type",
  "is_custom",
  "is_visible_storefront",
  "visible_on_channels",
  "brand_name",
  "meta_title",
  "meta_description",
  "track_stock",
  "taxable",
  "vat_rate",
  "payment_model",
  "required_deposit_pct",
  "search_keywords",
  // Pre-order / production timeline (P0-7).
  "preorder_enabled",
  "expected_ready_date",
  "production_lead_days",
];
const VAR_COLS = [
  "sku",
  "barcode",
  "variant_name",
  "variant_length_inches",
  "variant_colour",
  "variant_density",
  "variant_cap_size",
  "price_storefront_ngn",
  "price_pos_ngn",
  "price_wholesale_ngn",
  "price_partner_ngn",
  "compare_at_price_ngn",
  // cost_price_ngn / min_price_ngn DEPRECATED (P0-1) — true cost lives
  // encrypted in product_variant_cost_vault, never written here.
  "min_margin_pct",
  "weight_g",
  "channel_external_ids",
  "payment_model_override",
  "required_deposit_pct_override",
  "reorder_point",
  "reorder_quantity",
  "display_order",
  "is_default",
  "is_active",
];

function insert(cols, src, extra = {}) {
  const f = [],
    ph = [],
    p = [];
  let i = 1;
  for (const c of cols) {
    if (src[c] === undefined) continue;
    f.push(c);
    ph.push(JSONB.has(c) ? `$${i}::jsonb` : `$${i}`);
    p.push(JSONB.has(c) ? JSON.stringify(src[c]) : src[c]);
    i++;
  }
  for (const [c, v] of Object.entries(extra)) {
    f.push(c);
    ph.push(`$${i}`);
    p.push(v);
    i++;
  }
  return { f, ph, p };
}
function setClause(cols, src, start = 1) {
  const f = [],
    p = [];
  let i = start;
  for (const c of cols) {
    if (src[c] === undefined) continue;
    f.push(JSONB.has(c) ? `${c} = $${i}::jsonb` : `${c} = $${i}`);
    p.push(JSONB.has(c) ? JSON.stringify(src[c]) : src[c]);
    i++;
  }
  return { f, p, next: i };
}

// ── Categories ───────────────────────────────────────────
async function listCategories({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_categories")} ORDER BY display_order, name`,
  );
  return rows;
}
async function getCategory({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_categories")} WHERE category_id = $1`,
    [id],
  );
  return rows[0] || null;
}
// Resolve a category by name (case-insensitive) for the import — the operator
// types a category name; the service creates it on the fly when missing.
async function findCategoryByName({ client, brand, name }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_categories")} WHERE lower(name) = lower($1) LIMIT 1`,
    [name],
  );
  return rows[0] || null;
}
async function categorySlugTaken({ client, brand, slug }) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "product_categories")} WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  return rows.length > 0;
}
async function createCategory({ client, brand, input }) {
  const { f, ph, p } = insert(CAT_COLS, input);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "product_categories")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function updateCategory({ client, brand, id, patch }) {
  const { f, p, next } = setClause(CAT_COLS, patch);
  if (!f.length) return getCategory({ client, brand, id });
  p.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "product_categories")} SET ${f.join(",")} WHERE category_id = $${next} RETURNING *`,
    p,
  );
  return rows[0] || null;
}
async function archiveCategory({ client, brand, id }) {
  await ex(client)(
    `UPDATE ${t(brand, "product_categories")} SET is_active = false WHERE category_id = $1`,
    [id],
  );
}

// ── Products ─────────────────────────────────────────────
async function findAllProducts({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = ["is_deleted = false"];
  const params = [];
  let i = 1;
  if (filters.category_id) {
    where.push(`category_id = $${i++}`);
    params.push(filters.category_id);
  }
  if (filters.product_type) {
    where.push(`product_type = $${i++}`);
    params.push(filters.product_type);
  }
  if (filters.visible !== undefined) {
    where.push(`is_visible_storefront = $${i++}`);
    params.push(filters.visible);
  }
  if (filters.q) {
    where.push(
      `(name ILIKE $${i} OR product_code ILIKE $${i} OR slug ILIKE $${i})`,
    );
    params.push(`%${filters.q}%`);
    i++;
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "products")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "products")} ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function findProductById({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "products")} WHERE product_id = $1 AND is_deleted = false`,
    [id],
  );
  return rows[0] || null;
}
// Exact full-name match among LIVE products — drives the import upsert (a
// re-imported row updates the existing product instead of duplicating it).
async function findProductByName({ client, brand, name }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "products")}
      WHERE lower(name) = lower($1) AND is_deleted = false
      ORDER BY created_at ASC LIMIT 1`,
    [name],
  );
  return rows[0] || null;
}
// Slug/code uniqueness probes. Uniqueness is now PARTIAL (live rows only,
// 000041), so a deleted product frees its name — these check LIVE rows so the
// service can reuse a freed name and only disambiguates against active ones.
async function productSlugTaken({ client, brand, slug }) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "products")} WHERE slug = $1 AND is_deleted = false LIMIT 1`,
    [slug],
  );
  return rows.length > 0;
}
async function productCodeTaken({ client, brand, code }) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "products")} WHERE product_code = $1 AND is_deleted = false LIMIT 1`,
    [code],
  );
  return rows.length > 0;
}
async function createProduct({ client, brand, input, user_id }) {
  const { f, ph, p } = insert(PROD_COLS, input, { created_by: user_id });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "products")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function updateProduct({ client, brand, id, patch }) {
  const { f, p, next } = setClause(PROD_COLS, patch);
  if (!f.length) return findProductById({ client, brand, id });
  p.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "products")} SET ${f.join(",")} WHERE product_id = $${next} AND is_deleted = false RETURNING *`,
    p,
  );
  return rows[0] || null;
}
async function softDeleteProduct({ client, brand, id }) {
  const { rowCount } = await ex(client)(
    `UPDATE ${t(brand, "products")} SET is_deleted = true, deleted_at = now() WHERE product_id = $1 AND is_deleted = false`,
    [id],
  );
  return rowCount > 0;
}
// ── Trash + Restore ──────────────────────────────────────
async function listTrashedProducts({ client, brand, page = 1, page_size = 25, offset = 0 }) {
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "products")} WHERE is_deleted = true`,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "products")} WHERE is_deleted = true
      ORDER BY deleted_at DESC NULLS LAST LIMIT $1 OFFSET $2`,
    [page_size, offset],
  );
  return {
    data: rows,
    meta: { page, page_size, total: c[0].total, has_more: offset + rows.length < c[0].total },
  };
}
async function getTrashedProductById({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "products")} WHERE product_id = $1 AND is_deleted = true`,
    [id],
  );
  return rows[0] || null;
}
async function restoreProduct({ client, brand, id, slug, product_code }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "products")}
        SET is_deleted = false, deleted_at = null,
            slug = COALESCE($2, slug), product_code = COALESCE($3, product_code)
      WHERE product_id = $1 AND is_deleted = true RETURNING *`,
    [id, slug || null, product_code || null],
  );
  return rows[0] || null;
}

// ── Variants ─────────────────────────────────────────────
async function listVariants({ client, brand, product_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_variants")} WHERE product_id = $1 ORDER BY display_order, variant_name`,
    [product_id],
  );
  return rows;
}
async function getVariant({ client, brand, product_id, variant_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_variants")} WHERE variant_id = $1 AND product_id = $2`,
    [variant_id, product_id],
  );
  return rows[0] || null;
}
// The product's default (then first) variant — where the import writes the
// wholesale price + cost for an existing product.
async function getDefaultVariant({ client, brand, product_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_variants")}
      WHERE product_id = $1
      ORDER BY is_default DESC, display_order ASC, created_at ASC LIMIT 1`,
    [product_id],
  );
  return rows[0] || null;
}
async function createVariant({ client, brand, product_id, input }) {
  const { f, ph, p } = insert(VAR_COLS, input, { product_id });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "product_variants")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function updateVariant({ client, brand, product_id, variant_id, patch }) {
  const { f, p, next } = setClause(VAR_COLS, patch);
  if (!f.length) return getVariant({ client, brand, product_id, variant_id });
  p.push(variant_id, product_id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "product_variants")} SET ${f.join(",")} WHERE variant_id = $${next} AND product_id = $${next + 1} RETURNING *`,
    p,
  );
  return rows[0] || null;
}
async function deactivateVariant({ client, brand, product_id, variant_id }) {
  const { rowCount } = await ex(client)(
    `UPDATE ${t(brand, "product_variants")} SET is_active = false WHERE variant_id = $1 AND product_id = $2`,
    [variant_id, product_id],
  );
  return rowCount > 0;
}

// ── Collections (+ rules + members) ──────────────────────
const COLL_COLS = [
  "name",
  "slug",
  "description",
  "hero_image_url",
  "mode",
  "display_image_url",
  "display_order",
  "is_visible_storefront",
  "is_active",
  "meta_title",
  "meta_description",
];
async function listCollections({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_collections")} ORDER BY display_order, name`,
  );
  return rows;
}
async function getCollection({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_collections")} WHERE collection_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function createCollection({ client, brand, input }) {
  const { f, ph, p } = insert(COLL_COLS, input);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "product_collections")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function updateCollection({ client, brand, id, patch }) {
  const { f, p, next } = setClause(COLL_COLS, patch);
  if (!f.length) return getCollection({ client, brand, id });
  p.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "product_collections")} SET ${f.join(",")} WHERE collection_id = $${next} RETURNING *`,
    p,
  );
  return rows[0] || null;
}
async function archiveCollection({ client, brand, id }) {
  await ex(client)(
    `UPDATE ${t(brand, "product_collections")} SET is_active = false WHERE collection_id = $1`,
    [id],
  );
}
async function listCollectionRules({ client, brand, collection_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_collection_rules")} WHERE collection_id = $1 ORDER BY display_order`,
    [collection_id],
  );
  return rows;
}
async function addCollectionRule({ client, brand, collection_id, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "product_collection_rules")} (collection_id, field, operator, value, combinator, display_order)
     VALUES ($1,$2,$3,$4::jsonb,COALESCE($5,'AND'),COALESCE($6,0)) RETURNING *`,
    [
      collection_id,
      input.field,
      input.operator,
      JSON.stringify(input.value),
      input.combinator,
      input.display_order,
    ],
  );
  return rows[0];
}
async function removeCollectionRule({ client, brand, collection_id, rule_id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "product_collection_rules")} WHERE rule_id = $1 AND collection_id = $2`,
    [rule_id, collection_id],
  );
  return rowCount > 0;
}
async function listCollectionMembers({ client, brand, collection_id }) {
  const { rows } = await ex(client)(
    `SELECT m.*, p.name AS product_name FROM ${t(brand, "product_collection_members")} m
       JOIN ${t(brand, "products")} p ON p.product_id = m.product_id
      WHERE m.collection_id = $1 ORDER BY m.display_order`,
    [collection_id],
  );
  return rows;
}
async function addCollectionMember({
  client,
  brand,
  collection_id,
  product_id,
  display_order,
  user_id,
}) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "product_collection_members")} (collection_id, product_id, display_order, added_by, source)
     VALUES ($1,$2,COALESCE($3,0),$4,'manual')
     ON CONFLICT (collection_id, product_id) DO UPDATE SET display_order = EXCLUDED.display_order RETURNING *`,
    [collection_id, product_id, display_order, user_id || null],
  );
  return rows[0];
}
async function removeCollectionMember({
  client,
  brand,
  collection_id,
  product_id,
}) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "product_collection_members")} WHERE collection_id = $1 AND product_id = $2`,
    [collection_id, product_id],
  );
  return rowCount > 0;
}

// ── Images ───────────────────────────────────────────────
async function listImages({ client, brand, product_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_images")} WHERE product_id = $1 ORDER BY is_primary DESC, display_order`,
    [product_id],
  );
  return rows;
}
async function addImage({ client, brand, image }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "product_images")} (product_id, variant_id, styled_id, styled_colour_id, file_path, cdn_url, alt_text, caption, display_order, is_primary, file_size_bytes, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),COALESCE($10,false),$11,$12) RETURNING *`,
    [
      image.product_id,
      image.variant_id || null,
      image.styled_id || null,
      image.styled_colour_id || null,
      image.file_path,
      image.cdn_url,
      image.alt_text,
      image.caption,
      image.display_order,
      image.is_primary,
      image.file_size_bytes,
      image.uploaded_by || null,
    ],
  );
  return rows[0];
}
// A styled colour's own gallery (2–3 pictures per colour).
async function listColourImages({ client, brand, colour_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_images")} WHERE styled_colour_id = $1 ORDER BY display_order, uploaded_at`,
    [colour_id],
  );
  return rows;
}
async function removeColourImage({ client, brand, colour_id, image_id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "product_images")} WHERE image_id = $1 AND styled_colour_id = $2`,
    [image_id, colour_id],
  );
  return rowCount > 0;
}
async function updateImage({ client, brand, product_id, image_id, patch }) {
  const cols = [
    "alt_text",
    "caption",
    "display_order",
    "is_primary",
    "variant_id",
  ];
  const f = [],
    p = [];
  let i = 1;
  for (const c of cols) {
    if (patch[c] === undefined) continue;
    f.push(`${c} = $${i++}`);
    p.push(patch[c]);
  }
  if (!f.length) {
    const { rows } = await ex(client)(
      `SELECT * FROM ${t(brand, "product_images")} WHERE image_id = $1 AND product_id = $2`,
      [image_id, product_id],
    );
    return rows[0] || null;
  }
  p.push(image_id, product_id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "product_images")} SET ${f.join(",")} WHERE image_id = $${i++} AND product_id = $${i} RETURNING *`,
    p,
  );
  return rows[0] || null;
}
async function removeImage({ client, brand, product_id, image_id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "product_images")} WHERE image_id = $1 AND product_id = $2`,
    [image_id, product_id],
  );
  return rowCount > 0;
}

// ── Videos ───────────────────────────────────────────────
async function listVideos({ client, brand, product_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_videos")} WHERE product_id = $1 ORDER BY is_primary DESC, display_order`,
    [product_id],
  );
  return rows;
}
async function addVideo({ client, brand, video }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "product_videos")} (product_id, source, external_ref, embed_url, thumbnail_url, title, caption, duration_seconds, display_order, is_primary, added_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),COALESCE($10,false),$11) RETURNING *`,
    [
      video.product_id,
      video.source,
      video.external_ref,
      video.embed_url,
      video.thumbnail_url,
      video.title,
      video.caption,
      video.duration_seconds,
      video.display_order,
      video.is_primary,
      video.added_by || null,
    ],
  );
  return rows[0];
}
async function removeVideo({ client, brand, product_id, video_id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "product_videos")} WHERE video_id = $1 AND product_id = $2`,
    [video_id, product_id],
  );
  return rowCount > 0;
}

// ── Self-hosted UGC video library (W-13; media_assets, 000037) ──
async function listReadyVideoAssets({ client, brand, limit = 50 }) {
  const { rows } = await ex(client)(
    `SELECT asset_id, storage_path, mime_type, duration_sec, poster_path,
            thumbnail_path, caption, source_kind, source_creator_handle
       FROM ${t(brand, "media_assets")}
      WHERE asset_kind = 'video'
        AND processing_status = 'ready'
        AND is_archived = false
      ORDER BY uploaded_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

async function getMediaAsset({ client, brand, asset_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "media_assets")} WHERE asset_id = $1`,
    [asset_id],
  );
  return rows[0] || null;
}

// ── SEO (1:1 with product) ───────────────────────────────
async function getSeo({ client, brand, product_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_seo")} WHERE product_id = $1`,
    [product_id],
  );
  return rows[0] || null;
}
async function upsertSeo({ client, brand, product_id, patch }) {
  const cols = [
    "meta_title_override",
    "meta_description_override",
    "canonical_url",
    "og_image_url",
    "og_title",
    "og_description",
    "twitter_card",
    "robots_directive",
  ];
  const present = cols.filter((c) => patch[c] !== undefined);
  const colList = ["product_id", ...present];
  const vals = [product_id, ...present.map((c) => patch[c])];
  const ph = vals.map((_, idx) => `$${idx + 1}`);
  const setList = present
    .map((c) => `${c} = EXCLUDED.${c}`)
    .concat("updated_at = now()")
    .join(", ");
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "product_seo")} (${colList.join(",")}) VALUES (${ph.join(",")})
     ON CONFLICT (product_id) DO UPDATE SET ${setList} RETURNING *`,
    vals,
  );
  return rows[0];
}

// ── Attribute values (custom fields) ─────────────────────
async function listAttributeValues({ client, brand, product_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_attribute_values")} WHERE product_id = $1`,
    [product_id],
  );
  return rows;
}
async function upsertAttributeValue({ client, brand, product_id, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "product_attribute_values")} (product_id, field_id, value_text, value_number, value_date, value_boolean, value_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (product_id, field_id) DO UPDATE SET
       value_text = EXCLUDED.value_text, value_number = EXCLUDED.value_number, value_date = EXCLUDED.value_date,
       value_boolean = EXCLUDED.value_boolean, value_json = EXCLUDED.value_json, updated_at = now() RETURNING *`,
    [
      product_id,
      input.field_id,
      input.value_text ?? null,
      input.value_number !== null && input.value_number !== undefined
        ? input.value_number
        : null,
      input.value_date ?? null,
      input.value_boolean !== null && input.value_boolean !== undefined
        ? input.value_boolean
        : null,
      input.value_json !== null && input.value_json !== undefined
        ? JSON.stringify(input.value_json)
        : null,
    ],
  );
  return rows[0];
}
async function removeAttributeValue({ client, brand, product_id, field_id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "product_attribute_values")} WHERE product_id = $1 AND field_id = $2`,
    [product_id, field_id],
  );
  return rowCount > 0;
}

// ── Related products ─────────────────────────────────────
async function listRelated({ client, brand, product_id }) {
  const { rows } = await ex(client)(
    `SELECT r.*, p.name AS related_product_name FROM ${t(brand, "product_related")} r
       JOIN ${t(brand, "products")} p ON p.product_id = r.related_product_id
      WHERE r.product_id = $1 ORDER BY r.display_order`,
    [product_id],
  );
  return rows;
}
async function addRelated({ client, brand, product_id, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "product_related")} (product_id, related_product_id, relation_type, score, source, display_order)
     VALUES ($1,$2,COALESCE($3,'related'),$4,COALESCE($5,'manual'),COALESCE($6,0)) RETURNING *`,
    [
      product_id,
      input.related_product_id,
      input.relation_type,
      input.score ?? null,
      input.source,
      input.display_order,
    ],
  );
  return rows[0];
}
async function removeRelated({ client, brand, product_id, pair_id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "product_related")} WHERE pair_id = $1 AND product_id = $2`,
    [pair_id, product_id],
  );
  return rowCount > 0;
}

module.exports = {
  listCollections,
  getCollection,
  createCollection,
  updateCollection,
  archiveCollection,
  listCollectionRules,
  addCollectionRule,
  removeCollectionRule,
  listCollectionMembers,
  addCollectionMember,
  removeCollectionMember,
  listImages,
  addImage,
  listColourImages,
  removeColourImage,
  updateImage,
  removeImage,
  listVideos,
  addVideo,
  removeVideo,
  listReadyVideoAssets,
  getMediaAsset,
  getSeo,
  upsertSeo,
  listAttributeValues,
  upsertAttributeValue,
  removeAttributeValue,
  listRelated,
  addRelated,
  removeRelated,
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  archiveCategory,
  findAllProducts,
  findProductById,
  findProductByName,
  productSlugTaken,
  productCodeTaken,
  createProduct,
  updateProduct,
  softDeleteProduct,
  listTrashedProducts,
  getTrashedProductById,
  restoreProduct,
  listVariants,
  getVariant,
  getDefaultVariant,
  createVariant,
  updateVariant,
  deactivateVariant,
  findCategoryByName,
  categorySlugTaken,
};
