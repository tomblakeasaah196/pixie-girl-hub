"use strict";

const repo = require("./help-center.repo");
const { NotFoundError, ValidationError } = require("../../utils/errors");
const { audit } = require("../../middleware/audit");

// ── Public (read) ────────────────────────────────────────

function listCategories() {
  return repo.listCategories({ active_only: true });
}

function listArticles({ category_slug, related_module, audience, q, limit }) {
  return repo.listArticles({
    category_slug,
    related_module,
    audience,
    q,
    limit,
  });
}

async function getArticle({ slug }) {
  const a = await repo.getArticleBySlug({ slug });
  if (!a) throw new NotFoundError("Article");
  // Fire-and-forget view-count increment; tolerable if it fails.
  repo.incrementView({ slug }).catch(() => {});
  return a;
}

// ── Admin (edit) ─────────────────────────────────────────

function listArticlesAdmin({ category_slug, related_module, q } = {}) {
  return repo.listArticlesAdmin({ category_slug, related_module, q });
}

function listCategoriesAdmin() {
  return repo.listCategoriesAll();
}

async function getArticleForEdit({ id }) {
  const a = await repo.getArticleById({ id });
  if (!a) throw new NotFoundError("Article");
  return a;
}

async function resolveCategoryId(category_slug) {
  const id = await repo.getCategoryIdBySlug({ slug: category_slug });
  if (!id) throw new ValidationError(`Unknown help category "${category_slug}"`);
  return id;
}

function auditCtx(actor, extra) {
  return {
    business: actor?.brand || "system",
    user_id: actor?.user?.user_id || null,
    request_id: actor?.request_id || null,
    ...extra,
  };
}

async function createArticle({ input, ...actor }) {
  const category_id = await resolveCategoryId(input.category_slug);
  const article = await repo.createArticle({
    ...input,
    category_id,
    actorId: actor?.user?.user_id || null,
  });
  // Keep Praxis in step immediately.
  await repo.resyncArticleChunk({
    article,
    actorId: actor?.user?.user_id || null,
  });
  audit(
    auditCtx(actor, {
      action_key: "help_center.article.create",
      target_type: "help_article",
      target_id: article.article_id,
      after: { slug: article.slug, title: article.title },
    }),
  );
  return article;
}

async function updateArticle({ id, patch, ...actor }) {
  const existing = await repo.getArticleById({ id });
  if (!existing) throw new NotFoundError("Article");
  const toApply = { ...patch };
  if (patch.category_slug !== undefined) {
    toApply.category_id = await resolveCategoryId(patch.category_slug);
    delete toApply.category_slug;
  }
  const article = await repo.updateArticle({
    id,
    patch: toApply,
    actorId: actor?.user?.user_id || null,
  });
  await repo.resyncArticleChunk({
    article,
    actorId: actor?.user?.user_id || null,
  });
  audit(
    auditCtx(actor, {
      action_key: "help_center.article.update",
      target_type: "help_article",
      target_id: article.article_id,
      before: { title: existing.title, is_active: existing.is_active },
      after: { title: article.title, is_active: article.is_active },
    }),
  );
  return article;
}

// Retire = soft delete (is_active=false). Removes the Praxis chunk so the
// agent stops citing it, but keeps the row (and its slug/history) intact.
async function retireArticle({ id, ...actor }) {
  const existing = await repo.getArticleById({ id });
  if (!existing) throw new NotFoundError("Article");
  const article = await repo.setArticleActive({
    id,
    is_active: false,
    actorId: actor?.user?.user_id || null,
  });
  await repo.resyncArticleChunk({
    article,
    actorId: actor?.user?.user_id || null,
  });
  audit(
    auditCtx(actor, {
      action_key: "help_center.article.retire",
      target_type: "help_article",
      target_id: article.article_id,
      before: { slug: existing.slug, is_active: true },
      after: { is_active: false },
    }),
  );
  return article;
}

async function createCategory({ input, ...actor }) {
  const category = await repo.createCategory(input);
  audit(
    auditCtx(actor, {
      action_key: "help_center.category.create",
      target_type: "help_category",
      target_id: category.category_id,
      after: { slug: category.slug, name: category.name },
    }),
  );
  return category;
}

async function updateCategory({ id, patch, ...actor }) {
  const category = await repo.updateCategory({ id, patch });
  if (!category) throw new NotFoundError("Category");
  audit(
    auditCtx(actor, {
      action_key: "help_center.category.update",
      target_type: "help_category",
      target_id: category.category_id,
      after: { name: category.name, is_active: category.is_active },
    }),
  );
  return category;
}

module.exports = {
  listCategories,
  listArticles,
  getArticle,
  // admin
  listArticlesAdmin,
  listCategoriesAdmin,
  getArticleForEdit,
  createArticle,
  updateArticle,
  retireArticle,
  createCategory,
  updateCategory,
};
