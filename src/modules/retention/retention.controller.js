/**
 * Customer Retention & Loyalty + Streak Stars + Hair Quiz (V2.2 §6.23) —
 * HTTP controller. Authenticated handlers use req.brand; public handlers
 * resolve the brand from the X-Brand-Context header / ?brand (default PXG).
 */

"use strict";

const service = require("./retention.service");

const { VALID_BRANDS } = require("../../config/brands");
function brandHint(req) {
  const h = req.headers["x-brand-context"] || req.query.brand;
  return VALID_BRANDS.has(h) ? h : "pixiegirl";
}

// ── Authenticated (admin / staff) ──────────────────────────
async function listTiers(req, res) {
  res.json({ data: await service.listTiers({ brand: req.brand }) });
}

async function createTier(req, res) {
  res.status(201).json({
    data: await service.createTier({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
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

async function getLoyalty(req, res) {
  res.json({
    data: await service.getLoyaltyState({
      brand: req.brand,
      contact_id: req.params.contactId,
    }),
  });
}

async function redeemLoyalty(req, res) {
  res.json({
    data: await service.redeemPoints({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      contact_id: req.params.contactId,
      points: req.body.points,
      notes: req.body.notes,
    }),
  });
}

async function adjustLoyalty(req, res) {
  res.json({
    data: await service.adjustPoints({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      contact_id: req.params.contactId,
      points: req.body.points,
      notes: req.body.notes,
    }),
  });
}

async function listStreakTiers(req, res) {
  res.json({ data: await service.listStreakTiers({ brand: req.brand }) });
}

async function getStreak(req, res) {
  res.json({
    data: await service.getStreakState({
      brand: req.brand,
      contact_id: req.params.contactId,
    }),
  });
}

async function awardStreak(req, res) {
  res.status(201).json({
    data: await service.awardStars({
      brand: req.brand,
      contact_id: req.params.contactId,
      action_type: req.body.action_type,
      reference_type: req.body.reference_type || "manual",
      reference_id: req.body.reference_id,
      amount_ngn: req.body.amount_ngn,
      awarded_by: req.user.user_id,
      description: req.body.description,
    }),
  });
}

async function getReferral(req, res) {
  res.json({
    data: await service.getOrCreateReferral({
      brand: req.brand,
      contact_id: req.params.contactId,
      contact: {
        display_name: req.query.name,
        first_name: req.query.first_name,
      },
    }),
  });
}

// ── Public ─────────────────────────────────────────────────
async function validateReferralPublic(req, res) {
  res.json({
    data: await service.validateReferralCode({ code: req.params.code }),
  });
}

async function getQuizPublic(req, res) {
  res.json({
    data: await service.getQuiz({
      brand: brandHint(req),
      slug: req.query.slug,
    }),
  });
}

async function submitQuizPublic(req, res) {
  res.status(201).json({
    data: await service.submitQuiz({
      brand: brandHint(req),
      input: req.body,
      ip: req.ip,
      user_agent: req.headers["user-agent"],
    }),
  });
}

module.exports = {
  listTiers,
  createTier,
  updateTier,
  getLoyalty,
  redeemLoyalty,
  adjustLoyalty,
  listStreakTiers,
  getStreak,
  awardStreak,
  getReferral,
  validateReferralPublic,
  getQuizPublic,
  submitQuizPublic,
};
