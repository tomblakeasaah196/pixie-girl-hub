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
    data: await service.assignStylist({
      ...base(req),
      id: req.params.id,
      assigned_staff_user_id: req.body.assigned_staff_user_id,
    }),
  });
}

// ── Stylist Studio (PR2) lifecycle ─────────────────────────
async function startWork(req, res) {
  res.json({
    data: await service.startWork({ ...base(req), id: req.params.id }),
  });
}
async function pauseWork(req, res) {
  res.json({
    data: await service.pauseWork({ ...base(req), id: req.params.id }),
  });
}
async function resumeWork(req, res) {
  res.json({
    data: await service.resumeWork({ ...base(req), id: req.params.id }),
  });
}
async function returnForQc(req, res) {
  res.json({
    data: await service.returnForQc({ ...base(req), id: req.params.id }),
  });
}
async function recordQc(req, res) {
  res.json({
    data: await service.recordQc({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function dispatch(req, res) {
  res.json({
    data: await service.dispatch({ ...base(req), id: req.params.id }),
  });
}
async function handToSales(req, res) {
  res.json({
    data: await service.handToSales({ ...base(req), id: req.params.id }),
  });
}
async function linkIntercompany(req, res) {
  res.json({
    data: await service.linkIntercompany({
      ...base(req),
      id: req.params.id,
      ic_transaction_id: req.body.ic_transaction_id,
    }),
  });
}

// ── Materials / references / time ──────────────────────────
async function logMaterial(req, res) {
  res.status(201).json({
    data: await service.logMaterial({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function listMaterials(req, res) {
  res.json({
    data: await service.listMaterials({ brand: req.brand, id: req.params.id }),
  });
}
async function addReference(req, res) {
  res.status(201).json({
    data: await service.addReference({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function listReferences(req, res) {
  res.json({
    data: await service.listReferences({ brand: req.brand, id: req.params.id }),
  });
}
async function removeReference(req, res) {
  res.json({
    data: await service.removeReference({
      ...base(req),
      id: req.params.id,
      reference_id: req.params.refId,
    }),
  });
}
async function listTimeLogs(req, res) {
  res.json({
    data: await service.listTimeLogs({ brand: req.brand, id: req.params.id }),
  });
}

// ── Wig accountability ─────────────────────────────────────
async function getAccountability(req, res) {
  res.json({ data: await service.getAccountability({ brand: req.brand }) });
}
async function listCustodyLedger(req, res) {
  res.json({
    data: await service.listCustodyLedger({
      brand: req.brand,
      job_id: req.query.job_id,
      stylist_user_id: req.query.stylist_user_id,
    }),
  });
}
async function writeOffWig(req, res) {
  res.status(201).json({
    data: await service.writeOffWig({
      ...base(req),
      id: req.params.id,
      reason: req.body.reason,
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

// ── Chemical recipes (F-7c) ────────────────────────────────
async function listRecipes(req, res) {
  res.json({
    data: await service.listRecipes({
      brand: req.brand,
      is_active:
        req.query.is_active === undefined
          ? undefined
          : req.query.is_active === "true",
    }),
  });
}
async function getRecipe(req, res) {
  res.json({
    data: await service.getRecipe({ brand: req.brand, id: req.params.id }),
  });
}
async function createRecipe(req, res) {
  res.status(201).json({
    data: await service.createRecipe({ ...base(req), input: req.body }),
  });
}
async function updateRecipe(req, res) {
  res.json({
    data: await service.updateRecipe({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}

// ── Service-job chemical consumption (F-7d) ────────────────
async function recordChemical(req, res) {
  res.status(201).json({
    data: await service.recordChemicalConsumption({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function listChemicals(req, res) {
  res.json({
    data: await service.listChemicalConsumption({
      brand: req.brand,
      id: req.params.id,
    }),
  });
}

// ── Monthly chemical reconciliation (F-7e) ─────────────────
async function reconcileChemicals(req, res) {
  res.json({
    data: await service.reconcileChemicals({
      ...base(req),
      fiscal_period_id: req.params.periodId,
    }),
  });
}
async function listReconciliations(req, res) {
  res.json({
    data: await service.listReconciliations({
      brand: req.brand,
      fiscal_period_id: req.query.fiscal_period_id,
      variance_status: req.query.variance_status,
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
  startWork,
  pauseWork,
  resumeWork,
  returnForQc,
  recordQc,
  dispatch,
  handToSales,
  linkIntercompany,
  logMaterial,
  listMaterials,
  addReference,
  listReferences,
  removeReference,
  listTimeLogs,
  getAccountability,
  listCustodyLedger,
  writeOffWig,
  recordOutcome,
  listRecipes,
  getRecipe,
  createRecipe,
  updateRecipe,
  recordChemical,
  listChemicals,
  reconcileChemicals,
  listReconciliations,
};
