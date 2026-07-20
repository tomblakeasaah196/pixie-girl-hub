/**
 * Crowns 👑 — unified loyalty + streak economy (Module 6.23). HTTP controller.
 * Thin handlers over crown.service — req/res only, no business logic. All
 * routes are authenticated staff/admin (permission key: retention); the
 * customer-facing storefront surface lands in the UI PR.
 */

"use strict";

const service = require("./crown.service");
const streak = require("./crown.streak");

async function listTiers(req, res) {
  res.json({ data: await service.listTiers({ brand: req.brand }) });
}

async function updateTier(req, res) {
  res.json({
    data: await service.updateTier({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      patch: req.body,
    }),
  });
}

async function listRules(req, res) {
  res.json({
    data: await service.listRules({
      brand: req.brand,
      action_type: req.query.action_type,
    }),
  });
}

async function updateRule(req, res) {
  res.json({
    data: await service.updateRule({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      patch: req.body,
    }),
  });
}

async function listStreakConfig(req, res) {
  res.json({ data: await service.listStreakConfig({ brand: req.brand }) });
}

async function getWallet(req, res) {
  res.json({
    data: await service.getWallet({
      brand: req.brand,
      contact_id: req.params.contactId,
    }),
  });
}

async function getDiscount(req, res) {
  res.json({
    data: await service.getActiveDiscount({
      brand: req.brand,
      contact_id: req.params.contactId,
    }),
  });
}

async function adjust(req, res) {
  res.status(201).json({
    data: await service.adjust({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      contact_id: req.params.contactId,
      crowns: req.body.crowns,
      note: req.body.note,
    }),
  });
}

async function checkIn(req, res) {
  res.status(201).json({
    data: await streak.checkIn({
      brand: req.brand,
      contact_id: req.params.contactId,
    }),
  });
}

async function submitAction(req, res) {
  res.status(201).json({
    data: await service.submitAction({
      brand: req.brand,
      contact_id: req.params.contactId,
      rule_key: req.body.rule_key,
      social_handle: req.body.social_handle,
      proof_url: req.body.proof_url,
      media_asset_id: req.body.media_asset_id,
      note: req.body.note,
    }),
  });
}

async function listSubmissions(req, res) {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  res.json({
    data: await service.listPendingSubmissions({
      brand: req.brand,
      limit,
      offset,
    }),
  });
}

async function reviewSubmission(req, res) {
  res.json({
    data: await service.reviewSubmission({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      submission_id: req.params.id,
      decision: req.body.decision,
      review_note: req.body.review_note,
    }),
  });
}

module.exports = {
  listTiers,
  updateTier,
  listRules,
  updateRule,
  listStreakConfig,
  getWallet,
  getDiscount,
  adjust,
  checkIn,
  submitAction,
  listSubmissions,
  reviewSubmission,
};
