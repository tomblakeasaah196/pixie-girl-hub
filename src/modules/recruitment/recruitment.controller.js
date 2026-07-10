/**
 * Recruitment controller — thin HTTP handlers (req/res only). Admin surface is
 * brand-scoped (req.brand via brandContextMiddleware); the public offer page is
 * token-identified and needs no auth.
 */

"use strict";

const service = require("./recruitment.service");

// ── Company context pack ───────────────────────────────────
async function getContext(_req, res) {
  res.json({ data: await service.getContextPack() });
}
async function updateContext(req, res) {
  res.json({
    data: await service.updateContext({
      user: req.user,
      request_id: req.request_id,
      business: req.params.business,
      input: req.body,
    }),
  });
}

// ── Templates ──────────────────────────────────────────────
async function listTemplates(req, res) {
  res.json({ data: await service.listTemplates({ brand: req.brand }) });
}
async function createTemplate(req, res) {
  res.status(201).json({
    data: await service.createTemplate({ user: req.user, input: req.body }),
  });
}
async function deleteTemplate(req, res) {
  await service.deleteTemplate({ id: req.params.id });
  res.status(204).end();
}

// ── Offers (admin) ─────────────────────────────────────────
async function draft(req, res) {
  res.status(201).json({
    data: await service.draftOffer({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}
async function list(req, res) {
  res.json({
    data: await service.listOffers({ brand: req.brand, status: req.query.status }),
  });
}
async function get(req, res) {
  res.json({ data: await service.getOffer({ brand: req.brand, id: req.params.id }) });
}
async function rendered(req, res) {
  res.json({ data: await service.getRenderedOffer({ brand: req.brand, id: req.params.id }) });
}
async function edit(req, res) {
  res.json({
    data: await service.editOffer({ brand: req.brand, id: req.params.id, input: req.body }),
  });
}
async function regenerate(req, res) {
  res.json({
    data: await service.regenerateDraft({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      intake: req.body.intake,
    }),
  });
}
async function approve(req, res) {
  res.json({
    data: await service.approveAndSend({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function provision(req, res) {
  res.status(201).json({
    data: await service.provisionCredentials({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
    }),
  });
}

// ── Public (no auth, token-identified) ─────────────────────
async function publicGet(req, res) {
  res.json({
    data: await service.getPublicOffer({
      token: req.params.token,
      ip: req.ip,
      ua: req.get("user-agent"),
    }),
  });
}
async function publicSign(req, res) {
  res.json({
    data: await service.signPublicOffer({
      token: req.params.token,
      signature_data_url: req.body.signature_data_url,
      ip: req.ip,
      ua: req.get("user-agent"),
    }),
  });
}

module.exports = {
  getContext,
  updateContext,
  listTemplates,
  createTemplate,
  deleteTemplate,
  draft,
  list,
  get,
  rendered,
  edit,
  regenerate,
  approve,
  provision,
  publicGet,
  publicSign,
};
