/**
 * Faitlyn Service Job Tracker (V2.2 §6.24) — HTTP controller.
 */

"use strict";

const service = require("./service-jobs.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// ── Service types ──────────────────────────────────────────
async function listServiceTypes(req, res) {
  res.json({
    data: await service.listServiceTypes({
      brand: req.brand,
      is_active:
        req.query.is_active === undefined
          ? undefined
          : req.query.is_active === "true",
    }),
  });
}
async function createServiceType(req, res) {
  res.status(201).json({
    data: await service.createServiceType({ ...base(req), input: req.body }),
  });
}
async function updateServiceType(req, res) {
  res.json({
    data: await service.updateServiceType({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}

// ── Jobs ───────────────────────────────────────────────────
async function listJobs(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listJobs({
      brand: req.brand,
      status: req.query.status,
      assigned_staff_user_id: req.query.assigned_staff_user_id,
      assigned_stylist_id: req.query.assigned_stylist_id,
      customer_contact_id: req.query.customer_contact_id,
      page,
      page_size,
    }),
  );
}
async function getJob(req, res) {
  res.json({
    data: await service.getJob({ brand: req.brand, id: req.params.id }),
  });
}
async function createJob(req, res) {
  res
    .status(201)
    .json({ data: await service.createJob({ ...base(req), input: req.body }) });
}
async function updateJob(req, res) {
  res.json({
    data: await service.updateJob({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}
async function advanceJob(req, res) {
  res.json({
    data: await service.advanceJob({
      ...base(req),
      id: req.params.id,
      status: req.body.status,
      actual_cost_ngn: req.body.actual_cost_ngn,
    }),
  });
}
async function assignStaff(req, res) {
  res.json({
    data: await service.assignStaff({
      ...base(req),
      id: req.params.id,
      assigned_staff_user_id: req.body.assigned_staff_user_id,
    }),
  });
}
async function recordOutcome(req, res) {
  res.json({
    data: await service.recordOutcome({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}

module.exports = {
  listServiceTypes,
  createServiceType,
  updateServiceType,
  listJobs,
  getJob,
  createJob,
  updateJob,
  advanceJob,
  assignStaff,
  recordOutcome,
};
