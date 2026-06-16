"use strict";

const service = require("./help-center.service");

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

module.exports = { listCategories, listArticles, getArticle };
