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

async function listPopups(req, res) {
  res.json({ data: await service.listPopups({ brand: req.brand }) });
}
async function savePopupDraft(req, res) {
  res.json({
    data: await service.savePopupDraft({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      popup: req.body,
    }),
  });
}
async function publishPopup(req, res) {
  res.json({
    data: await service.publishPopup({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      popup_key: req.params.popupKey,
    }),
  });
}
async function deletePopup(req, res) {
  res.json({
    data: await service.deletePopup({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      popup_key: req.params.popupKey,
    }),
  });
}
async function listSectionTemplates(_req, res) {
  res.json({ data: await service.listSectionTemplates() });
}

// ── Content posts ──────────────────────────────────────────
async function listContent(req, res) {
  res.json({
    data: await service.listContentPosts({
      brand: req.brand,
      type: req.query.type,
    }),
  });
}
async function createContent(req, res) {
  res.status(201).json({
    data: await service.createContentPost({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}
async function updateContent(req, res) {
  res.json({
    data: await service.updateContentPost({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      post_id: req.params.postId,
      input: req.body,
    }),
  });
}
async function publishContent(req, res) {
  res.json({
    data: await service.publishContentPost({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      post_id: req.params.postId,
    }),
  });
}
async function unpublishContent(req, res) {
  res.json({
    data: await service.unpublishContentPost({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      post_id: req.params.postId,
    }),
  });
}
async function deleteContent(req, res) {
  res.json({
    data: await service.deleteContentPost({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      post_id: req.params.postId,
    }),
  });
}
async function uploadImage(req, res) {
  res.json({ data: await service.uploadImage({ brand: req.brand, file: req.file }) });
}
async function uploadVideo(req, res) {
  res.json({
    data: await service.uploadVideo({
      brand: req.brand,
      file: req.file,
      options: req.body || {},
    }),
  });
}
async function previewInfo(req, res) {
  res.json({ data: await service.previewInfo({ brand: req.brand }) });
}
async function listRevisions(req, res) {
  res.json({ data: await service.listRevisions({ brand: req.brand }) });
}
async function rollbackRevision(req, res) {
  res.json({
    data: await service.rollbackRevision({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      revision_id: req.params.revisionId,
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
  listPopups,
  savePopupDraft,
  publishPopup,
  deletePopup,
  listSectionTemplates,
  uploadImage,
  uploadVideo,
  previewInfo,
  listRevisions,
  rollbackRevision,
  listContent,
  createContent,
  updateContent,
  publishContent,
  unpublishContent,
  deleteContent,
};
