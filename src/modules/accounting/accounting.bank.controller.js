/**
 * Accounting & Finance (V2.2 §6.6) — bank reconciliation & tax filing controllers.
 */

"use strict";

const service = require("./accounting.bank.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// ── Bank statements ──────────────────────────────────────
const importStatement = async (req, res) =>
  res.status(201).json({
    data: await service.importStatement({ ...base(req), input: req.body }),
  });
async function listStatements(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listStatements({
      brand: req.brand,
      filters: {
        status: req.query.status,
        bank_account_id: req.query.bank_account_id,
      },
      page,
      page_size,
    }),
  );
}
const getStatement = async (req, res) =>
  res.json({
    data: await service.getStatement({
      brand: req.brand,
      id: req.params.statementId,
    }),
  });

// ── Reconciliations ──────────────────────────────────────
const openReconciliation = async (req, res) =>
  res.status(201).json({
    data: await service.openReconciliation({ ...base(req), input: req.body }),
  });
async function listReconciliations(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listReconciliations({
      brand: req.brand,
      filters: {
        status: req.query.status,
        bank_account_id: req.query.bank_account_id,
      },
      page,
      page_size,
    }),
  );
}
const getReconciliation = async (req, res) =>
  res.json({
    data: await service.getReconciliation({
      brand: req.brand,
      id: req.params.reconId,
    }),
  });
const matchLine = async (req, res) =>
  res.status(201).json({
    data: await service.matchLine({
      ...base(req),
      id: req.params.reconId,
      input: req.body,
    }),
  });
const completeReconciliation = async (req, res) =>
  res.json({
    data: await service.completeReconciliation({
      ...base(req),
      id: req.params.reconId,
    }),
  });

// ── Tax filings ──────────────────────────────────────────
const createFiling = async (req, res) =>
  res.status(201).json({
    data: await service.createFiling({ ...base(req), input: req.body }),
  });
async function listFilings(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listFilings({
      brand: req.brand,
      filters: { status: req.query.status, tax_type: req.query.tax_type },
      page,
      page_size,
    }),
  );
}
const getFiling = async (req, res) =>
  res.json({
    data: await service.getFiling({
      brand: req.brand,
      id: req.params.filingId,
    }),
  });
const reviewFiling = async (req, res) =>
  res.json({
    data: await service.reviewFiling({ ...base(req), id: req.params.filingId }),
  });
const fileFiling = async (req, res) =>
  res.json({
    data: await service.fileFiling({
      ...base(req),
      id: req.params.filingId,
      input: req.body,
    }),
  });
const payFiling = async (req, res) =>
  res.json({
    data: await service.payFiling({
      ...base(req),
      id: req.params.filingId,
      input: req.body,
    }),
  });

// ── Tax Center (policy Q14) ──────────────────────────────
const computeTax = async (req, res) =>
  res.json({
    data: await service.computeTax({
      brand: req.brand,
      tax_type: String(req.query.tax_type || "VAT").toUpperCase(),
      period_id: req.query.period_id,
    }),
  });
const draftFilingFromPeriod = async (req, res) =>
  res.status(201).json({
    data: await service.draftFilingFromPeriod({
      ...base(req),
      input: req.body,
    }),
  });

module.exports = {
  computeTax,
  draftFilingFromPeriod,
  importStatement,
  listStatements,
  getStatement,
  openReconciliation,
  listReconciliations,
  getReconciliation,
  matchLine,
  completeReconciliation,
  createFiling,
  listFilings,
  getFiling,
  reviewFiling,
  fileFiling,
  payFiling,
};
