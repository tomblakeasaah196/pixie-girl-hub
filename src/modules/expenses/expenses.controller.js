/**
 * Expense Management (V2.2 §6.7) — HTTP controllers.
 */

"use strict";

const service = require("./expenses.service");
const aiService = require("./expenses.ai.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// Categories
const listCategories = async (req, res) =>
  res.json({ data: await service.listCategories({ brand: req.brand }) });
const createCategory = async (req, res) =>
  res.status(201).json({
    data: await service.createCategory({ ...base(req), input: req.body }),
  });
const updateCategory = async (req, res) =>
  res.json({
    data: await service.updateCategory({
      ...base(req),
      id: req.params.catId,
      patch: req.body,
    }),
  });

// Expenses
async function listExpenses(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listExpenses({
      brand: req.brand,
      scope: req.permission_scope,
      user: req.user,
      filters: {
        status: req.query.status,
        submitted_by: req.query.submitted_by,
        expense_type: req.query.expense_type,
      },
      page,
      page_size,
    }),
  );
}
const kpis = async (req, res) =>
  res.json({
    data: await service.kpis({
      brand: req.brand,
      scope: req.permission_scope,
      user: req.user,
    }),
  });
const getById = async (req, res) =>
  res.json({
    data: await service.getById({
      brand: req.brand,
      id: req.params.id,
      scope: req.permission_scope,
      user: req.user,
    }),
  });
const createExpense = async (req, res) =>
  res.status(201).json({
    data: await service.createExpense({ ...base(req), input: req.body }),
  });
const submit = async (req, res) =>
  res.json({ data: await service.submit({ ...base(req), id: req.params.id }) });
const approve = async (req, res) =>
  res.json({
    data: await service.approve({
      ...base(req),
      id: req.params.id,
      notes: req.body.notes,
    }),
  });
const reject = async (req, res) =>
  res.json({
    data: await service.reject({
      ...base(req),
      id: req.params.id,
      reason: req.body.reason,
    }),
  });
const markPaid = async (req, res) =>
  res.json({
    data: await service.markPaid({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });

// Receipt AI (multipart: receipt `file` + optional voice `audio` + `note`).
// Returns a SUGGESTED draft only — writes nothing. The client reviews it, then
// the normal create → submit path does the actual write.
async function extractReceipt(req, res) {
  const file = req.files && req.files.file && req.files.file[0];
  const audio = req.files && req.files.audio && req.files.audio[0];
  if (!file)
    return res.status(400).json({
      error: {
        code: "NO_FILE",
        message: "Multipart field 'file' (the receipt) is required",
      },
      request_id: req.request_id,
    });
  res.json({
    data: await aiService.extractFromReceipt({
      brand: req.brand,
      user: req.user,
      file,
      audio,
      note: req.body.note,
    }),
  });
}

// Cash advances
async function listAdvances(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listAdvances({
      brand: req.brand,
      scope: req.permission_scope,
      user: req.user,
      filters: {
        status: req.query.status,
        requested_by: req.query.requested_by,
      },
      page,
      page_size,
    }),
  );
}
const getAdvance = async (req, res) =>
  res.json({
    data: await service.getAdvance({
      brand: req.brand,
      id: req.params.advId,
      scope: req.permission_scope,
      user: req.user,
    }),
  });
const requestAdvance = async (req, res) =>
  res.status(201).json({
    data: await service.requestAdvance({ ...base(req), input: req.body }),
  });
const approveAdvance = async (req, res) =>
  res.json({
    data: await service.approveAdvance({
      ...base(req),
      id: req.params.advId,
      approved_amount_ngn: req.body.approved_amount_ngn,
      notes: req.body.notes,
    }),
  });
const rejectAdvance = async (req, res) =>
  res.json({
    data: await service.rejectAdvance({
      ...base(req),
      id: req.params.advId,
      reason: req.body.reason,
    }),
  });
const disburseAdvance = async (req, res) =>
  res.json({
    data: await service.disburseAdvance({
      ...base(req),
      id: req.params.advId,
      input: req.body,
    }),
  });
const settleAdvance = async (req, res) =>
  res.status(201).json({
    data: await service.settleAdvance({
      ...base(req),
      id: req.params.advId,
      input: req.body,
    }),
  });

// Receipts (multipart → Documents gateway)
const listReceipts = async (req, res) =>
  res.json({
    data: await service.listReceipts({
      brand: req.brand,
      id: req.params.id,
      scope: req.permission_scope,
      user: req.user,
    }),
  });
async function addReceipt(req, res) {
  if (!req.file)
    return res.status(400).json({
      error: {
        code: "NO_FILE",
        message: "Multipart field 'file' is required",
      },
      request_id: req.request_id,
    });
  res.status(201).json({
    data: await service.addReceipt({
      ...base(req),
      id: req.params.id,
      file: req.file,
      meta: req.body,
    }),
  });
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  listExpenses,
  kpis,
  getById,
  createExpense,
  submit,
  approve,
  reject,
  markPaid,
  extractReceipt,
  listAdvances,
  getAdvance,
  requestAdvance,
  approveAdvance,
  rejectAdvance,
  disburseAdvance,
  settleAdvance,
  listReceipts,
  addReceipt,
};
