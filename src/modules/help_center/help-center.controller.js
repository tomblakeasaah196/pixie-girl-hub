"use strict";

const service = require("./help-center.service");

const actor = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// ── Public (read) ────────────────────────────────────────

async function listCategories(_req, res) {
  res.json({ data: await service.listCategories() });
}

async function listArticles(req, res) {
  const data = await service.listArticles({
    category_slug: req.query.category,
    related_module: req.query.module,
    audience: req.query.audience,
    q: req.query.q,
    limit: req.query.limit ? Math.min(parseInt(req.query.limit, 10), 200) : 100,
  });
  res.json({ data });
}

async function getArticle(req, res) {
  res.json(await service.getArticle({ slug: req.params.slug }));
}

// ── Admin (edit) ─────────────────────────────────────────

async function listArticlesAdmin(req, res) {
  const data = await service.listArticlesAdmin({
    category_slug: req.query.category,
    related_module: req.query.module,
    q: req.query.q,
  });
  res.json({ data });
}

async function listCategoriesAdmin(_req, res) {
  res.json({ data: await service.listCategoriesAdmin() });
}

async function getArticleForEdit(req, res) {
  res.json({ data: await service.getArticleForEdit({ id: req.params.id }) });
}

async function createArticle(req, res) {
  res
    .status(201)
    .json({ data: await service.createArticle({ ...actor(req), input: req.body }) });
}

async function updateArticle(req, res) {
  res.json({
    data: await service.updateArticle({
      ...actor(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}

async function retireArticle(req, res) {
  res.json({
    data: await service.retireArticle({ ...actor(req), id: req.params.id }),
  });
}

async function createCategory(req, res) {
  res.status(201).json({
    data: await service.createCategory({ ...actor(req), input: req.body }),
  });
}

async function updateCategory(req, res) {
  res.json({
    data: await service.updateCategory({
      ...actor(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
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
