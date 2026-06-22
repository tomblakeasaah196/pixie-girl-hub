/**
 * HR operations controller (HR Phase 1). HTTP only — delegates to
 * hr_ops.service. Self-service handlers read the staff profile from req.user;
 * management handlers are permission-gated in the router.
 */

"use strict";

const service = require("./hr_ops.service");
const contracts = require("./contracts.service");

const ctx = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// ── Self-service (My HR) ───────────────────────────────────
async function getMyHr(req, res) {
  res.json({ data: await service.getMyHr({ brand: req.brand, user: req.user }) });
}
async function requestLeave(req, res) {
  res.status(201).json({
    data: await service.requestLeave({ brand: req.brand, user: req.user, input: req.body }),
  });
}
async function respondToQuery(req, res) {
  res.json({
    data: await service.respondToQuery({
      brand: req.brand, user: req.user, id: req.params.id, response: req.body.response,
    }),
  });
}
async function getMyToday(req, res) {
  res.json({ data: await service.getMyToday({ brand: req.brand, user: req.user }) });
}
async function selfClock(req, res) {
  res.status(201).json({
    data: await service.selfClock({
      brand: req.brand,
      user: req.user,
      input: req.body,
      requestMeta: {
        ip_address: req.ip,
        user_agent: req.get ? req.get("user-agent") : undefined,
      },
    }),
  });
}

// ── Management (HR & Staff) ────────────────────────────────
async function getOverview(req, res) {
  res.json({ data: await service.getOverview({ brand: req.brand }) });
}
async function reconcile(req, res) {
  res.json({ data: await service.reconcileDay({ ...ctx(req), date: req.body.date }) });
}
async function applyLapsedOffsite(req, res) {
  res.json({ data: await service.applyLapsedOffsite({ ...ctx(req) }) });
}

async function listLeave(req, res) {
  res.json(await service.listLeave({ brand: req.brand, filters: req.query }));
}
async function approveLeave(req, res) {
  res.json({
    data: await service.decideLeave({ ...ctx(req), id: req.params.id, status: "approved" }),
  });
}
async function rejectLeave(req, res) {
  res.json({
    data: await service.decideLeave({
      ...ctx(req), id: req.params.id, status: "rejected", reason: req.body.rejection_reason,
    }),
  });
}

async function listQueries(req, res) {
  res.json(await service.listQueries({ brand: req.brand, filters: req.query }));
}
async function raiseQuery(req, res) {
  res.status(201).json({ data: await service.raiseQuery({ ...ctx(req), input: req.body }) });
}
async function resolveQuery(req, res) {
  res.json({
    data: await service.resolveQuery({
      ...ctx(req), id: req.params.id, resolution: req.body.resolution, note: req.body.note,
    }),
  });
}

async function listAttendanceDays(req, res) {
  const repo = require("./hr_ops.repo");
  res.json({ data: await repo.listAttendanceDays({ brand: req.brand, filters: req.query }) });
}

async function listTargets(req, res) {
  res.json(await service.listTargets({ brand: req.brand, filters: req.query }));
}
async function setTarget(req, res) {
  res.status(201).json({ data: await service.setTarget({ ...ctx(req), input: req.body }) });
}
async function updateTargetProgress(req, res) {
  res.json({
    data: await service.updateTargetProgress({
      ...ctx(req), id: req.params.id, current_value: req.body.current_value,
    }),
  });
}
async function removeTarget(req, res) {
  await service.removeTarget({ ...ctx(req), id: req.params.id });
  res.status(204).end();
}

async function listContracts(req, res) {
  res.json(await contracts.listForProfile({ brand: req.brand, profileId: req.params.id }));
}
async function generateContract(req, res) {
  res.status(201).json({
    data: await contracts.generateContract({
      ...ctx(req),
      profileId: req.params.id,
      input: req.body,
    }),
  });
}

async function getSettings(req, res) {
  res.json({ data: await service.getSettings({ brand: req.brand }) });
}
async function updateSettings(req, res) {
  res.json({ data: await service.updateSettings({ ...ctx(req), patch: req.body }) });
}
async function setPayoutPin(req, res) {
  res.json({ data: await service.setPayoutPin({ ...ctx(req), pin: req.body.pin }) });
}

module.exports = {
  getMyHr,
  requestLeave,
  respondToQuery,
  getMyToday,
  selfClock,
  getOverview,
  reconcile,
  applyLapsedOffsite,
  listLeave,
  approveLeave,
  rejectLeave,
  listQueries,
  raiseQuery,
  resolveQuery,
  listAttendanceDays,
  listTargets,
  setTarget,
  updateTargetProgress,
  removeTarget,
  listContracts,
  generateContract,
  getSettings,
  updateSettings,
  setPayoutPin,
};
