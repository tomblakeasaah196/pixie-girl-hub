/**
 * Accounting & Finance (V2.2 §6.6) — bank reconciliation & tax filing service.
 *
 * Bank rec: import a statement (+lines) → open a reconciliation against a
 * fiscal period → match each statement line to a book record (payment / journal)
 * → complete. Matching a line tracks how much of it is covered; full coverage
 * flips the line to 'matched'. Tax filings: draft → reviewed → filed → paid,
 * posting a GL journal (DR tax liability / CR cash) when the filing is paid.
 */

"use strict";

const { transaction } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const repo = require("./accounting.bank.repo");
const accounting = require("./accounting.service");
const {
  NotFoundError,
  ConflictError,
  AppError,
} = require("../../utils/errors");

const A = (
  brand,
  user_id,
  action_key,
  target_type,
  target_id,
  metadata,
  request_id,
) =>
  audit({
    business: brand,
    user_id,
    action_key,
    target_type,
    target_id,
    metadata,
    request_id,
  });

// ── Bank statements ──────────────────────────────────────
async function importStatement({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const statement = await repo.createStatement({
      client,
      brand,
      row: { ...input, imported_by: user?.user_id },
    });
    const lines = [];
    for (const l of input.lines || []) {
      lines.push(
        await repo.addStatementLine({
          client,
          brand,
          line: { ...l, statement_id: statement.statement_id },
        }),
      );
    }
    await A(
      brand,
      user?.user_id,
      "bank_statement.import",
      "bank_statement",
      statement.statement_id,
      { lines: lines.length, source: statement.source },
      request_id,
    );
    return { ...statement, lines };
  });
}
const getStatement = async ({ brand, id }) => {
  const s = await repo.getStatement({ client: null, brand, id });
  if (!s) throw new NotFoundError("Bank statement not found");
  return s;
};
const listStatements = ({ brand, filters, page, page_size }) =>
  repo.listStatements({
    client: null,
    brand,
    filters,
    page,
    page_size,
    offset: (page - 1) * page_size,
  });

// ── Reconciliations ──────────────────────────────────────
async function openReconciliation({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    let period_id = input.fiscal_period_id;
    if (!period_id) {
      const period = await repo.findActivePeriod({
        client,
        brand,
        date: input.as_of_date || new Date().toISOString().slice(0, 10),
      });
      if (!period)
        throw new AppError(
          "NO_FISCAL_PERIOD",
          "No open fiscal period covers the reconciliation date",
          422,
        );
      period_id = period.period_id;
    }
    const number = await repo.nextNumber({
      client,
      brand,
      type: "bank_reconciliation",
    });
    const recon = await repo.createReconciliation({
      client,
      brand,
      row: {
        reconciliation_number: number,
        bank_account_id: input.bank_account_id,
        fiscal_period_id: period_id,
        statement_id: input.statement_id,
        book_balance_ngn: input.book_balance_ngn,
        statement_balance_ngn: input.statement_balance_ngn,
        reconciled_balance_ngn: input.book_balance_ngn,
        notes: input.notes,
      },
    });
    if (input.statement_id)
      await repo.setStatementStatus({
        client,
        brand,
        id: input.statement_id,
        status: "reconciling",
      });
    await A(
      brand,
      user?.user_id,
      "bank_reconciliation.open",
      "bank_reconciliation",
      recon.reconciliation_id,
      { number, period_id },
      request_id,
    );
    return recon;
  });
}
const getReconciliation = async ({ brand, id }) => {
  const r = await repo.getReconciliation({ client: null, brand, id });
  if (!r) throw new NotFoundError("Reconciliation not found");
  return r;
};
const listReconciliations = ({ brand, filters, page, page_size }) =>
  repo.listReconciliations({
    client: null,
    brand,
    filters,
    page,
    page_size,
    offset: (page - 1) * page_size,
  });

async function matchLine({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const recon = await repo.getReconciliation({ client, brand, id });
    if (!recon) throw new NotFoundError("Reconciliation not found");
    if (recon.status !== "in_progress")
      throw new ConflictError(
        `Cannot match against a '${recon.status}' reconciliation`,
      );
    const line = await repo.getStatementLine({
      client,
      brand,
      id: input.statement_line_id,
    });
    if (!line) throw new NotFoundError("Statement line not found");
    const match = await repo.addMatch({
      client,
      brand,
      match: {
        reconciliation_id: id,
        statement_line_id: input.statement_line_id,
        match_type: input.match_type,
        sales_order_payment_id: input.sales_order_payment_id,
        journal_entry_id: input.journal_entry_id,
        amount_matched_ngn: input.amount_matched_ngn,
        confidence: input.confidence,
        matched_by: user?.user_id,
        notes: input.notes,
      },
    });
    // Flip the statement line's status by how much of it is now covered.
    const lineAmount = Number(line.credit_amount) + Number(line.debit_amount);
    const newStatus =
      Number(input.amount_matched_ngn) >= lineAmount
        ? "matched"
        : "partially_matched";
    await repo.setStatementLineStatus({
      client,
      brand,
      statement_line_id: input.statement_line_id,
      status: newStatus,
    });
    await A(
      brand,
      user?.user_id,
      "bank_reconciliation.match",
      "bank_reconciliation",
      id,
      {
        statement_line_id: input.statement_line_id,
        match_type: input.match_type,
      },
      request_id,
    );
    return match;
  });
}

async function completeReconciliation({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const recon = await repo.getReconciliation({ client, brand, id });
    if (!recon) throw new NotFoundError("Reconciliation not found");
    if (recon.status !== "in_progress")
      throw new ConflictError(`Reconciliation is already '${recon.status}'`);
    const matched = await repo.sumMatched({
      client,
      brand,
      reconciliation_id: id,
    });
    const updated = await repo.setReconciliationStatus({
      client,
      brand,
      id,
      status: "completed",
      extra: {
        reconciled_balance_ngn: matched,
        reconciled_by: user?.user_id,
        reconciled_at: new Date().toISOString(),
      },
    });
    if (recon.statement_id)
      await repo.setStatementStatus({
        client,
        brand,
        id: recon.statement_id,
        status: "reconciled",
      });
    await A(
      brand,
      user?.user_id,
      "bank_reconciliation.complete",
      "bank_reconciliation",
      id,
      { matched, variance: updated.variance_ngn },
      request_id,
    );
    return updated;
  });
}

// ── Tax computation from the GL (policy Q14) ─────────────
// Each figure is the POSTED journal activity on the tax's own control
// account over the fiscal period, with full line-level drill-down — the
// filing is a report OF the books, never a typed-in number.
const { ACCOUNTS } = require("./posting-map");
const { money: M, toCurrencyString: S } = require("../../utils/money");
const coreRepo = require("./accounting.repo");

const TAX_DUE_DAY = { VAT: 21, PAYE: 10, WHT: 21 }; // FIRS/LIRS calendars
const DEFAULT_VAT_RATE = 0.075;

// pg returns DATE columns as JS Dates; normalise either shape to ISO.
function isoDay(value) {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

function dueDateAfter(period_ends_on, tax_type) {
  const d = new Date(`${isoDay(period_ends_on)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(TAX_DUE_DAY[tax_type] || 21);
  return d.toISOString().slice(0, 10);
}

async function computeTax({ brand, tax_type, period_id }) {
  const period = await coreRepo.getPeriod({ brand, id: period_id });
  if (!period) throw new NotFoundError("Fiscal period not found");
  const from = isoDay(period.starts_on);
  const to = isoDay(period.ends_on);
  const activity = (code) =>
    repo.taxAccountActivity({ brand, account_code: code, from, to });

  if (tax_type === "VAT") {
    const out = await activity(ACCOUNTS.VAT_OUTPUT);
    const inp = await activity(ACCOUNTS.VAT_INPUT);
    // Output accrues credit-side; the settlement journal (pay) debits it —
    // exclude tax_filing settlements so a paid prior draft doesn't zero the
    // period. Input VAT accrues debit-side.
    const output = M(out.credits);
    const input = M(inp.debits).minus(M(inp.credits));
    const net = output.minus(input);
    const lines = await repo.taxAccountLines({
      brand,
      account_codes: [ACCOUNTS.VAT_OUTPUT, ACCOUNTS.VAT_INPUT],
      from,
      to,
    });
    return {
      tax_type,
      period: { period_id, period_name: period.period_name, from, to },
      output_vat_ngn: S(output),
      input_vat_ngn: S(input),
      tax_amount_ngn: S(net),
      taxable_amount_ngn: S(output.div(DEFAULT_VAT_RATE)),
      due_date: dueDateAfter(period.ends_on, tax_type),
      lines,
    };
  }

  const code =
    tax_type === "PAYE" ? ACCOUNTS.PAYE_PAYABLE : ACCOUNTS.WHT_PAYABLE;
  const act = await activity(code);
  const accrued = M(act.credits); // settlement debits excluded from the charge
  const lines = await repo.taxAccountLines({
    brand,
    account_codes: [code],
    from,
    to,
  });
  let taxable = M(0);
  if (tax_type === "PAYE") {
    // Taxable base = gross payroll expense booked in the period.
    for (const c of [
      ACCOUNTS.SALARIES,
      ACCOUNTS.COMMISSION_EXPENSE,
      ACCOUNTS.BONUS_EXPENSE,
    ]) {
      const a = await activity(c);
      taxable = taxable.plus(M(a.debits)).minus(M(a.credits));
    }
  }
  return {
    tax_type,
    period: { period_id, period_name: period.period_name, from, to },
    tax_amount_ngn: S(accrued),
    taxable_amount_ngn: S(taxable),
    due_date: dueDateAfter(period.ends_on, tax_type),
    lines,
  };
}

/** Auto-draft a filing for a period straight from the computed GL figures. */
async function draftFilingFromPeriod({ brand, user, request_id, input }) {
  const comp = await computeTax({
    brand,
    tax_type: input.tax_type,
    period_id: input.fiscal_period_id,
  });
  return createFiling({
    brand,
    user,
    request_id,
    input: {
      tax_type: input.tax_type,
      fiscal_period_id: input.fiscal_period_id,
      taxable_amount_ngn: comp.taxable_amount_ngn,
      tax_amount_ngn: comp.tax_amount_ngn,
      due_date: comp.due_date,
      notes: `Auto-computed from GL for ${comp.period.period_name} (${comp.lines.length} journal lines)`,
    },
  });
}

// ── Tax filings ──────────────────────────────────────────
async function createFiling({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    let period_id = input.fiscal_period_id;
    if (!period_id) {
      const period = await repo.findActivePeriod({
        client,
        brand,
        date: input.due_date,
      });
      if (!period)
        throw new AppError(
          "NO_FISCAL_PERIOD",
          "No open fiscal period covers the filing due date",
          422,
        );
      period_id = period.period_id;
    }
    const number = await repo.nextNumber({ client, brand, type: "tax_filing" });
    const filing = await repo.createFiling({
      client,
      brand,
      row: {
        filing_number: number,
        tax_type: input.tax_type,
        fiscal_period_id: period_id,
        taxable_amount_ngn: input.taxable_amount_ngn,
        tax_amount_ngn: input.tax_amount_ngn,
        due_date: input.due_date,
        notes: input.notes,
      },
    });
    await A(
      brand,
      user?.user_id,
      "tax_filing.create",
      "tax_filing",
      filing.filing_id,
      { number, tax_type: filing.tax_type },
      request_id,
    );
    return filing;
  });
}
const getFiling = async ({ brand, id }) => {
  const f = await repo.getFiling({ client: null, brand, id });
  if (!f) throw new NotFoundError("Tax filing not found");
  return f;
};
const listFilings = ({ brand, filters, page, page_size }) =>
  repo.listFilings({
    client: null,
    brand,
    filters,
    page,
    page_size,
    offset: (page - 1) * page_size,
  });

async function reviewFiling({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const f = await repo.getFiling({ client, brand, id });
    if (!f) throw new NotFoundError("Tax filing not found");
    if (f.status !== "draft")
      throw new ConflictError(
        `Only a draft filing can be reviewed (is '${f.status}')`,
      );
    const updated = await repo.setFilingStatus({
      client,
      brand,
      id,
      status: "reviewed",
    });
    await A(
      brand,
      user?.user_id,
      "tax_filing.review",
      "tax_filing",
      id,
      null,
      request_id,
    );
    return updated;
  });
}
async function fileFiling({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const f = await repo.getFiling({ client, brand, id });
    if (!f) throw new NotFoundError("Tax filing not found");
    if (!["draft", "reviewed"].includes(f.status))
      throw new ConflictError(`Cannot file a '${f.status}' filing`);
    const updated = await repo.setFilingStatus({
      client,
      brand,
      id,
      status: "filed",
      extra: {
        filed_at: new Date().toISOString(),
        filed_by: user?.user_id,
        filing_reference: input?.filing_reference || null,
        filing_document_id: input?.filing_document_id || null,
      },
    });
    await A(
      brand,
      user?.user_id,
      "tax_filing.file",
      "tax_filing",
      id,
      { filing_reference: input?.filing_reference },
      request_id,
    );
    return updated;
  });
}
async function payFiling({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const f = await repo.getFiling({ client, brand, id });
    if (!f) throw new NotFoundError("Tax filing not found");
    if (f.status !== "filed")
      throw new ConflictError(
        `Only a filed filing can be paid (is '${f.status}')`,
      );
    // Settle the tax liability: DR 2100 (tax payable) / CR 1100 (cash).
    const journal = await accounting.postEntry({
      client,
      brand,
      user_id: user?.user_id,
      entry: {
        source_type: "tax_filing",
        source_table: `${brand}.tax_filings`,
        source_id: id,
        reference: f.filing_number,
        description: `${f.tax_type} remittance ${f.filing_number}`,
      },
      lines: [
        {
          account_code: "2100",
          debit_ngn: String(f.tax_amount_ngn),
          description: `${f.tax_type} payable settled`,
        },
        {
          account_code: "1100",
          credit_ngn: String(f.tax_amount_ngn),
          description: `${f.tax_type} paid`,
        },
      ],
    });
    const updated = await repo.setFilingStatus({
      client,
      brand,
      id,
      status: "paid",
      extra: {
        paid_at: new Date().toISOString(),
        payment_reference: input?.payment_reference || null,
        receipt_document_id: input?.receipt_document_id || null,
      },
    });
    await A(
      brand,
      user?.user_id,
      "tax_filing.pay",
      "tax_filing",
      id,
      {
        journal_entry_id: journal.entry_id,
        payment_reference: input?.payment_reference,
      },
      request_id,
    );
    return { ...updated, journal_entry_id: journal.entry_id };
  });
}

module.exports = {
  computeTax,
  draftFilingFromPeriod,
  importStatement,
  getStatement,
  listStatements,
  openReconciliation,
  getReconciliation,
  listReconciliations,
  matchLine,
  completeReconciliation,
  createFiling,
  getFiling,
  listFilings,
  reviewFiling,
  fileFiling,
  payFiling,
};
