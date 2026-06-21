/**
 * Email Campaigns (V2.2 §6.16) — HTTP controller.
 */

"use strict";

const service = require("./email-campaigns.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

const VALID_BRANDS = new Set(["pixiegirl", "faitlynhair"]);
function brandHint(req) {
  const h = req.brand || req.headers["x-brand-context"] || req.query.brand;
  return VALID_BRANDS.has(h) ? h : "pixiegirl";
}

// Templates
async function listTemplates(req, res) {
  res.json({ data: await service.listTemplates({ brand: req.brand }) });
}
async function createTemplate(req, res) {
  res.status(201).json({
    data: await service.createTemplate({ ...base(req), input: req.body }),
  });
}
async function updateTemplate(req, res) {
  res.json({
    data: await service.updateTemplate({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}

// Campaigns
async function listCampaigns(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listCampaigns({
      brand: req.brand,
      status: req.query.status,
      page,
      page_size,
    }),
  );
}
async function getCampaign(req, res) {
  res.json({
    data: await service.getCampaign({ brand: req.brand, id: req.params.id }),
  });
}
async function createCampaign(req, res) {
  res.status(201).json({
    data: await service.createCampaign({ ...base(req), input: req.body }),
  });
}
async function updateCampaign(req, res) {
  res.json({
    data: await service.updateCampaign({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}
async function buildRecipients(req, res) {
  res.json({
    data: await service.buildRecipients({
      ...base(req),
      id: req.params.id,
      contact_ids: req.body.contact_ids,
    }),
  });
}
async function sendCampaign(req, res) {
  res.json({
    data: await service.sendCampaign({ ...base(req), id: req.params.id }),
  });
}
async function pauseCampaign(req, res) {
  res.json({
    data: await service.setStatus({
      ...base(req),
      id: req.params.id,
      status: "paused",
    }),
  });
}
async function cancelCampaign(req, res) {
  res.json({
    data: await service.setStatus({
      ...base(req),
      id: req.params.id,
      status: "cancelled",
    }),
  });
}
async function recordEvent(req, res) {
  res.json({
    data: await service.recordEvent({
      brand: req.brand,
      campaign_id: req.params.id,
      email: req.body.email,
      event_type: req.body.event_type,
    }),
  });
}

// A/B variants
async function createVariant(req, res) {
  res.status(201).json({
    data: await service.createVariant({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function getAbTestResults(req, res) {
  res.json({
    data: await service.getAbTestResults({
      brand: req.brand,
      id: req.params.id,
    }),
  });
}
async function declareWinner(req, res) {
  res.json({
    data: await service.declareWinner({
      ...base(req),
      id: req.params.id,
      variant_id: req.body.variant_id,
    }),
  });
}

// Scheduling + stats
async function schedule(req, res) {
  res.json({
    data: await service.schedule({
      ...base(req),
      id: req.params.id,
      scheduled_for: req.body.scheduled_for,
    }),
  });
}
async function getStats(req, res) {
  res.json({
    data: await service.getStats({ brand: req.brand, id: req.params.id }),
  });
}

// Segments
async function listSegments(req, res) {
  res.json({ data: await service.listSegments({ brand: req.brand }) });
}
async function getSegment(req, res) {
  res.json({
    data: await service.getSegment({ brand: req.brand, id: req.params.id }),
  });
}
async function saveSegment(req, res) {
  res.status(201).json({
    data: await service.saveSegment({ ...base(req), input: req.body }),
  });
}
async function deleteSegment(req, res) {
  await service.deleteSegment({ ...base(req), id: req.params.id });
  res.status(204).end();
}
async function previewSegment(req, res) {
  res.json({
    data: await service.previewSegment({ brand: req.brand, id: req.params.id }),
  });
}
async function buildAudienceFromSegment(req, res) {
  res.json({
    data: await service.buildAudienceFromSegment({
      ...base(req),
      id: req.params.id,
      segment_id: req.body.segment_id,
    }),
  });
}

// Public newsletter
async function subscribeNewsletter(req, res) {
  res.status(201).json({
    data: await service.subscribeNewsletter({
      brand: brandHint(req),
      input: req.body,
    }),
  });
}

// ── Public tracking ────────────────────────────────────────
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);
async function trackOpen(req, res) {
  await service.handlePixelOpen({
    brand: brandHint(req),
    recipient_id: req.params.recipient_id,
    ip: req.ip,
    user_agent: req.headers["user-agent"],
  });
  res.set("Content-Type", "image/gif");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.end(PIXEL);
}
async function trackClick(req, res) {
  const url = req.query.url;
  const result = await service.handleClick({
    brand: brandHint(req),
    recipient_id: req.params.recipient_id,
    url,
    ip: req.ip,
    user_agent: req.headers["user-agent"],
  });
  res.redirect(302, result.redirect || "/");
}
async function unsubscribe(req, res) {
  await service.handleUnsubscribe({
    brand: brandHint(req),
    recipient_id: req.params.recipient_id,
  });
  res.json({ data: { unsubscribed: true } });
}

module.exports = {
  listTemplates,
  createTemplate,
  updateTemplate,
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  buildRecipients,
  sendCampaign,
  pauseCampaign,
  cancelCampaign,
  recordEvent,
  createVariant,
  getAbTestResults,
  declareWinner,
  schedule,
  getStats,
  listSegments,
  getSegment,
  saveSegment,
  deleteSegment,
  previewSegment,
  buildAudienceFromSegment,
  subscribeNewsletter,
  trackOpen,
  trackClick,
  unsubscribe,
};
