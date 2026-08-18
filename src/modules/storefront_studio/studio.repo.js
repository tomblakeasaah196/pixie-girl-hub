/**
 * Storefront Studio (V2.2 §6.28) — repository.
 *
 * Themes / pages / navigation live in SHARED tables keyed by `business`, each
 * with at most one published and one draft row per brand (partial unique
 * indexes). Publishing snapshots to storefront_revisions via a DB trigger.
 * Parameterised SQL only.
 */

"use strict";

const { ex } = require("../../config/database");
const { t } = require("../../config/brands");
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

// header_items / footer_columns / socials are JSONB. node-pg encodes a raw JS
// ARRAY as a Postgres array literal ({...}), which a JSONB column rejects — so
// these MUST be JSON.stringify'd (an object like socials would auto-stringify,
// but we stringify all three for one clear, correct rule). Passing arrays raw
// is exactly why Navigation could never save or publish.
async function insertNavDraft({ client, brand, nav, created_by }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.storefront_navigation
       (business, status, header_items, footer_columns, socials, created_by)
     VALUES ($1, 'draft', $2, $3, $4, $5) RETURNING *`,
    [
      brand,
      JSON.stringify(nav.header_items || []),
      JSON.stringify(nav.footer_columns || []),
      JSON.stringify(nav.socials || {}),
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
      JSON.stringify(nav.header_items || []),
      JSON.stringify(nav.footer_columns || []),
      JSON.stringify(nav.socials || {}),
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
  // page_key carries the per-row key for entities that have one (page_key for
  // pages, popup_key for popups). Singleton entities (theme/navigation) ignore it.
  const table = {
    theme: "shared.storefront_themes",
    navigation: "shared.storefront_navigation",
    page: "shared.storefront_pages",
    popup: "shared.storefront_popups",
  }[entity];
  const keyCol =
    entity === "page" ? "page_key" : entity === "popup" ? "popup_key" : null;
  const keyClause = keyCol ? `AND ${keyCol} = $2` : "";
  const params = keyCol ? [brand, page_key] : [brand];

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

// ── Popups (keyed by popup_key, draft/published like pages) ────────
async function listPopups({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.storefront_popups
      WHERE business = $1 AND status IN ('draft','published')
      ORDER BY popup_key, status`,
    [brand],
  );
  return rows;
}

async function getPopupDraft({ client, brand, popup_key }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.storefront_popups
      WHERE business = $1 AND popup_key = $2 AND status = 'draft'`,
    [brand, popup_key],
  );
  return rows[0] || null;
}

async function insertPopupDraft({ client, brand, popup, created_by }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.storefront_popups
       (business, status, popup_key, trigger_type, trigger_value, audience,
        content, display_rules, display_order, is_active, created_by)
     VALUES ($1, 'draft', $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      brand,
      popup.popup_key,
      popup.trigger_type,
      popup.trigger_value ?? null,
      popup.audience || "all",
      popup.content || {},
      popup.display_rules || {},
      popup.display_order ?? 0,
      popup.is_active ?? true,
      created_by || null,
    ],
  );
  return rows[0];
}

async function updatePopupDraft({ client, brand, popup_key, popup }) {
  const { rows } = await ex(client)(
    `UPDATE shared.storefront_popups
        SET trigger_type = COALESCE($3, trigger_type),
            trigger_value = $4,
            audience = COALESCE($5, audience),
            content = $6, display_rules = $7,
            display_order = COALESCE($8, display_order),
            is_active = COALESCE($9, is_active),
            updated_at = now()
      WHERE business = $1 AND popup_key = $2 AND status = 'draft' RETURNING *`,
    [
      brand,
      popup_key,
      popup.trigger_type || null,
      popup.trigger_value ?? null,
      popup.audience || null,
      popup.content || {},
      popup.display_rules || {},
      popup.display_order ?? null,
      popup.is_active ?? null,
    ],
  );
  return rows[0] || null;
}

// Take a live popup off the website WITHOUT touching its draft: archive the
// published row so getPublishedSite() stops returning it. The draft/publish
// model has no other way back — `publish` only ever promotes a draft, so an
// operator who wanted a live popup gone had to delete it outright (losing the
// content) or publish a deactivated draft. Returns null when nothing was live.
async function unpublishPopup({ client, brand, popup_key }) {
  const { rows } = await ex(client)(
    `UPDATE shared.storefront_popups SET status = 'archived'
      WHERE business = $1 AND popup_key = $2 AND status = 'published'
      RETURNING *`,
    [brand, popup_key],
  );
  return rows[0] || null;
}

async function deletePopup({ client, brand, popup_key }) {
  await ex(client)(
    `DELETE FROM shared.storefront_popups WHERE business = $1 AND popup_key = $2`,
    [brand, popup_key],
  );
}

// ── Section templates (global library for the page composer) ───────
async function listSectionTemplates({ client }) {
  const { rows } = await ex(client)(
    `SELECT template_key, category, display_name, description,
            preview_image_url, default_slots, display_order
       FROM shared.storefront_section_templates
      WHERE is_active = true
      ORDER BY category, display_order`,
  );
  return rows;
}

// Brand storefront domain (for building the preview URL).
async function getStorefrontDomain({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT storefront_domain FROM shared.business_config WHERE business_key = $1`,
    [brand],
  );
  return rows[0] ? rows[0].storefront_domain : null;
}

// ── Revisions (append-only publish history; written by a DB trigger) ──
async function listRevisions({ client, brand, limit = 50 }) {
  const { rows } = await ex(client)(
    `SELECT revision_id, entity_type, entity_id, published_by, published_at,
            change_summary
       FROM shared.storefront_revisions
      WHERE business = $1
      ORDER BY published_at DESC
      LIMIT $2`,
    [brand, limit],
  );
  return rows;
}

async function getRevision({ client, brand, revision_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.storefront_revisions
      WHERE business = $1 AND revision_id = $2`,
    [brand, revision_id],
  );
  return rows[0] || null;
}

// ── Content posts (per-brand table) ────────────────────────
// Unlike theme/nav/pages (one draft + one published row in SHARED tables),
// a content post is a SINGLE row in the brand schema with its own `status`
// lifecycle column — so "publish" just flips status, no row duplication.

const CONTENT_COLS = `post_id, post_type, slug, title, excerpt, body,
  hero_image_url, hero_image_alt, faq_category, faq_question, tags,
  content_blocks, meta_title, meta_description, status, published_at,
  is_featured, display_order, reading_time_minutes, author_display_name,
  created_at, updated_at`;

// Admin list: all statuses (the operator manages drafts too). Optional type
// filter drives the CMS "kind" tabs.
async function listContentPosts({ client, brand, type }) {
  const params = [];
  let where = "TRUE";
  if (type) {
    params.push(type);
    where += ` AND post_type = $${params.length}`;
  }
  const { rows } = await ex(client)(
    `SELECT ${CONTENT_COLS} FROM ${t(brand, "storefront_content_posts")}
      WHERE ${where}
      ORDER BY post_type, display_order, updated_at DESC`,
    params,
  );
  return rows;
}

async function getContentPostById({ client, brand, post_id }) {
  const { rows } = await ex(client)(
    `SELECT ${CONTENT_COLS} FROM ${t(brand, "storefront_content_posts")}
      WHERE post_id = $1`,
    [post_id],
  );
  return rows[0] || null;
}

async function slugExists({ client, brand, slug, exclude_id }) {
  const params = [slug];
  let sql = `SELECT 1 FROM ${t(brand, "storefront_content_posts")} WHERE slug = $1`;
  if (exclude_id) {
    params.push(exclude_id);
    sql += ` AND post_id <> $${params.length}`;
  }
  const { rows } = await ex(client)(`${sql} LIMIT 1`, params);
  return rows.length > 0;
}

async function insertContentPost({ client, brand, post }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "storefront_content_posts")}
       (post_type, slug, title, excerpt, body, hero_image_url, hero_image_alt,
        faq_category, faq_question, tags, content_blocks, meta_title,
        meta_description, status, published_at, is_featured, display_order,
        reading_time_minutes, author_user_id, author_display_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING ${CONTENT_COLS}`,
    [
      post.post_type,
      post.slug,
      post.title,
      post.excerpt,
      post.body,
      post.hero_image_url,
      post.hero_image_alt,
      post.faq_category,
      post.faq_question,
      post.tags || [],
      JSON.stringify(post.content_blocks || []),
      post.meta_title,
      post.meta_description,
      post.status,
      post.published_at,
      post.is_featured,
      post.display_order,
      post.reading_time_minutes,
      post.author_user_id,
      post.author_display_name,
    ],
  );
  return rows[0];
}

async function updateContentPost({ client, brand, post_id, post }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "storefront_content_posts")} SET
       post_type = $2, slug = $3, title = $4, excerpt = $5, body = $6,
       hero_image_url = $7, hero_image_alt = $8, faq_category = $9,
       faq_question = $10, tags = $11, content_blocks = $12, meta_title = $13,
       meta_description = $14, status = $15, published_at = $16,
       is_featured = $17, display_order = $18, reading_time_minutes = $19,
       updated_at = now()
      WHERE post_id = $1
      RETURNING ${CONTENT_COLS}`,
    [
      post_id,
      post.post_type,
      post.slug,
      post.title,
      post.excerpt,
      post.body,
      post.hero_image_url,
      post.hero_image_alt,
      post.faq_category,
      post.faq_question,
      post.tags || [],
      JSON.stringify(post.content_blocks || []),
      post.meta_title,
      post.meta_description,
      post.status,
      post.published_at,
      post.is_featured,
      post.display_order,
      post.reading_time_minutes,
    ],
  );
  return rows[0] || null;
}

// Flip only the lifecycle fields (publish / unpublish), leaving copy intact.
async function setContentStatus({ client, brand, post_id, status, published_at }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "storefront_content_posts")}
        SET status = $2, published_at = $3, updated_at = now()
      WHERE post_id = $1
      RETURNING ${CONTENT_COLS}`,
    [post_id, status, published_at],
  );
  return rows[0] || null;
}

async function deleteContentPost({ client, brand, post_id }) {
  await ex(client)(
    `DELETE FROM ${t(brand, "storefront_content_posts")} WHERE post_id = $1`,
    [post_id],
  );
  return { deleted: true };
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
  listPopups,
  getPopupDraft,
  insertPopupDraft,
  updatePopupDraft,
  unpublishPopup,
  deletePopup,
  listSectionTemplates,
  getStorefrontDomain,
  listRevisions,
  getRevision,
  publish,
  listContentPosts,
  getContentPostById,
  slugExists,
  insertContentPost,
  updateContentPost,
  setContentStatus,
  deleteContentPost,
};
