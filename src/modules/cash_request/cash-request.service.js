/**
 * Cash Request & Disbursement (V2.2 §6.32) — business logic.
 *
 * The 4-stage workflow:
 *   draft → pending_finance → (pending_ceo) → approved → disbursed → settled
 *
 *   STAGE 1  submit          User submits            → pending_finance
 *   STAGE 2  financeDecision Finance validates       → pending_ceo (>= threshold)
 *                                                       OR approved (< threshold)
 *   STAGE 3  ceoDecision     CEO approves            → approved
 *   STAGE 4  disburse        Finance sends money     → disbursed
 *                            (mandatory bank_transaction_id; posts GL;
 *                             auto-creates an Expense for direct spends)
 *   POST     settle          Receipts returned       → settled (advances)
 *
 * Separation of duties: the threshold (business_config) decides whether the
 * CEO must co-approve. Disbursement always requires the bank transaction ID
 * as the audit anchor (also DB-trigger enforced).
 */

"use strict";

const repo = require("./cash-request.repo");
const events = require("./cash-request.events");
const accounting = require("../accounting/accounting.service");
const expensesRepo = require("../expenses/expenses.repo");
const businessConfig = require("../business_setup/business-config.repo");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");

const CASH_ACCOUNT_CODE = "1100"; // Bank — Operating Account (NGN)
const ADVANCE_ACCOUNT_CODE = "1410"; // Cash Advances Issued (asset)

const A = (brand, user, action_key, target_id, after, request_id) =>
  audit({
    business: brand,
    user_id: user.user_id,
    action_key,
    target_type: "cash_request",
    target_id,
    after,
    request_id,
  });

async function load({ client, brand, id }) {
  const cr = await repo.findById({ client, brand, id });
  if (!cr) throw new NotFoundError("CashRequest");
  return cr;
}

function ensureStatus(cr, allowed) {
  if (!allowed.includes(cr.status))
    throw new AppError(
      "INVALID_STATE",
      `A '${cr.status}' cash request does not allow this action`,
      409,
    );
}

async function transition({
  client,
  brand,
  user,
  request_id,
  cr,
  to_status,
  fields = {},
  notes,
  decision,
  action_key,
}) {
  const updated = await repo.updateStatus({
    client,
    brand,
    id: cr.cash_request_id,
    status: to_status,
    fields,
  });
  await repo.insertStateHistory({
    client,
    cash_request_id: cr.cash_request_id,
    from_status: cr.status,
    to_status,
    changed_by: user.user_id,
    notes,
    amount_snapshot_ngn: cr.amount_requested_ngn,
    decision_snapshot: decision,
  });
  await A(
    brand,
    user,
    action_key,
    cr.cash_request_id,
    { from: cr.status, to: to_status, decision },
    request_id,
  );
  events.emit(to_status, {
    brand,
    id: cr.cash_request_id,
    status: to_status,
    user_id: user.user_id,
    submitted_by: cr.submitted_by,
  });
  return updated;
}

// ── Reads ──────────────────────────────────────────────────
function list({ brand, user, scope, filters, page, page_size }) {
  return repo.findAll({
    brand,
    scope,
    user_id: user.user_id,
    filters,
    page,
    page_size,
  });
}

async function getById({ brand, id }) {
  return load({ brand, id });
}

// ── Stage 0: create draft ──────────────────────────────────
async function create({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const request_number = await repo.nextNumber({ client, brand });
    const requiresSettlement =
      input.requires_settlement ??
      ["self_cash", "petty_cash"].includes(input.recipient_type);
    const created = await repo.create({
      client,
      brand,
      row: {
        request_number,
        submitted_by: user.user_id,
        category_key: input.category_key,
        category_display: input.category_display,
        purpose: input.purpose,
        needed_by_date: input.needed_by_date || null,
        urgency: input.urgency || "normal",
        amount_requested_ngn: input.amount_requested_ngn,
        currency_code: input.currency_code || "NGN",
        fx_rate_used: input.fx_rate_used || null,
        display_amount: input.display_amount || null,
        recipient_type: input.recipient_type,
        recipient_name: input.recipient_name || null,
        recipient_bank_name: input.recipient_bank_name || null,
        recipient_account_number: input.recipient_account_number || null,
        recipient_account_name: input.recipient_account_name || null,
        requires_settlement: requiresSettlement,
        settlement_required_by: input.settlement_required_by || null,
        status: "draft",
      },
    });
    await repo.insertStateHistory({
      client,
      cash_request_id: created.cash_request_id,
      from_status: null,
      to_status: "draft",
      changed_by: user.user_id,
      amount_snapshot_ngn: created.amount_requested_ngn,
    });
    await A(
      brand,
      user,
      "cash_request.create",
      created.cash_request_id,
      { request_number, amount_requested_ngn: created.amount_requested_ngn },
      request_id,
    );
    events.emit("created", {
      brand,
      id: created.cash_request_id,
      user_id: user.user_id,
    });
    return created;
  });
}

// ── Stage 1: submit (draft | sent_back → pending_finance) ──
async function submit({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const cr = await load({ client, brand, id });
    ensureStatus(cr, ["draft", "sent_back"]);
    return transition({
      client,
      brand,
      user,
      request_id,
      cr,
      to_status: "pending_finance",
      action_key: "cash_request.submit",
    });
  });
}

// ── Stage 2: Finance decision ──────────────────────────────
async function financeDecision({
  brand,
  user,
  request_id,
  id,
  decision,
  notes,
}) {
  return transaction(async (client) => {
    const cr = await load({ client, brand, id });
    ensureStatus(cr, ["pending_finance"]);

    const stamp = {
      finance_reviewed_by: user.user_id,
      finance_reviewed_at: new Date().toISOString(),
      finance_decision: decision,
      finance_notes: notes || null,
    };

    if (decision === "reject")
      return transition({
        client,
        brand,
        user,
        request_id,
        cr,
        to_status: "rejected",
        fields: stamp,
        notes,
        decision,
        action_key: "cash_request.finance_reject",
      });

    if (decision === "send_back")
      return transition({
        client,
        brand,
        user,
        request_id,
        cr,
        to_status: "sent_back",
        fields: stamp,
        notes,
        decision,
        action_key: "cash_request.finance_send_back",
      });

    // approve: route on the CEO threshold.
    const cfg = await businessConfig.findByKey(brand);
    const threshold = money(cfg?.cash_request_ceo_threshold_ngn ?? 100000);
    const requiresCeo = money(cr.amount_requested_ngn).gte(threshold);
    const fields = {
      ...stamp,
      requires_ceo_approval: requiresCeo,
      ceo_threshold_at_submit_ngn: toCurrencyString(threshold),
    };
    return transition({
      client,
      brand,
      user,
      request_id,
      cr,
      to_status: requiresCeo ? "pending_ceo" : "approved",
      fields,
      notes,
      decision,
      action_key: "cash_request.finance_approve",
    });
  });
}

// ── Stage 3: CEO decision ──────────────────────────────────
async function ceoDecision({ brand, user, request_id, id, decision, notes }) {
  return transaction(async (client) => {
    const cr = await load({ client, brand, id });
    ensureStatus(cr, ["pending_ceo"]);
    const stamp = {
      ceo_decided_by: user.user_id,
      ceo_decided_at: new Date().toISOString(),
      ceo_decision: decision,
      ceo_notes: notes || null,
    };
    const to_status =
      decision === "approve"
        ? "approved"
        : decision === "send_back"
          ? "sent_back"
          : "rejected";
    return transition({
      client,
      brand,
      user,
      request_id,
      cr,
      to_status,
      fields: stamp,
      notes,
      decision,
      action_key: `cash_request.ceo_${decision}`,
    });
  });
}

// ── Stage 4: disburse (approved → disbursed) ───────────────
async function disburse({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const cr = await load({ client, brand, id });
    ensureStatus(cr, ["approved"]);
    if (!input.bank_transaction_id)
      throw new AppError(
        "TRANSACTION_ID_REQUIRED",
        "A bank transaction ID is mandatory to disburse (V2.2 §6.32)",
        422,
      );

    const amountDisbursed = money(
      input.amount_disbursed_ngn ?? cr.amount_requested_ngn,
    );

    // GL: money leaves the bank. A settlement-bound advance is held as an
    // asset (Cash Advances Issued); a direct spend hits its category expense
    // account (fallback to the advance account if the category has none).
    const cat = await repo.findExpenseCategory({
      client,
      brand,
      category_key: cr.category_key,
    });
    const debitLine = cr.requires_settlement
      ? { account_code: ADVANCE_ACCOUNT_CODE }
      : cat && cat.default_account_id
        ? { account_id: cat.default_account_id }
        : { account_code: ADVANCE_ACCOUNT_CODE };

    const journal = await accounting.postEntry({
      client,
      brand,
      user_id: user.user_id,
      entry: {
        source_type: "expense",
        source_table: "shared.cash_requests",
        source_id: cr.cash_request_id,
        reference: cr.request_number,
        description: `Cash Request ${cr.request_number}: ${cr.purpose}`,
      },
      lines: [
        {
          ...debitLine,
          debit_ngn: toCurrencyString(amountDisbursed),
          description: `Disbursement ${cr.request_number}`,
        },
        {
          account_code: CASH_ACCOUNT_CODE,
          credit_ngn: toCurrencyString(amountDisbursed),
          description: `Cash out ${cr.request_number}`,
        },
      ],
    });

    // Direct (non-settlement) disbursements land here as an Expense (§6.7).
    let linkedExpenseId = null;
    if (!cr.requires_settlement) {
      const expenseNumber = await expensesRepo.nextNumber({ client, brand });
      const expense = await expensesRepo.createExpense({
        client,
        brand,
        header: {
          expense_number: expenseNumber,
          expense_type: "direct_invoice",
          submitted_by: cr.submitted_by,
          title: `Cash Request ${cr.request_number}: ${cr.purpose}`,
          expense_date: new Date().toISOString().slice(0, 10),
          description: cr.purpose,
          total_amount_ngn: toCurrencyString(amountDisbursed),
          status: "paid",
        },
      });
      linkedExpenseId = expense.expense_id;
    }

    const updated = await transition({
      client,
      brand,
      user,
      request_id,
      cr,
      to_status: "disbursed",
      fields: {
        disbursed_by: user.user_id,
        disbursed_at: new Date().toISOString(),
        bank_transaction_id: input.bank_transaction_id,
        bank_transaction_date: input.bank_transaction_date || null,
        bank_name: input.bank_name || null,
        amount_disbursed_ngn: toCurrencyString(amountDisbursed),
        disbursement_notes: input.disbursement_notes || null,
        linked_journal_entry_id: journal.entry_id,
        linked_expense_id: linkedExpenseId,
      },
      notes: input.disbursement_notes,
      action_key: "cash_request.disburse",
    });
    events.emit("disbursed", {
      brand,
      id: cr.cash_request_id,
      bank_transaction_id: input.bank_transaction_id,
      amount_disbursed_ngn: toCurrencyString(amountDisbursed),
      journal_entry_id: journal.entry_id,
      linked_expense_id: linkedExpenseId,
    });
    return updated;
  });
}

// ── Settlement (disbursed → settled), for cash advances ────
async function settle({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const cr = await load({ client, brand, id });
    ensureStatus(cr, ["disbursed"]);
    if (!cr.requires_settlement)
      throw new AppError(
        "SETTLEMENT_NOT_REQUIRED",
        "This cash request is a direct disbursement, not a settleable advance",
        409,
      );

    const disbursed = money(cr.amount_disbursed_ngn || cr.amount_requested_ngn);
    const receipts = money(input.settled_total_receipts_ngn || 0);
    const unsettled = disbursed.minus(receipts);

    // Reclassify the settled portion off the advance asset into the category
    // expense account (DR expense / CR Cash Advances Issued).
    if (receipts.gt(0)) {
      const cat = await repo.findExpenseCategory({
        client,
        brand,
        category_key: cr.category_key,
      });
      const debitLine =
        cat && cat.default_account_id
          ? { account_id: cat.default_account_id }
          : { account_code: ADVANCE_ACCOUNT_CODE };
      await accounting.postEntry({
        client,
        brand,
        user_id: user.user_id,
        entry: {
          source_type: "expense",
          source_table: "shared.cash_requests",
          source_id: cr.cash_request_id,
          reference: cr.request_number,
          description: `Advance settlement ${cr.request_number}`,
        },
        lines: [
          {
            ...debitLine,
            debit_ngn: toCurrencyString(receipts),
            description: `Settled ${cr.request_number}`,
          },
          {
            account_code: ADVANCE_ACCOUNT_CODE,
            credit_ngn: toCurrencyString(receipts),
            description: `Clear advance ${cr.request_number}`,
          },
        ],
      });
    }

    // Realise the settled spend as an Expense so a settled advance lists under
    // Expenses exactly like a direct disbursement does (§6.7). Only once, and
    // only for the portion actually spent (receipts).
    let linkedExpenseId = cr.linked_expense_id || null;
    if (receipts.gt(0) && !linkedExpenseId) {
      const expenseNumber = await expensesRepo.nextNumber({ client, brand });
      const expense = await expensesRepo.createExpense({
        client,
        brand,
        header: {
          expense_number: expenseNumber,
          expense_type: "direct_invoice",
          submitted_by: cr.submitted_by,
          title: `Cash Request ${cr.request_number}: ${cr.purpose}`,
          expense_date: new Date().toISOString().slice(0, 10),
          description: cr.purpose,
          total_amount_ngn: toCurrencyString(receipts),
          status: "paid",
        },
      });
      linkedExpenseId = expense.expense_id;
    }

    return transition({
      client,
      brand,
      user,
      request_id,
      cr,
      to_status: "settled",
      fields: {
        settled_at: new Date().toISOString(),
        settled_total_receipts_ngn: toCurrencyString(receipts),
        unsettled_balance_ngn: toCurrencyString(unsettled),
        linked_expense_id: linkedExpenseId,
      },
      notes: input.notes,
      action_key: "cash_request.settle",
    });
  });
}

// ── Cancel (any pre-disbursement state) ────────────────────
async function cancel({ brand, user, request_id, id, reason }) {
  return transaction(async (client) => {
    const cr = await load({ client, brand, id });
    ensureStatus(cr, [
      "draft",
      "pending_finance",
      "pending_ceo",
      "approved",
      "sent_back",
    ]);
    return transition({
      client,
      brand,
      user,
      request_id,
      cr,
      to_status: "cancelled",
      fields: {
        cancelled_by: user.user_id,
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason || null,
      },
      notes: reason,
      action_key: "cash_request.cancel",
    });
  });
}

// ── Documents ─────────────────────────────────────────────
async function addDocument({
  brand,
  user,
  request_id,
  id,
  document_id,
  document_role,
  notes,
}) {
  const cr = await load({ brand, id });
  const doc = await repo.insertDocument({
    cash_request_id: cr.cash_request_id,
    document_id,
    document_role: document_role || "other",
    uploaded_by: user.user_id,
    notes,
  });
  await A(
    brand,
    user,
    "cash_request.document.add",
    cr.cash_request_id,
    { document_id, document_role },
    request_id,
  );
  return doc;
}

async function listDocuments({ brand, id }) {
  await load({ brand, id });
  return repo.listDocuments({ brand, cash_request_id: id });
}

// ── History timeline ──────────────────────────────────────
async function getHistory({ brand, id }) {
  await load({ brand, id });
  return repo.getHistory({ cash_request_id: id });
}

// ── KPIs ──────────────────────────────────────────────────
function kpis({ brand, user, scope }) {
  return repo.kpis({ brand, scope, user_id: user.user_id });
}

module.exports = {
  list,
  getById,
  create,
  submit,
  financeDecision,
  ceoDecision,
  disburse,
  settle,
  cancel,
  addDocument,
  listDocuments,
  getHistory,
  kpis,
};
