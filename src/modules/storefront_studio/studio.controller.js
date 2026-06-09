/**
 * Storefront Studio (V2.2 §6.28) — HTTP controller. Authenticated; brand
 * from req.brand (brand-context middleware).
 */

"use strict";

const service = require("./studio.service");

async function getThemes(req, res) {
  res.json({ data: await service.getThemes({ brand: req.brand }) });
}
async function saveThemeDraft(req, res) {
  res.json({
    data: await service.saveThemeDraft({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      tokens: req.body.tokens,
    }),
  });
}
async function publishTheme(req, res) {
  res.json({
    data: await service.publishTheme({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
    }),
  });
}

async function getNavigation(req, res) {
  res.json({ data: await service.getNavigation({ brand: req.brand }) });
}
async function saveNavDraft(req, res) {
  res.json({
    data: await service.saveNavDraft({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      nav: req.body,
    }),
  });
}
async function publishNav(req, res) {
  res.json({
    data: await service.publishNav({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
    }),
  });
}

async function listPages(req, res) {
  res.json({ data: await service.listPages({ brand: req.brand }) });
}
async function savePageDraft(req, res) {
  res.json({
    data: await service.savePageDraft({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      page: req.body,
    }),
  });
}
async function publishPage(req, res) {
  res.json({
    data: await service.publishPage({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      page_key: req.params.pageKey,
    }),
  });
}

module.exports = {
  getThemes,
  saveThemeDraft,
  publishTheme,
  getNavigation,
  saveNavDraft,
  publishNav,
  listPages,
  savePageDraft,
  publishPage,
};
