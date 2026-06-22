/**
 * Payroll operations controller (V2.2 §6.11) — Pass 2. HTTP only.
 */

"use strict";

const service = require("./payroll.service");

function pageArgs(req) {
  return {
    filters: req.query,
    page: parseInt(req.query.page || "1", 10),
    page_size: Math.min(parseInt(req.query.page_size || "50", 10), 1000),
  };
}
const ctx = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// runs
async function listRuns(req, res) {
  res.json(await service.listRuns({ brand: req.brand, ...pageArgs(req) }));
}
async function getRun(req, res) {
  res.json({
    data: await service.getRun({ brand: req.brand, run_id: req.params.id }),
  });
}
async function createRun(req, res) {
  res
    .status(201)
    .json({ data: await service.createRun({ ...ctx(req), input: req.body }) });
}
async function calculateRun(req, res) {
  res.json({
    data: await service.calculateRun({ ...ctx(req), run_id: req.params.id }),
  });
}
async function reviewRun(req, res) {
  res.json({
    data: await service.reviewRun({ ...ctx(req), run_id: req.params.id }),
  });
}
async function approveRun(req, res) {
  res.json({
    data: await service.approveRun({ ...ctx(req), run_id: req.params.id }),
  });
}
async function payRun(req, res) {
  res.json({
    data: await service.payRun({
      ...ctx(req),
      run_id: req.params.id,
      pin: req.body && req.body.pin,
    }),
  });
}
async function reverseRun(req, res) {
  res.json({
    data: await service.reverseRun({ ...ctx(req), run_id: req.params.id }),
  });
}

// payslips
async function listPayslips(req, res) {
  res.json(await service.listPayslips({ brand: req.brand, ...pageArgs(req) }));
}
async function getPayslip(req, res) {
  res.json({
    data: await service.getPayslip({
      brand: req.brand,
      payslip_id: req.params.id,
    }),
  });
}
async function payslipPdf(req, res) {
  res.status(201).json({
    data: await service.payslipPdf({
      brand: req.brand,
      user: req.user,
      payslip_id: req.params.id,
    }),
  });
}

// commissions
async function listCommissions(req, res) {
  res.json(
    await service.listCommissions({ brand: req.brand, ...pageArgs(req) }),
  );
}
async function accrueCommission(req, res) {
  res.status(201).json({
    data: await service.accrueCommission({ ...ctx(req), input: req.body }),
  });
}
async function approveCommission(req, res) {
  res.json({
    data: await service.approveCommission({
      ...ctx(req),
      earning_id: req.params.id,
    }),
  });
}
async function reverseCommission(req, res) {
  res.json({
    data: await service.reverseCommission({
      ...ctx(req),
      earning_id: req.params.id,
    }),
  });
}

// bonuses
async function listBonuses(req, res) {
  res.json(await service.listBonuses({ brand: req.brand, ...pageArgs(req) }));
}
async function awardBonus(req, res) {
  res
    .status(201)
    .json({ data: await service.awardBonus({ ...ctx(req), input: req.body }) });
}
async function decideBonus(req, res) {
  res.json({
    data: await service.decideBonus({
      ...ctx(req),
      bonus_id: req.params.id,
      decision: req.body.decision,
      reason: req.body.reason,
    }),
  });
}
async function reverseBonus(req, res) {
  res.json({
    data: await service.reverseBonus({ ...ctx(req), bonus_id: req.params.id }),
  });
}

module.exports = {
  listRuns,
  getRun,
  createRun,
  calculateRun,
  reviewRun,
  approveRun,
  payRun,
  reverseRun,
  listPayslips,
  getPayslip,
  payslipPdf,
  listCommissions,
  accrueCommission,
  approveCommission,
  reverseCommission,
  listBonuses,
  awardBonus,
  decideBonus,
  reverseBonus,
};
