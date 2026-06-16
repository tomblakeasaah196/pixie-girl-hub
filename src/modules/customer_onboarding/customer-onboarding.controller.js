/**
 * Customer Onboarding — HTTP controllers.
 *
 * Two mount points (see customer-onboarding.routes.js):
 *   /api/v1/customer-onboarding/*     — authenticated admin paths
 *   /api/public/onboarding/:token     — public, token-protected
 */

"use strict";

const service = require("./customer-onboarding.service");

const ctx = (req) => ({
  user: req.user,
  brand: req.brand,
  request_id: req.request_id,
});

async function createLink(req, res) {
  const data = await service.createLink({ ...ctx(req), input: req.body });
  res.status(201).json(data);
}

async function listAdmin(req, res) {
  const data = await service.listAdmin({
    brand: req.brand,
    limit: req.query.limit ? Math.min(parseInt(req.query.limit, 10), 100) : 50,
    offset: req.query.offset ? parseInt(req.query.offset, 10) : 0,
  });
  res.json({ data });
}

async function getPublic(req, res) {
  const data = await service.getPublic({ token: req.params.token });
  res.json(data);
}

async function submitPublic(req, res) {
  const data = await service.submitPublic({
    token: req.params.token,
    ip: req.ip,
    payload: req.body,
  });
  res.status(201).json(data);
}

module.exports = { createLink, listAdmin, getPublic, submitPublic };
