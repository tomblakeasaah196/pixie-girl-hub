/**
 * HR & Payroll controller (V2.2 §6.11) — Pass 1.
 * HTTP only. Employees + a generic config-CRUD handler factory.
 */

"use strict";

const service = require("./hr.service");

function pageArgs(req) {
  return {
    filters: req.query,
    page: parseInt(req.query.page || "1", 10),
    page_size: Math.min(parseInt(req.query.page_size || "50", 10), 200),
  };
}

// ── Employees ──────────────────────────────────────────────
async function listStaff(req, res) {
  res.json(
    await service.listStaff({
      brand: req.brand,
      user: req.user,
      ...pageArgs(req),
    }),
  );
}
async function getStaff(req, res) {
  res.json({
    data: await service.getStaff({
      brand: req.brand,
      user: req.user,
      id: req.params.id,
    }),
  });
}
async function createStaff(req, res) {
  const data = await service.createStaff({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    input: req.body,
  });
  res.status(201).json({ data });
}
async function updateStaff(req, res) {
  const data = await service.updateStaff({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    patch: req.body,
  });
  res.json({ data });
}
async function deleteStaff(req, res) {
  await service.deleteStaff({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
  });
  res.status(204).end();
}

// ── Generic config handlers ────────────────────────────────
function configHandlers(svc) {
  return {
    list: async (req, res) =>
      res.json(await svc.list({ brand: req.brand, ...pageArgs(req) })),
    get: async (req, res) =>
      res.json({
        data: await svc.get({ brand: req.brand, id: req.params.id }),
      }),
    create: async (req, res) =>
      res.status(201).json({
        data: await svc.create({
          brand: req.brand,
          user: req.user,
          request_id: req.request_id,
          input: req.body,
        }),
      }),
    update: async (req, res) =>
      res.json({
        data: await svc.update({
          brand: req.brand,
          user: req.user,
          request_id: req.request_id,
          id: req.params.id,
          patch: req.body,
        }),
      }),
    remove: async (req, res) => {
      await svc.remove({
        brand: req.brand,
        user: req.user,
        request_id: req.request_id,
        id: req.params.id,
      });
      res.status(204).end();
    },
  };
}

const commissionRules = configHandlers(service.commissionRules);
const bonusRules = configHandlers(service.bonusRules);
const deductions = configHandlers(service.deductions);
const cycles = configHandlers(service.cycles);
const kpiDefs = configHandlers(service.kpiDefs);
kpiDefs.weightSummary = async (req, res) =>
  res.json({ data: await service.kpiDefs.weightSummary({ brand: req.brand }) });

module.exports = {
  listStaff,
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  commissionRules,
  bonusRules,
  deductions,
  cycles,
  kpiDefs,
};
