/**
 * Social Studio (V2.2 §6.14) — HTTP controller.
 */

"use strict";

const service = require("./social.service");
const v = require("./social.validator");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

function monthParam(req) {
  const raw = req.query.period_month || new Date().toISOString().slice(0, 7);
  return v.MONTH.parse(raw);
}

// ── Accounts ───────────────────────────────────────────────
async function listAccounts(req, res) {
  res.json({ data: await service.listAccounts({ brand: req.brand }) });
}
async function listAssignableStaff(req, res) {
  res.json({ data: await service.listAssignableStaff({ brand: req.brand }) });
}
async function connectAccount(req, res) {
  res.status(201).json({
    data: await service.connectAccount({ ...base(req), input: req.body }),
  });
}
async function revokeAccount(req, res) {
  await service.revokeAccount({ ...base(req), id: req.params.id });
  res.status(204).end();
}

// ── Content plans ────────────────────────────────────────────
async function createPlan(req, res) {
  res.status(201).json({
    data: await service.createPlan({ ...base(req), ...req.body }),
  });
}
async function listPlans(req, res) {
  res.json({
    data: await service.listPlans({
      brand: req.brand,
      status: req.query.status,
    }),
  });
}
async function getPlan(req, res) {
  res.json({
    data: await service.getPlan({ brand: req.brand, id: req.params.id }),
  });
}
async function addPostsToPlan(req, res) {
  res.status(201).json({
    data: await service.addPostsToPlan({
      ...base(req),
      plan_id: req.params.id,
      rows: req.body.rows,
    }),
  });
}
async function submitPlan(req, res) {
  res.json({
    data: await service.submitPlan({ ...base(req), id: req.params.id }),
  });
}
async function approvePlan(req, res) {
  res.json({
    data: await service.approvePlan({
      ...base(req),
      id: req.params.id,
      notes: req.body.notes,
    }),
  });
}
async function requestPlanChanges(req, res) {
  res.json({
    data: await service.requestPlanChanges({
      ...base(req),
      id: req.params.id,
      notes: req.body.notes,
    }),
  });
}

// ── Posts ──────────────────────────────────────────────────
async function listPosts(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listPosts({
      brand: req.brand,
      status: req.query.status,
      plan_id: req.query.plan_id,
      assigned_to: req.query.assigned_to,
      platform: req.query.platform,
      from: req.query.from,
      to: req.query.to,
      page,
      page_size,
    }),
  );
}
async function getPost(req, res) {
  res.json({
    data: await service.getPost({ brand: req.brand, id: req.params.id }),
  });
}
async function createPost(req, res) {
  res.status(201).json({
    data: await service.createPost({ ...base(req), input: req.body }),
  });
}
async function updatePost(req, res) {
  res.json({
    data: await service.updatePost({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function reschedulePost(req, res) {
  res.json({
    data: await service.reschedule({
      ...base(req),
      id: req.params.id,
      scheduled_for: req.body.scheduled_for,
    }),
  });
}
async function submitProof(req, res) {
  res.json({
    data: await service.submitProof({
      ...base(req),
      id: req.params.id,
      external_url: req.body.external_url,
      screenshot: req.file,
    }),
  });
}
async function rateCreative(req, res) {
  res.json({
    data: await service.rateCreative({
      ...base(req),
      id: req.params.id,
      rating: req.body.rating,
    }),
  });
}
async function recordMetrics(req, res) {
  res.json({
    data: await service.recordMetrics({
      brand: req.brand,
      id: req.params.id,
      metric_date: req.body.metric_date,
      metrics: req.body.metrics,
    }),
  });
}
async function snoozePost(req, res) {
  res.json({
    data: await service.snoozePost({ brand: req.brand, id: req.params.id }),
  });
}

// ── Targets ────────────────────────────────────────────────
async function setTarget(req, res) {
  res
    .status(201)
    .json({ data: await service.setTarget({ ...base(req), ...req.body }) });
}
async function listTargets(req, res) {
  res.json({
    data: await service.listTargets({
      brand: req.brand,
      period_month: monthParam(req),
    }),
  });
}

// ── Performance / Team ───────────────────────────────────────
async function getPerformance(req, res) {
  res.json({
    data: await service.getPerformance({
      brand: req.brand,
      period_month: monthParam(req),
    }),
  });
}
async function getTeam(req, res) {
  res.json({
    data: await service.getTeam({
      brand: req.brand,
      period_month: monthParam(req),
    }),
  });
}
async function getCreatorDrilldown(req, res) {
  res.json({
    data: await service.getCreatorDrilldown({
      brand: req.brand,
      user_id: req.params.userId,
      period_month: monthParam(req),
    }),
  });
}

// ── Inbound DM → Smartcomm (CRM §6.1) ───────────────────────
async function ingestInboundDM(req, res) {
  res.status(201).json({
    data: await service.ingestInboundDM({ ...base(req), input: req.body }),
  });
}

module.exports = {
  listAccounts,
  listAssignableStaff,
  connectAccount,
  revokeAccount,
  createPlan,
  listPlans,
  getPlan,
  addPostsToPlan,
  submitPlan,
  approvePlan,
  requestPlanChanges,
  listPosts,
  getPost,
  createPost,
  updatePost,
  reschedulePost,
  submitProof,
  rateCreative,
  recordMetrics,
  snoozePost,
  setTarget,
  listTargets,
  getPerformance,
  getTeam,
  getCreatorDrilldown,
  ingestInboundDM,
};
