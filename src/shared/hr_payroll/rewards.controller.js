/**
 * Rewards controller (HTTP only) — delegates to rewards.service.
 */

"use strict";

const service = require("./rewards.service");

const ctx = (req) => ({ brand: req.brand, user: req.user, request_id: req.request_id });

async function listRules(req, res) {
  res.json(await service.listRules({ brand: req.brand, include_inactive: req.query.include_inactive === "true" }));
}
async function createRule(req, res) {
  res.status(201).json({ data: await service.createRule({ ...ctx(req), input: req.body }) });
}
async function updateRule(req, res) {
  res.json({ data: await service.updateRule({ ...ctx(req), id: req.params.id, patch: req.body }) });
}
async function deleteRule(req, res) {
  await service.deleteRule({ ...ctx(req), id: req.params.id });
  res.status(204).end();
}
async function evaluate(req, res) {
  res.json({ data: await service.evaluate({ ...ctx(req), year: req.body.year, month: req.body.month }) });
}
async function leaderboard(req, res) {
  res.json({
    data: await service.leaderboard({
      brand: req.brand,
      metric: req.query.metric,
      year: req.query.year ? Number(req.query.year) : undefined,
      month: req.query.month ? Number(req.query.month) : undefined,
    }),
  });
}
async function listGrants(req, res) {
  res.json(await service.listGrants({ brand: req.brand, filters: req.query }));
}
async function applyGrant(req, res) {
  res.json({ data: await service.applyGrant({ ...ctx(req), id: req.params.id }) });
}
async function rejectGrant(req, res) {
  res.json({ data: await service.rejectGrant({ ...ctx(req), id: req.params.id, reason: req.body.reason }) });
}

module.exports = {
  listRules, createRule, updateRule, deleteRule,
  evaluate, leaderboard, listGrants, applyGrant, rejectGrant,
};
