/**
 * Expense Management (V2.2 §6.7) — business logic.
 * Flow: draft → submit (opens approval workflow) → approve (posts the GL
 * journal via accounting.postEntry) → paid. Reject sends it back. This is the
 * "workflow update in one module drives a write in another" pattern.
 */

"use strict";

const repo = require("./expenses.repo");
const events = require("./expenses.events");
const wf = require("../../workflows/engine");
const accounting = require("../accounting/accounting.service");
const documents = require("../../shared/documents/documents.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");

const REFERENCE_TABLE = "expenses";
const A = (brand, user_id, action_key, target_id, after, request_id) =>
  audit({
    business: brand,
    user_id,
    action_key,
    target_type: "expense",
    target_id,
    after,
    request_id,
  });

// ── Categories ───────────────────────────────────────────
const listCategories = ({ brand }) => repo.listCategories({ brand });
async function createCategory({ brand, user, request_id, input }) {
  const cat = await repo.createCategory({ brand, input });
  await A(
    brand,
    user.user_id,
    "expenses.category.create",
    cat.category_id,
    cat,
    request_id,
  );
  return cat;
}
async function updateCategory({ brand, user, request_id, id, patch }) {
  const cat = await repo.updateCategory({ brand, id, patch });
  if (!cat) throw new NotFoundError("Category");
  await A(brand, user.user_id, "expenses.category.update", id, cat, request_id);
  return cat;
}

// ── Expenses ─────────────────────────────────────────────
function listExpenses({ brand, scope, user, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  const f = { ...filters };
  if (scope === "own") f.submitted_by = user.user_id;
  return repo.listExpenses({ brand, filters: f, page, page_size, offset });
}
async function getById({ brand, id }) {
  const e = await repo.findById({ brand, id });
  if (!e) throw new NotFoundError("Expense");
  return e;
}

async function createExpense({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    let total = money(0),
      vat = money(0);
    const lineRows = [];
    for (const [idx, l] of input.lines.entries()) {
      const cat = await repo.getCategory({ client, brand, id: l.category_id });
      if (!cat)
        throw new AppError(
          "REFERENCE_INVALID",
          `Category ${l.category_id} not found`,
          409,
        );
      total = total.plus(money(l.amount_ngn));
      vat = vat.plus(money(l.vat_amount_ngn || 0));
      lineRows.push({
        category_id: l.category_id,
        description: l.description,
        amount_ngn: toCurrencyString(money(l.amount_ngn)),
        vat_amount_ngn: toCurrencyString(money(l.vat_amount_ngn || 0)),
        wht_amount_ngn: toCurrencyString(money(l.wht_amount_ngn || 0)),
        vendor_name: l.vendor_name,
        vendor_tin: l.vendor_tin,
        receipt_date: l.receipt_date,
        account_id: l.account_id || cat.default_account_id,
        project: l.project,
        cost_centre: l.cost_centre,
        display_order: idx,
      });
    }
    const expense_number = await repo.nextNumber({ client, brand });
    const exp = await repo.createExpense({
      client,
      brand,
      header: {
        expense_number,
        expense_type: input.expense_type || "reimbursement",
        submitted_by: user.user_id,
        advance_id: input.advance_id,
        title: input.title,
        expense_date: input.expense_date,
        description: input.description,
        total_amount_ngn: toCurrencyString(total),
        vat_amount_ngn: toCurrencyString(vat),
        original_currency: input.original_currency,
        original_amount: input.original_amount,
        fx_rate_used: input.fx_rate_used,
        status: "draft",
      },
    });
    for (const lr of lineRows)
      await repo.insertLine({
        client,
        brand,
        line: { ...lr, expense_id: exp.expense_id },
      });
    await A(
      brand,
      user.user_id,
      "expenses.create",
      exp.expense_id,
      { expense_number },
      request_id,
    );
    events.emit("created", { brand, id: exp.expense_id });
    return repo.findById({ client, brand, id: exp.expense_id });
  });
}

async function submit({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const exp = await repo.findById({ client, brand, id });
    if (!exp) throw new NotFoundError("Expense");
    if (exp.status !== "draft")
      throw new AppError(
        "INVALID_STATE",
        `Cannot submit a '${exp.status}' expense`,
        409,
      );
    const instance = await wf.openInstance({
      client,
      business: brand,
      trigger_module: "expenses",
      trigger_action: "submit",
      reference_table: REFERENCE_TABLE,
      reference_id: id,
      opened_by: user.user_id,
      context: {
        expense_number: exp.expense_number,
        total_ngn: exp.total_amount_ngn,
      },
    });
    const updated = await repo.setStatus({
      client,
      brand,
      id,
      status: "pending",
      extra: { workflow_instance_id: instance.instance_id },
    });
    await A(
      brand,
      user.user_id,
      "expenses.submit",
      id,
      { status: "pending", workflow_instance_id: instance.instance_id },
      request_id,
    );
    events.emit("submitted", { brand, id });
    return updated;
  });
}

async function approve({ brand, user, request_id, id, notes }) {
  return transaction(async (client) => {
    const exp = await repo.findById({ client, brand, id });
    if (!exp) throw new NotFoundError("Expense");
    if (exp.status !== "pending")
      throw new AppError(
        "INVALID_STATE",
        `Cannot approve a '${exp.status}' expense`,
        409,
      );

    const instance = await wf.findOpenInstance({
      client,
      business: brand,
      reference_table: REFERENCE_TABLE,
      reference_id: id,
    });
    if (instance)
      await wf.act({
        client,
        instance_id: instance.instance_id,
        user,
        action: "approve",
        notes,
      });

    // Cross-module: post the expense to the general ledger.
    const lines = [];
    for (const l of exp.lines) {
      if (!l.account_id)
        throw new AppError(
          "ACCOUNT_REQUIRED",
          `Expense line has no GL account (set category default)`,
          409,
        );
      lines.push({
        account_id: l.account_id,
        debit_ngn: l.amount_ngn,
        description: l.description,
        project: l.project,
        cost_centre: l.cost_centre,
      });
    }
    const vat = money(exp.vat_amount_ngn);
    if (vat.gt(0))
      lines.push({
        account_code: "2110",
        debit_ngn: toCurrencyString(vat),
        description: "VAT input",
      });
    const cashOut = money(exp.total_amount_ngn).plus(vat);
    lines.push({
      account_code: "1100",
      credit_ngn: toCurrencyString(cashOut),
      description: `Expense ${exp.expense_number}`,
    });

    const journal = await accounting.postEntry({
      client,
      brand,
      user_id: user.user_id,
      entry: {
        source_type: "expense",
        source_table: REFERENCE_TABLE,
        source_id: id,
        reference: exp.expense_number,
        description: `Expense ${exp.expense_number}: ${exp.title}`,
      },
      lines,
    });

    const updated = await repo.setStatus({
      client,
      brand,
      id,
      status: "approved",
      extra: {
        approved_by: user.user_id,
        approved_at: new Date().toISOString(),
        journal_entry_id: journal.entry_id,
      },
    });
    await A(
      brand,
      user.user_id,
      "expenses.approve",
      id,
      { status: "approved", journal_entry_id: journal.entry_id },
      request_id,
    );
    events.emit("approved", { brand, id, journal_entry_id: journal.entry_id });
    return updated;
  });
}

async function reject({ brand, user, request_id, id, reason }) {
  return transaction(async (client) => {
    const exp = await repo.findById({ client, brand, id });
    if (!exp) throw new NotFoundError("Expense");
    if (exp.status !== "pending")
      throw new AppError(
        "INVALID_STATE",
        `Cannot reject a '${exp.status}' expense`,
        409,
      );
    const instance = await wf.findOpenInstance({
      client,
      business: brand,
      reference_table: REFERENCE_TABLE,
      reference_id: id,
    });
    if (instance)
      await wf.act({
        client,
        instance_id: instance.instance_id,
        user,
        action: "reject",
        notes: reason,
      });
    const updated = await repo.setStatus({
      client,
      brand,
      id,
      status: "rejected",
      extra: {
        rejected_at: new Date().toISOString(),
        rejection_reason: reason || null,
      },
    });
    await A(
      brand,
      user.user_id,
      "expenses.reject",
      id,
      { status: "rejected" },
      request_id,
    );
    events.emit("rejected", { brand, id });
    return updated;
  });
}

async function markPaid({ brand, user, request_id, id, input }) {
  const exp = await repo.findById({ brand, id });
  if (!exp) throw new NotFoundError("Expense");
  if (exp.status !== "approved")
    throw new AppError(
      "INVALID_STATE",
      `Only approved expenses can be paid (is '${exp.status}')`,
      409,
    );
  const updated = await repo.setStatus({
    brand,
    id,
    status: "paid",
    extra: {
      paid_at: new Date().toISOString(),
      paid_by: user.user_id,
      payment_method: input.payment_method,
      payment_reference: input.payment_reference,
    },
  });
  await A(
    brand,
    user.user_id,
    "expenses.pay",
    id,
    { status: "paid", method: input.payment_method },
    request_id,
  );
  events.emit("paid", { brand, id });
  return updated;
}

// ── Cash advances (request → approve → disburse → settle) ──
function listAdvances({ brand, scope, user, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  const f = { ...filters };
  if (scope === "own") f.requested_by = user.user_id;
  return repo.listAdvances({ brand, filters: f, page, page_size, offset });
}
async function getAdvance({ brand, id }) {
  const a = await repo.getAdvance({ brand, id });
  if (!a) throw new NotFoundError("Cash advance");
  return a;
}
async function requestAdvance({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const advance_number = await repo.nextAdvanceNumber({ client, brand });
    const adv = await repo.createAdvance({
      client,
      brand,
      user_id: user.user_id,
      advance: { ...input, advance_number },
    });
    const instance = await wf.openInstance({
      client,
      business: brand,
      trigger_module: "expenses",
      trigger_action: "submit",
      reference_table: "cash_advances",
      reference_id: adv.advance_id,
      opened_by: user.user_id,
      context: {
        advance_number,
        requested_amount_ngn: adv.requested_amount_ngn,
      },
    });
    await repo.setAdvanceStatus({
      client,
      brand,
      id: adv.advance_id,
      status: "pending",
      extra: { workflow_instance_id: instance.instance_id },
    });
    await A(
      brand,
      user.user_id,
      "expenses.advance.request",
      adv.advance_id,
      { advance_number },
      request_id,
    );
    events.emit("advance.requested", { brand, id: adv.advance_id });
    return repo.getAdvance({ client, brand, id: adv.advance_id });
  });
}
async function approveAdvance({
  brand,
  user,
  request_id,
  id,
  approved_amount_ngn,
  notes,
}) {
  return transaction(async (client) => {
    const adv = await repo.getAdvance({ client, brand, id });
    if (!adv) throw new NotFoundError("Cash advance");
    if (adv.status !== "pending")
      throw new AppError(
        "INVALID_STATE",
        `Cannot approve a '${adv.status}' advance`,
        409,
      );
    const instance = await wf.findOpenInstance({
      client,
      business: brand,
      reference_table: "cash_advances",
      reference_id: id,
    });
    if (instance)
      await wf.act({
        client,
        instance_id: instance.instance_id,
        user,
        action: "approve",
        notes,
      });
    const updated = await repo.setAdvanceStatus({
      client,
      brand,
      id,
      status: "approved",
      extra: {
        approved_amount_ngn: approved_amount_ngn ?? adv.requested_amount_ngn,
        approved_by: user.user_id,
        approved_at: new Date().toISOString(),
      },
    });
    await A(
      brand,
      user.user_id,
      "expenses.advance.approve",
      id,
      { status: "approved" },
      request_id,
    );
    events.emit("advance.approved", { brand, id });
    return updated;
  });
}
async function rejectAdvance({ brand, user, request_id, id, reason }) {
  return transaction(async (client) => {
    const adv = await repo.getAdvance({ client, brand, id });
    if (!adv) throw new NotFoundError("Cash advance");
    if (adv.status !== "pending")
      throw new AppError(
        "INVALID_STATE",
        `Cannot reject a '${adv.status}' advance`,
        409,
      );
    const instance = await wf.findOpenInstance({
      client,
      business: brand,
      reference_table: "cash_advances",
      reference_id: id,
    });
    if (instance)
      await wf.act({
        client,
        instance_id: instance.instance_id,
        user,
        action: "reject",
        notes: reason,
      });
    const updated = await repo.setAdvanceStatus({
      client,
      brand,
      id,
      status: "rejected",
      extra: {
        rejected_at: new Date().toISOString(),
        rejection_reason: reason || null,
      },
    });
    await A(
      brand,
      user.user_id,
      "expenses.advance.reject",
      id,
      { status: "rejected" },
      request_id,
    );
    return updated;
  });
}
async function disburseAdvance({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const adv = await repo.getAdvance({ client, brand, id });
    if (!adv) throw new NotFoundError("Cash advance");
    if (adv.status !== "approved")
      throw new AppError(
        "INVALID_STATE",
        `Only approved advances can be disbursed (is '${adv.status}')`,
        409,
      );
    const amount = toCurrencyString(
      money(adv.approved_amount_ngn || adv.requested_amount_ngn),
    );
    // DR Cash Advances Issued (1410), CR Cash/Bank (1100).
    const journal = await accounting.postEntry({
      client,
      brand,
      user_id: user.user_id,
      entry: {
        source_type: "expense",
        source_table: "cash_advances",
        source_id: id,
        reference: adv.advance_number,
        description: `Cash advance ${adv.advance_number}`,
      },
      lines: [
        {
          account_code: "1410",
          debit_ngn: amount,
          description: "Cash advance issued",
          contact_id: null,
        },
        {
          account_code: "1100",
          credit_ngn: amount,
          description: "Cash disbursed",
        },
      ],
    });
    const updated = await repo.setAdvanceStatus({
      client,
      brand,
      id,
      status: "disbursed",
      extra: {
        disbursed_by: user.user_id,
        disbursed_at: new Date().toISOString(),
        disbursement_method: input.disbursement_method,
        disbursement_reference: input.disbursement_reference,
        disbursement_journal_id: journal.entry_id,
      },
    });
    await A(
      brand,
      user.user_id,
      "expenses.advance.disburse",
      id,
      { status: "disbursed", journal_entry_id: journal.entry_id },
      request_id,
    );
    events.emit("advance.disbursed", { brand, id });
    return updated;
  });
}
async function settleAdvance({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const adv = await repo.getAdvance({ client, brand, id });
    if (!adv) throw new NotFoundError("Cash advance");
    if (adv.status !== "disbursed")
      throw new AppError(
        "INVALID_STATE",
        `Only disbursed advances can be settled (is '${adv.status}')`,
        409,
      );
    const settlement = await repo.createSettlement({
      client,
      brand,
      user_id: user.user_id,
      settlement: {
        advance_id: id,
        expense_id: input.expense_id,
        amount_settled_ngn: input.amount_settled_ngn,
        change_returned_ngn: input.change_returned_ngn || 0,
        shortfall_ngn: input.shortfall_ngn || 0,
        notes: input.notes,
      },
    });
    const updated = await repo.setAdvanceStatus({
      client,
      brand,
      id,
      status: "settled",
    });
    await A(
      brand,
      user.user_id,
      "expenses.advance.settle",
      id,
      { status: "settled", settlement_id: settlement.settlement_id },
      request_id,
    );
    events.emit("advance.settled", { brand, id });
    return { ...updated, settlement };
  });
}

// ── Expense receipts (file → Documents gateway, §6.13) ───
async function listReceipts({ brand, id }) {
  await getById({ brand, id });
  return repo.listReceipts({ brand, expense_id: id });
}
async function addReceipt({ brand, user, request_id, id, file, meta }) {
  const exp = await repo.findById({ brand, id });
  if (!exp) throw new NotFoundError("Expense");
  return transaction(async (client) => {
    const doc = await documents.store({
      client,
      brand,
      user_id: user.user_id,
      buffer: file.buffer,
      filename: file.originalname,
      mime_type: file.mimetype,
      document_type: "expense_receipt",
      title: meta.vendor_name || file.originalname,
      reference_type: "expense",
      reference_id: id,
      request_id,
    });
    const receipt = await repo.addReceipt({
      client,
      brand,
      receipt: {
        expense_id: id,
        expense_line_id: meta.expense_line_id,
        document_id: doc.document_id,
        amount_on_receipt_ngn: meta.amount_on_receipt_ngn,
        receipt_date: meta.receipt_date,
        vendor_name: meta.vendor_name,
        uploaded_by: user.user_id,
      },
    });
    await A(
      brand,
      user.user_id,
      "expenses.receipt.add",
      id,
      { receipt_id: receipt.receipt_id, document_id: doc.document_id },
      request_id,
    );
    return { ...receipt, document_url: doc.url };
  });
}

module.exports = {
  listCategories,
  createCategory,
  updateCategory,
  listExpenses,
  getById,
  createExpense,
  submit,
  approve,
  reject,
  markPaid,
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
