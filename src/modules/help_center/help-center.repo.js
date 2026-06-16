"use strict";

const { query } = require("../../config/database");

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

module.exports = {
  listCategories,
  listArticles,
  getArticleBySlug,
  incrementView,
};
