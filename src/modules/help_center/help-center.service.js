"use strict";

const repo = require("./help-center.repo");
const { NotFoundError } = require("../../utils/errors");

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

module.exports = { listCategories, listArticles, getArticle };
