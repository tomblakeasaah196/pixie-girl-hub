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
// Send a [TEST] copy of the mail to the requester (+ optional sign-off
// addresses like the CEO's) for approval — no recipients, counters or status
// change on the real campaign.
async function sendTestCampaign(req, res) {
  res.json({
    data: await service.sendTest({
      ...base(req),
      id: req.params.id,
      emails: req.body.emails,
    }),
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
async function previewAudience(req, res) {
  res.json({
    data: await service.previewAudience({
      brand: req.brand,
      filter: req.body.filter,
    }),
  });
}
async function previewCampaign(req, res) {
  res.json({
    data: await service.previewCampaign({ brand: req.brand, id: req.params.id }),
  });
}
// The read-only From/Reply-To the campaign builder shows — resolved from the
// messaging module's Outbound Email connection, never typed per campaign.
async function getSenderIdentity(req, res) {
  res.json({ data: await service.getSenderIdentity({ brand: req.brand }) });
}
async function getFrame(req, res) {
  res.json({ data: await service.getFrame({ brand: req.brand }) });
}
async function updateFrame(req, res) {
  res.json({
    data: await service.updateFrame({ ...base(req), patch: req.body }),
  });
}
async function frameShell(req, res) {
  res.json({ data: await service.frameShell({ brand: req.brand }) });
}

// Custom personalise tokens (the editor's "add your own")
async function listPersonaliseTokens(req, res) {
  res.json({ data: await service.listPersonaliseTokens({ brand: req.brand }) });
}
async function savePersonaliseTokens(req, res) {
  res.json({
    data: await service.savePersonaliseTokens({
      ...base(req),
      tokens: req.body.tokens,
    }),
  });
}
async function uploadImage(req, res) {
  res.status(201).json({
    data: await service.uploadImage({ brand: req.brand, file: req.file }),
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
async function unsubscribeContact(req, res) {
  await service.handleContactUnsubscribe({
    brand: brandHint(req),
    token: req.params.token,
  });
  // A customer clicks this from their inbox — answer with a small, human
  // page, not JSON.
  res
    .set("Content-Type", "text/html; charset=utf-8")
    .send(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head>` +
        `<body style="margin:0;padding:48px 24px;background:#F4EFE9;font-family:Arial,Helvetica,sans-serif;color:#1A1212;text-align:center">` +
        `<div style="max-width:420px;margin:0 auto;background:#fff;border-radius:14px;padding:36px 28px;box-shadow:0 10px 30px rgba(0,0,0,.08)">` +
        `<div style="font-size:26px;margin-bottom:10px">You're unsubscribed</div>` +
        `<p style="font-size:15px;line-height:1.6;color:#7A7068;margin:0">You won't receive marketing emails from us any more. ` +
        `Order and payment emails still arrive as usual.</p></div></body></html>`,
    );
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
  sendTestCampaign,
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
  previewAudience,
  previewCampaign,
  getSenderIdentity,
  getFrame,
  updateFrame,
  frameShell,
  uploadImage,
  buildAudienceFromSegment,
  subscribeNewsletter,
  trackOpen,
  trackClick,
  unsubscribe,
  unsubscribeContact,
  listPersonaliseTokens,
  savePersonaliseTokens,
};
