/**
 * Storefront Studio (V2.2 §6.28) — repository.
 *
 * Themes / pages / navigation live in SHARED tables keyed by `business`, each
 * with at most one published and one draft row per brand (partial unique
 * indexes). Publishing snapshots to storefront_revisions via a DB trigger.
 * Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (c) => (c ? c.query.bind(c) : query);

// ── Themes (singleton per brand) ───────────────────────────
async function getThemes({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.storefront_themes
      WHERE business = $1 AND status IN ('draft','published')
      ORDER BY status`,
    [brand],
  );
  return rows;
}

async function getThemeDraft({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.storefront_themes
      WHERE business = $1 AND status = 'draft'`,
    [brand],
  );
  return rows[0] || null;
}

async function insertThemeDraft({ client, brand, tokens, created_by }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.storefront_themes (business, status, tokens, created_by)
     VALUES ($1, 'draft', $2, $3) RETURNING *`,
    [brand, tokens || {}, created_by || null],
  );
  return rows[0];
}

async function updateThemeDraft({ client, brand, tokens }) {
  const { rows } = await ex(client)(
    `UPDATE shared.storefront_themes SET tokens = $2, updated_at = now()
      WHERE business = $1 AND status = 'draft' RETURNING *`,
    [brand, tokens || {}],
  );
  return rows[0] || null;
}

// ── Navigation (singleton per brand) ───────────────────────
async function getNavigation({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.storefront_navigation
      WHERE business = $1 AND status IN ('draft','published') ORDER BY status`,
    [brand],
  );
  return rows;
}

async function getNavDraft({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.storefront_navigation
      WHERE business = $1 AND status = 'draft'`,
    [brand],
  );
  return rows[0] || null;
}

async function insertNavDraft({ client, brand, nav, created_by }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.storefront_navigation
       (business, status, header_items, footer_columns, socials, created_by)
     VALUES ($1, 'draft', $2, $3, $4, $5) RETURNING *`,
    [
      brand,
      nav.header_items || [],
      nav.footer_columns || [],
      nav.socials || {},
      created_by || null,
    ],
  );
  return rows[0];
}

async function updateNavDraft({ client, brand, nav }) {
  const { rows } = await ex(client)(
    `UPDATE shared.storefront_navigation
        SET header_items = $2, footer_columns = $3, socials = $4, updated_at = now()
      WHERE business = $1 AND status = 'draft' RETURNING *`,
    [
      brand,
      nav.header_items || [],
      nav.footer_columns || [],
      nav.socials || {},
    ],
  );
  return rows[0] || null;
}

// ── Pages (keyed by page_key) ──────────────────────────────
async function listPages({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.storefront_pages
      WHERE business = $1 AND status IN ('draft','published')
      ORDER BY page_key, status`,
    [brand],
  );
  return rows;
}

async function getPageDraft({ client, brand, page_key }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.storefront_pages
      WHERE business = $1 AND page_key = $2 AND status = 'draft'`,
    [brand, page_key],
  );
  return rows[0] || null;
}

async function insertPageDraft({ client, brand, page, created_by }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.storefront_pages
       (business, page_key, template_key, status, url_path, meta_title,
        meta_description, og_image_url, slots, created_by)
     VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      brand,
      page.page_key,
      page.template_key,
      page.url_path,
      page.meta_title || null,
      page.meta_description || null,
      page.og_image_url || null,
      page.slots || {},
      created_by || null,
    ],
  );
  return rows[0];
}

async function updatePageDraft({ client, brand, page_key, page }) {
  const { rows } = await ex(client)(
    `UPDATE shared.storefront_pages
        SET template_key = COALESCE($3, template_key),
            url_path     = COALESCE($4, url_path),
            meta_title   = $5, meta_description = $6, og_image_url = $7,
            slots        = $8, updated_at = now()
      WHERE business = $1 AND page_key = $2 AND status = 'draft' RETURNING *`,
    [
      brand,
      page_key,
      page.template_key || null,
      page.url_path || null,
      page.meta_title || null,
      page.meta_description || null,
      page.og_image_url || null,
      page.slots || {},
    ],
  );
  return rows[0] || null;
}

// ── Publish (generic): archive current published, promote draft ────
async function publish({ client, entity, brand, page_key, published_by }) {
  const table =
    entity === "theme"
      ? "shared.storefront_themes"
      : entity === "navigation"
        ? "shared.storefront_navigation"
        : "shared.storefront_pages";
  const keyClause = entity === "page" ? "AND page_key = $2" : "";
  const params = entity === "page" ? [brand, page_key] : [brand];

  await ex(client)(
    `UPDATE ${table} SET status = 'archived'
      WHERE business = $1 ${keyClause} AND status = 'published'`,
    params,
  );
  const pubByIdx = params.length + 1;
  const { rows } = await ex(client)(
    `UPDATE ${table}
        SET status = 'published', published_at = now(), published_by = $${pubByIdx}
      WHERE business = $1 ${keyClause} AND status = 'draft'
      RETURNING *`,
    [...params, published_by || null],
  );
  return rows[0] || null;
}

module.exports = {
  getThemes,
  getThemeDraft,
  insertThemeDraft,
  updateThemeDraft,
  getNavigation,
  getNavDraft,
  insertNavDraft,
  updateNavDraft,
  listPages,
  getPageDraft,
  insertPageDraft,
  updatePageDraft,
  publish,
};
