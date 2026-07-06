"use strict";

const { query } = require("../../config/database");

// ── Public (read) ────────────────────────────────────────

async function listCategories({ active_only = true } = {}) {
  const where = active_only ? "WHERE is_active = true" : "";
  const { rows } = await query(
    `SELECT * FROM shared.help_categories ${where}
      ORDER BY sort_order ASC, name ASC`,
  );
  return rows;
}

async function listArticles({
  category_slug,
  related_module,
  audience,
  q,
  limit = 100,
}) {
  const where = ["a.is_active = true"];
  const params = [];
  let i = 1;
  if (category_slug) {
    where.push(`c.slug = $${i++}`);
    params.push(category_slug);
  }
  if (related_module) {
    where.push(`a.related_module = $${i++}`);
    params.push(related_module);
  }
  if (audience && audience !== "all") {
    where.push(`(a.audience = $${i} OR a.audience = 'all')`);
    params.push(audience);
    i++;
  }
  if (q) {
    where.push(
      `(a.title ILIKE $${i} OR a.summary ILIKE $${i} OR a.body_markdown ILIKE $${i})`,
    );
    params.push(`%${q}%`);
    i++;
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT a.article_id, a.slug, a.title, a.summary, a.audience,
            a.related_module, a.tags, a.sort_order, a.view_count,
            a.updated_at, c.slug AS category_slug, c.name AS category_name,
            c.icon AS category_icon
       FROM shared.help_articles a
       LEFT JOIN shared.help_categories c ON c.category_id = a.category_id
      WHERE ${where.join(" AND ")}
      ORDER BY c.sort_order ASC NULLS LAST, a.sort_order ASC, a.title ASC
      LIMIT $${i}`,
    params,
  );
  return rows;
}

async function getArticleBySlug({ slug }) {
  const { rows } = await query(
    `SELECT a.*, c.slug AS category_slug, c.name AS category_name,
            c.icon AS category_icon
       FROM shared.help_articles a
       LEFT JOIN shared.help_categories c ON c.category_id = a.category_id
      WHERE a.slug = $1 AND a.is_active = true`,
    [slug],
  );
  return rows[0] || null;
}

async function incrementView({ slug }) {
  await query(
    `UPDATE shared.help_articles
        SET view_count = view_count + 1
      WHERE slug = $1`,
    [slug],
  );
}

// ── Admin (edit) ─────────────────────────────────────────
// These power the in-app Help Editor. Unlike the read paths they can see
// inactive (retired / draft) rows.

async function listArticlesAdmin({ category_slug, related_module, q } = {}) {
  const where = [];
  const params = [];
  let i = 1;
  if (category_slug) {
    where.push(`c.slug = $${i++}`);
    params.push(category_slug);
  }
  if (related_module) {
    where.push(`a.related_module = $${i++}`);
    params.push(related_module);
  }
  if (q) {
    where.push(`(a.title ILIKE $${i} OR a.summary ILIKE $${i})`);
    params.push(`%${q}%`);
    i++;
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT a.article_id, a.slug, a.title, a.summary, a.audience,
            a.related_module, a.tags, a.sort_order, a.view_count,
            a.praxis_indexed, a.is_active, a.updated_at,
            c.slug AS category_slug, c.name AS category_name
       FROM shared.help_articles a
       LEFT JOIN shared.help_categories c ON c.category_id = a.category_id
      ${clause}
      ORDER BY c.sort_order ASC NULLS LAST, a.sort_order ASC, a.title ASC`,
    params,
  );
  return rows;
}

async function getArticleById({ id }) {
  const { rows } = await query(
    `SELECT a.*, c.slug AS category_slug, c.name AS category_name,
            c.icon AS category_icon
       FROM shared.help_articles a
       LEFT JOIN shared.help_categories c ON c.category_id = a.category_id
      WHERE a.article_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function getCategoryIdBySlug({ slug }) {
  const { rows } = await query(
    `SELECT category_id FROM shared.help_categories WHERE slug = $1`,
    [slug],
  );
  return rows[0]?.category_id || null;
}

async function createArticle({
  category_id,
  slug,
  title,
  summary = null,
  body_markdown,
  audience = "all",
  related_module = null,
  tags = [],
  sort_order = 0,
  praxis_indexed = true,
  is_active = true,
  actorId = null,
}) {
  const { rows } = await query(
    `INSERT INTO shared.help_articles
       (category_id, slug, title, summary, body_markdown, audience,
        related_module, tags, sort_order, praxis_indexed, is_active,
        last_updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      category_id,
      slug,
      title,
      summary,
      body_markdown,
      audience,
      related_module,
      tags,
      sort_order,
      praxis_indexed,
      is_active,
      actorId,
    ],
  );
  return rows[0];
}

// Whitelisted, dynamic partial update.
const ARTICLE_UPDATABLE = [
  "category_id",
  "title",
  "summary",
  "body_markdown",
  "audience",
  "related_module",
  "tags",
  "sort_order",
  "praxis_indexed",
  "is_active",
];

async function updateArticle({ id, patch, actorId = null }) {
  const sets = [];
  const params = [];
  let i = 1;
  for (const key of ARTICLE_UPDATABLE) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = $${i++}`);
      params.push(patch[key]);
    }
  }
  sets.push(`last_updated_by = $${i++}`);
  params.push(actorId);
  params.push(id);
  const { rows } = await query(
    `UPDATE shared.help_articles
        SET ${sets.join(", ")}
      WHERE article_id = $${i}
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function setArticleActive({ id, is_active, actorId = null }) {
  const { rows } = await query(
    `UPDATE shared.help_articles
        SET is_active = $1, last_updated_by = $2
      WHERE article_id = $3
      RETURNING *`,
    [is_active, actorId, id],
  );
  return rows[0] || null;
}

async function listCategoriesAll() {
  const { rows } = await query(
    `SELECT * FROM shared.help_categories ORDER BY sort_order ASC, name ASC`,
  );
  return rows;
}

async function createCategory({
  slug,
  name,
  description = null,
  icon = null,
  sort_order = 0,
  is_active = true,
}) {
  const { rows } = await query(
    `INSERT INTO shared.help_categories
       (slug, name, description, icon, sort_order, is_active)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [slug, name, description, icon, sort_order, is_active],
  );
  return rows[0];
}

const CATEGORY_UPDATABLE = [
  "name",
  "description",
  "icon",
  "sort_order",
  "is_active",
];

async function updateCategory({ id, patch }) {
  const sets = [];
  const params = [];
  let i = 1;
  for (const key of CATEGORY_UPDATABLE) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = $${i++}`);
      params.push(patch[key]);
    }
  }
  if (!sets.length) return getCategoryById(id);
  params.push(id);
  const { rows } = await query(
    `UPDATE shared.help_categories
        SET ${sets.join(", ")}
      WHERE category_id = $${i}
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function getCategoryById(id) {
  const { rows } = await query(
    `SELECT * FROM shared.help_categories WHERE category_id = $1`,
    [id],
  );
  return rows[0] || null;
}

// ── Praxis knowledge sync ────────────────────────────────
// Keep shared.ai_knowledge_chunks in step with an article, live. Mirrors
// the seed logic in migration 000214/000274: source_type='custom',
// source_ref='help_article:<slug>', sensitivity='public'. There is no
// unique constraint on source_ref, so we delete-then-insert (an upsert).
// A retired (is_active=false) or de-indexed (praxis_indexed=false) article
// leaves no chunk, so Praxis stops citing it the moment it's retired.

async function resyncArticleChunk({ article, actorId = null }) {
  await query(
    `DELETE FROM shared.ai_knowledge_chunks
      WHERE source_type = 'custom' AND source_ref = $1`,
    [`help_article:${article.slug}`],
  );
  if (!article.is_active || !article.praxis_indexed) return;
  await query(
    `INSERT INTO shared.ai_knowledge_chunks
       (source_type, source_ref, business, title, content, token_count,
        sensitivity, content_hash, metadata, ingested_by)
     VALUES ('custom', $1, NULL, $2, $3,
             GREATEST(1, LENGTH($3) / 4), 'public', md5($3), $4, $5)`,
    [
      `help_article:${article.slug}`,
      article.title,
      article.body_markdown,
      JSON.stringify({
        article_id: article.article_id,
        slug: article.slug,
        audience: article.audience,
        related_module: article.related_module,
        tags: article.tags,
      }),
      actorId,
    ],
  );
}

module.exports = {
  listCategories,
  listArticles,
  getArticleBySlug,
  incrementView,
  // admin
  listArticlesAdmin,
  getArticleById,
  getCategoryIdBySlug,
  createArticle,
  updateArticle,
  setArticleActive,
  listCategoriesAll,
  createCategory,
  updateCategory,
  getCategoryById,
  resyncArticleChunk,
};
