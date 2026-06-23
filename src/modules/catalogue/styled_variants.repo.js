/**
 * Styled colour × size variants, the brand-wide size-tier ladder, and the
 * catalogue config (head-size guide) — repository. Parameterised SQL only.
 *
 * Pricing model (owner directive): a styled product carries its OWN retail
 * price (`styled_products.retail_price_ngn`, the size-S anchor). The sellable
 * price of a colour×size variant is:
 *   COALESCE(price_override_ngn, anchor + colour.premium_ngn + size.premium_ngn)
 * Base products keep their separate WHOLESALE price; styled retail is never
 * "base + add-on".
 */

"use strict";

const { query } = require("../../config/database");
const { VALID } = require("../../config/brands");

const t = (b, tbl) => {
  if (!VALID.has(b)) throw new Error(`Invalid brand: ${b}`);
  return `${b}.${tbl}`;
};
const ex = (c) => (c ? c.query.bind(c) : query);

function setClause(cols, src, start = 1) {
  const f = [];
  const p = [];
  let i = start;
  for (const c of cols) {
    if (src[c] === undefined) continue;
    f.push(`${c} = $${i}`);
    p.push(src[c]);
    i++;
  }
  return { f, p, next: i };
}

// ── Size tiers (brand-wide ladder) ───────────────────────
const TIER_COLS = [
  "label",
  "premium_ngn",
  "premium_usd",
  "circumference_min_in",
  "circumference_max_in",
  "circumference_min_cm",
  "circumference_max_cm",
  "guidance_text",
  "display_order",
  "is_active",
];

async function listSizeTiers({ client, brand, activeOnly = false }) {
  const where = activeOnly ? "WHERE is_active = true" : "";
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "styled_size_tiers")} ${where} ORDER BY display_order, size_code`,
  );
  return rows;
}

async function getSizeTier({ client, brand, size_code }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "styled_size_tiers")} WHERE size_code = $1`,
    [size_code],
  );
  return rows[0] || null;
}

/** Insert a new size tier (used when the owner adds a size beyond S/M/L/XL). */
async function createSizeTier({ client, brand, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "styled_size_tiers")}
       (size_code, label, premium_ngn, premium_usd, circumference_min_in, circumference_max_in,
        circumference_min_cm, circumference_max_cm, guidance_text, display_order, is_active)
     VALUES ($1,$2,COALESCE($3,0),$4,$5,$6,$7,$8,$9,COALESCE($10,0),COALESCE($11,true))
     RETURNING *`,
    [
      input.size_code,
      input.label,
      input.premium_ngn,
      input.premium_usd ?? null,
      input.circumference_min_in ?? null,
      input.circumference_max_in ?? null,
      input.circumference_min_cm ?? null,
      input.circumference_max_cm ?? null,
      input.guidance_text ?? null,
      input.display_order,
      input.is_active,
    ],
  );
  return rows[0];
}

async function updateSizeTier({ client, brand, size_code, patch }) {
  const { f, p, next } = setClause(TIER_COLS, patch);
  if (!f.length) return getSizeTier({ client, brand, size_code });
  p.push(size_code);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "styled_size_tiers")} SET ${f.join(",")}
      WHERE size_code = $${next} RETURNING *`,
    p,
  );
  return rows[0] || null;
}

// ── Lace-size ladder (brand-wide, third variant axis) ────
const LACE_COLS = [
  "label",
  "premium_ngn",
  "premium_usd",
  "description",
  "display_order",
  "is_active",
];

async function listLaceSizes({ client, brand, activeOnly = false }) {
  const where = activeOnly ? "WHERE is_active = true" : "";
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "styled_lace_sizes")} ${where} ORDER BY display_order, lace_code`,
  );
  return rows;
}

async function getLaceSize({ client, brand, lace_code }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "styled_lace_sizes")} WHERE lace_code = $1`,
    [lace_code],
  );
  return rows[0] || null;
}

async function createLaceSize({ client, brand, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "styled_lace_sizes")}
       (lace_code, label, premium_ngn, premium_usd, description, display_order, is_active)
     VALUES ($1,$2,COALESCE($3,0),$4,$5,COALESCE($6,0),COALESCE($7,true))
     RETURNING *`,
    [
      input.lace_code,
      input.label,
      input.premium_ngn,
      input.premium_usd ?? null,
      input.description ?? null,
      input.display_order,
      input.is_active,
    ],
  );
  return rows[0];
}

async function updateLaceSize({ client, brand, lace_code, patch }) {
  const { f, p, next } = setClause(LACE_COLS, patch);
  if (!f.length) return getLaceSize({ client, brand, lace_code });
  p.push(lace_code);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "styled_lace_sizes")} SET ${f.join(",")}
      WHERE lace_code = $${next} RETURNING *`,
    p,
  );
  return rows[0] || null;
}

// ── Catalogue config (singleton) ─────────────────────────
async function getConfig({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "catalogue_config")} WHERE singleton = true`,
  );
  return rows[0] || null;
}

async function upsertConfig({ client, brand, patch, user_id }) {
  // head_size_video_url uses an explicit "is this key present in the patch"
  // flag so a deliberate NULL (the user clearing the URL) is honoured rather
  // than coalesced back to the existing value. The other text fields share
  // the same COALESCE pattern for backwards compatibility.
  const videoProvided = Object.prototype.hasOwnProperty.call(
    patch,
    "head_size_video_url",
  );
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "catalogue_config")}
       (singleton, size_guide_title, head_size_guide_md, head_size_video_url,
        categories_enabled, allow_base_in_collections_bundles, updated_by)
     VALUES (true, COALESCE($1,'How to find your head size'), $2, $6,
             COALESCE($3,false), COALESCE($5,false), $4)
     ON CONFLICT (singleton) DO UPDATE SET
       size_guide_title = COALESCE(EXCLUDED.size_guide_title, ${t(brand, "catalogue_config")}.size_guide_title),
       head_size_guide_md = COALESCE(EXCLUDED.head_size_guide_md, ${t(brand, "catalogue_config")}.head_size_guide_md),
       head_size_video_url = CASE WHEN $7::boolean THEN $6 ELSE ${t(brand, "catalogue_config")}.head_size_video_url END,
       categories_enabled = COALESCE($3, ${t(brand, "catalogue_config")}.categories_enabled),
       allow_base_in_collections_bundles = COALESCE($5, ${t(brand, "catalogue_config")}.allow_base_in_collections_bundles),
       updated_by = EXCLUDED.updated_by,
       updated_at = now()
     RETURNING *`,
    [
      patch.size_guide_title ?? null,
      patch.head_size_guide_md ?? null,
      patch.categories_enabled ?? null,
      user_id || null,
      patch.allow_base_in_collections_bundles ?? null,
      patch.head_size_video_url ?? null,
      videoProvided,
    ],
  );
  return rows[0];
}

/** The one-click flag: may base (stock-room) products join collections/bundles?
 *  Default false — only styled products may. Read by the collection + bundle
 *  services before accepting a base target. */
async function allowBaseTargets({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT allow_base_in_collections_bundles AS allow
       FROM ${t(brand, "catalogue_config")} WHERE singleton = true`,
  );
  return rows[0] ? rows[0].allow === true : false;
}

// ── Colours ──────────────────────────────────────────────
const COLOUR_COLS = [
  "name",
  "hex",
  "premium_ngn",
  "video_url",
  "external_video_url",
  "display_order",
  "is_default",
  "is_active",
];

async function listColours({ client, brand, styled_id }) {
  const { rows } = await ex(client)(
    `SELECT c.*,
            (SELECT COUNT(*)::int FROM ${t(brand, "product_images")} pi
              WHERE pi.styled_colour_id = c.colour_id) AS image_count
       FROM ${t(brand, "styled_product_colours")} c
      WHERE c.styled_id = $1 AND c.is_deleted = false
      ORDER BY c.display_order, c.name`,
    [styled_id],
  );
  return rows;
}

/** Soft-deleted colours of a styled product, with the date they purge for good
 *  (deleted_at + 15 days). Powers the per-product Trash list. */
async function listTrashedColours({ client, brand, styled_id }) {
  const { rows } = await ex(client)(
    `SELECT c.*, (c.deleted_at + INTERVAL '15 days') AS purge_at,
            (SELECT COUNT(*)::int FROM ${t(brand, "product_images")} pi
              WHERE pi.styled_colour_id = c.colour_id) AS image_count
       FROM ${t(brand, "styled_product_colours")} c
      WHERE c.styled_id = $1 AND c.is_deleted = true
      ORDER BY c.deleted_at DESC NULLS LAST`,
    [styled_id],
  );
  return rows;
}

async function getColour({ client, brand, styled_id, colour_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "styled_product_colours")}
      WHERE colour_id = $1 AND styled_id = $2`,
    [colour_id, styled_id],
  );
  return rows[0] || null;
}

async function createColour({ client, brand, styled_id, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "styled_product_colours")}
       (styled_id, name, hex, premium_ngn, video_url, external_video_url, display_order, is_default, is_active)
     VALUES ($1,$2,$3,COALESCE($4,0),$5,$6,COALESCE($7,0),COALESCE($8,false),COALESCE($9,true))
     RETURNING *`,
    [
      styled_id,
      input.name,
      input.hex ?? null,
      input.premium_ngn,
      input.video_url ?? null,
      input.external_video_url ?? null,
      input.display_order,
      input.is_default,
      input.is_active,
    ],
  );
  return rows[0];
}

async function updateColour({ client, brand, styled_id, colour_id, patch }) {
  const { f, p, next } = setClause(COLOUR_COLS, patch);
  if (!f.length) return getColour({ client, brand, styled_id, colour_id });
  p.push(colour_id, styled_id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "styled_product_colours")} SET ${f.join(",")}
      WHERE colour_id = $${next} AND styled_id = $${next + 1} RETURNING *`,
    p,
  );
  return rows[0] || null;
}

/** Clear is_default on every other colour of the styled product. */
async function clearDefaultColours({ client, brand, styled_id, except_id }) {
  await ex(client)(
    `UPDATE ${t(brand, "styled_product_colours")} SET is_default = false
      WHERE styled_id = $1 AND colour_id <> $2 AND is_default = true`,
    [styled_id, except_id],
  );
}

/** Soft-delete ONE colour (Trash). Drops its default flag so a live colour can
 *  take over; the partial-unique indexes free its name for re-use. Returns the
 *  trashed row (carrying deleted_at) so the caller can cascade its variants with
 *  the SAME timestamp. */
async function softDeleteColour({ client, brand, styled_id, colour_id, user_id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "styled_product_colours")}
        SET is_deleted = true, deleted_at = now(), deleted_by = $3,
            is_default = false
      WHERE colour_id = $1 AND styled_id = $2 AND is_deleted = false
      RETURNING *`,
    [colour_id, styled_id, user_id || null],
  );
  return rows[0] || null;
}

/** Soft-delete EVERY live colour of a styled product (whole-product Trash
 *  cascade). All rows share this transaction's now() so restore can match them. */
async function softDeleteColoursForStyled({ client, brand, styled_id, user_id }) {
  await ex(client)(
    `UPDATE ${t(brand, "styled_product_colours")}
        SET is_deleted = true, deleted_at = now(), deleted_by = $2,
            is_default = false
      WHERE styled_id = $1 AND is_deleted = false`,
    [styled_id, user_id || null],
  );
}

/** Is this colour name already used by a LIVE colour of the styled product?
 *  Guards restore against the partial-unique (styled_id, name) index. */
async function colourNameTaken({ client, brand, styled_id, name, except_id }) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "styled_product_colours")}
      WHERE styled_id = $1 AND lower(name) = lower($2) AND is_deleted = false
        AND colour_id <> $3 LIMIT 1`,
    [styled_id, name, except_id || "00000000-0000-0000-0000-000000000000"],
  );
  return rows.length > 0;
}

/** Restore a trashed colour (optionally under a new, collision-free name). */
async function restoreColour({ client, brand, styled_id, colour_id, name }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "styled_product_colours")}
        SET is_deleted = false, deleted_at = null, deleted_by = null,
            name = COALESCE($3, name)
      WHERE colour_id = $1 AND styled_id = $2 AND is_deleted = true
      RETURNING *`,
    [colour_id, styled_id, name || null],
  );
  return rows[0] || null;
}

async function getTrashedColour({ client, brand, styled_id, colour_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "styled_product_colours")}
      WHERE colour_id = $1 AND styled_id = $2 AND is_deleted = true`,
    [colour_id, styled_id],
  );
  return rows[0] || null;
}

/** Restore colours trashed AT THE SAME MOMENT as their parent styled product
 *  (matched by the shared deleted_at) — used by whole-product restore. Names
 *  can't collide: every colour of the product went down together, so none is
 *  live to clash with. */
async function restoreColoursDeletedAt({
  client,
  brand,
  styled_id,
  deleted_at,
}) {
  await ex(client)(
    `UPDATE ${t(brand, "styled_product_colours")}
        SET is_deleted = false, deleted_at = null, deleted_by = null
      WHERE styled_id = $1 AND is_deleted = true AND deleted_at = $2`,
    [styled_id, deleted_at],
  );
}

// ── Variants (colour × size × lace) ──────────────────────
const VARIANT_COLS = [
  "base_product_id",
  "price_override_ngn",
  "price_override_usd",
  "compare_at_price_ngn",
  "compare_at_price_usd",
  "is_active",
  "is_default",
  "display_order",
];

/** Variants with the computed effective price (anchor + colour/size/lace premiums). */
async function listVariants({ client, brand, styled_id }) {
  const { rows } = await ex(client)(
    `SELECT v.*,
            c.name AS colour_name, c.hex AS colour_hex, c.premium_ngn AS colour_premium_ngn,
            c.display_order AS colour_order, c.is_default AS colour_is_default,
            st.label AS size_label, st.premium_ngn AS size_premium_ngn,
            st.display_order AS size_order,
            ls.label AS lace_label, ls.premium_ngn AS lace_premium_ngn,
            ls.display_order AS lace_order,
            pr.name AS base_product_name,
            sp.retail_price_ngn AS anchor_price_ngn,
            COALESCE(v.price_override_ngn,
                     sp.retail_price_ngn + c.premium_ngn + st.premium_ngn
                       + COALESCE(ls.premium_ngn, 0)) AS effective_price_ngn
       FROM ${t(brand, "styled_product_variants")} v
       JOIN ${t(brand, "styled_product_colours")} c ON c.colour_id = v.colour_id
       JOIN ${t(brand, "styled_size_tiers")} st ON st.size_code = v.size_code
       LEFT JOIN ${t(brand, "styled_lace_sizes")} ls ON ls.lace_code = v.lace_code
       LEFT JOIN ${t(brand, "products")} pr ON pr.product_id = v.base_product_id
       JOIN ${t(brand, "styled_products")} sp ON sp.styled_id = v.styled_id
      WHERE v.styled_id = $1 AND v.is_deleted = false
      ORDER BY c.display_order, c.name, st.display_order, ls.display_order`,
    [styled_id],
  );
  return rows;
}

/** Soft-deleted variants of a styled product, with their purge date and the
 *  colour/size/lace labels needed to render the Trash list. */
async function listTrashedVariants({ client, brand, styled_id }) {
  const { rows } = await ex(client)(
    `SELECT v.*, (v.deleted_at + INTERVAL '15 days') AS purge_at,
            c.name AS colour_name, c.hex AS colour_hex,
            st.label AS size_label, ls.label AS lace_label
       FROM ${t(brand, "styled_product_variants")} v
       JOIN ${t(brand, "styled_product_colours")} c ON c.colour_id = v.colour_id
       LEFT JOIN ${t(brand, "styled_size_tiers")} st ON st.size_code = v.size_code
       LEFT JOIN ${t(brand, "styled_lace_sizes")} ls ON ls.lace_code = v.lace_code
      WHERE v.styled_id = $1 AND v.is_deleted = true
      ORDER BY v.deleted_at DESC NULLS LAST`,
    [styled_id],
  );
  return rows;
}

async function getVariant({ client, brand, styled_id, styled_variant_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "styled_product_variants")}
      WHERE styled_variant_id = $1 AND styled_id = $2`,
    [styled_variant_id, styled_id],
  );
  return rows[0] || null;
}

/** Existing (colour_id,size_code,lace_code) combos among LIVE variants — so bulk
 *  create skips dupes. A trashed combo is free to re-create (the partial-unique
 *  combo index spans live rows only). */
async function existingPairs({ client, brand, styled_id }) {
  const { rows } = await ex(client)(
    `SELECT colour_id, size_code, lace_code FROM ${t(brand, "styled_product_variants")}
      WHERE styled_id = $1 AND is_deleted = false`,
    [styled_id],
  );
  return rows;
}

async function createVariant({ client, brand, styled_id, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "styled_product_variants")}
       (styled_id, colour_id, size_code, lace_code, base_product_id, sku,
        price_override_ngn, price_override_usd, compare_at_price_ngn, compare_at_price_usd, is_active, is_default, display_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,true),COALESCE($12,false),COALESCE($13,0))
     RETURNING *`,
    [
      styled_id,
      input.colour_id,
      input.size_code,
      input.lace_code ?? null,
      input.base_product_id ?? null,
      input.sku,
      input.price_override_ngn ?? null,
      input.price_override_usd ?? null,
      input.compare_at_price_ngn ?? null,
      input.compare_at_price_usd ?? null,
      input.is_active,
      input.is_default,
      input.display_order,
    ],
  );
  return rows[0];
}

async function updateVariant({
  client,
  brand,
  styled_id,
  styled_variant_id,
  patch,
}) {
  const { f, p, next } = setClause(VARIANT_COLS, patch);
  if (!f.length)
    return getVariant({ client, brand, styled_id, styled_variant_id });
  p.push(styled_variant_id, styled_id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "styled_product_variants")} SET ${f.join(",")}
      WHERE styled_variant_id = $${next} AND styled_id = $${next + 1} RETURNING *`,
    p,
  );
  return rows[0] || null;
}

/** Soft-delete ONE variant (Trash). Drops its default flag so a live variant can
 *  take over (the default partial-unique spans live rows only). */
async function softDeleteVariant({
  client,
  brand,
  styled_id,
  styled_variant_id,
  user_id,
}) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "styled_product_variants")}
        SET is_deleted = true, deleted_at = now(), deleted_by = $3,
            is_default = false
      WHERE styled_variant_id = $1 AND styled_id = $2 AND is_deleted = false
      RETURNING *`,
    [styled_variant_id, styled_id, user_id || null],
  );
  return rows[0] || null;
}

/** Soft-delete every live variant of a COLOUR (colour-Trash cascade) — shares
 *  this transaction's now() with the colour for matched restore. */
async function softDeleteVariantsForColour({
  client,
  brand,
  styled_id,
  colour_id,
  user_id,
}) {
  await ex(client)(
    `UPDATE ${t(brand, "styled_product_variants")}
        SET is_deleted = true, deleted_at = now(), deleted_by = $3,
            is_default = false
      WHERE styled_id = $1 AND colour_id = $2 AND is_deleted = false`,
    [styled_id, colour_id, user_id || null],
  );
}

/** Soft-delete every live variant of a styled product (whole-product cascade). */
async function softDeleteVariantsForStyled({
  client,
  brand,
  styled_id,
  user_id,
}) {
  await ex(client)(
    `UPDATE ${t(brand, "styled_product_variants")}
        SET is_deleted = true, deleted_at = now(), deleted_by = $2,
            is_default = false
      WHERE styled_id = $1 AND is_deleted = false`,
    [styled_id, user_id || null],
  );
}

/** Is this (colour,size,lace) combo or sku already taken by a LIVE variant?
 *  Guards restore against the partial-unique combo + sku indexes. */
async function variantComboTaken({
  client,
  brand,
  styled_id,
  colour_id,
  size_code,
  lace_code,
  sku,
  except_id,
}) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "styled_product_variants")}
      WHERE styled_id = $1 AND is_deleted = false
        AND styled_variant_id <> $6
        AND ( (colour_id = $2 AND size_code = $3
               AND COALESCE(lace_code,'') = COALESCE($4,''))
              OR sku = $5 )
      LIMIT 1`,
    [
      styled_id,
      colour_id,
      size_code,
      lace_code || null,
      sku,
      except_id || "00000000-0000-0000-0000-000000000000",
    ],
  );
  return rows.length > 0;
}

async function getTrashedVariant({ client, brand, styled_id, styled_variant_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "styled_product_variants")}
      WHERE styled_variant_id = $1 AND styled_id = $2 AND is_deleted = true`,
    [styled_variant_id, styled_id],
  );
  return rows[0] || null;
}

/** Restore ONE trashed variant. */
async function restoreVariant({ client, brand, styled_id, styled_variant_id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "styled_product_variants")}
        SET is_deleted = false, deleted_at = null, deleted_by = null
      WHERE styled_variant_id = $1 AND styled_id = $2 AND is_deleted = true
      RETURNING *`,
    [styled_variant_id, styled_id],
  );
  return rows[0] || null;
}

/** Restore variants trashed AT THE SAME MOMENT as their parent (colour or whole
 *  product) — matched by the shared deleted_at — so a parent restore brings back
 *  exactly the children that went down with it, not ones trashed separately. */
async function restoreVariantsDeletedAt({
  client,
  brand,
  styled_id,
  deleted_at,
  colour_id,
}) {
  const params = [styled_id, deleted_at];
  let extra = "";
  if (colour_id) {
    params.push(colour_id);
    extra = ` AND colour_id = $3`;
  }
  await ex(client)(
    `UPDATE ${t(brand, "styled_product_variants")}
        SET is_deleted = false, deleted_at = null, deleted_by = null
      WHERE styled_id = $1 AND is_deleted = true AND deleted_at = $2${extra}`,
    params,
  );
}

module.exports = {
  listSizeTiers,
  getSizeTier,
  createSizeTier,
  updateSizeTier,
  listLaceSizes,
  getLaceSize,
  createLaceSize,
  updateLaceSize,
  getConfig,
  upsertConfig,
  allowBaseTargets,
  listColours,
  listTrashedColours,
  getColour,
  createColour,
  updateColour,
  clearDefaultColours,
  softDeleteColour,
  softDeleteColoursForStyled,
  colourNameTaken,
  restoreColour,
  restoreColoursDeletedAt,
  getTrashedColour,
  listVariants,
  listTrashedVariants,
  getVariant,
  existingPairs,
  createVariant,
  updateVariant,
  softDeleteVariant,
  softDeleteVariantsForColour,
  softDeleteVariantsForStyled,
  variantComboTaken,
  getTrashedVariant,
  restoreVariant,
  restoreVariantsDeletedAt,
};
