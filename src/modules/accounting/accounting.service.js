/**
 * Accounting & Finance (V2.2 §6.6) — business logic.
 *
 * `postEntry` is THE canonical write path for the general ledger. Every other
 * module (Sales, Invoicing, Expenses, Purchasing, Payroll) posts journals by
 * calling it — never by touching journal_entries / journal_lines directly.
 * It resolves account codes → ids, asserts debits = credits, resolves the
 * open fiscal period, writes the entry + lines, then flips status to 'posted'
 * (the DB trigger re-checks the balance and locks the entry).
 */

"use strict";

const repo = require("./accounting.repo");
const events = require("./accounting.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");
const pdf = require("../../services/pdf.service");

async function resolveAccountId({ client, brand, line }) {
  if (line.account_id) return line.account_id;
  if (line.account_code) {
    const acc = await repo.getAccountByCode({
      client,
      brand,
      code: line.account_code,
    });
    if (!acc)
      throw new AppError(
        "ACCOUNT_NOT_FOUND",
        `No postable account for code ${line.account_code}`,
        409,
      );
    return acc.account_id;
  }
  throw new AppError(
    "ACCOUNT_REQUIRED",
    "Each journal line needs account_id or account_code",
    400,
  );
}

/**
 * Post a balanced journal entry. Accepts an optional `client` so callers can
 * post inside their own transaction (atomic with the source record).
 */
async function postEntry({ client, brand, entry, lines, user_id }) {
  const run = async (c) => {
    // Opt-in idempotency (P1-3): a caller posting under at-least-once
    // delivery (or a retried request) passes its own globally-unique key.
    // Pre-check here; the unique index is the race backstop below.
    if (entry.idempotency_key) {
      const existing = await repo.findEntryByIdempotencyKey({
        client: c,
        brand,
        idempotency_key: entry.idempotency_key,
      });
      if (existing) return repo.findEntryById({ client: c, brand, id: existing.entry_id });
    }
    if (!Array.isArray(lines) || lines.length < 2) {
      throw new AppError(
        "INVALID_JOURNAL",
        "A journal entry needs at least two lines",
        400,
      );
    }
    let dr = money(0),
      cr = money(0);
    const resolved = [];
    for (const [idx, line] of lines.entries()) {
      const account_id = await resolveAccountId({ client: c, brand, line });
      const debit = money(line.debit_ngn || 0);
      const credit = money(line.credit_ngn || 0);
      dr = dr.plus(debit);
      cr = cr.plus(credit);
      resolved.push({
        ...line,
        account_id,
        debit_ngn: toCurrencyString(debit),
        credit_ngn: toCurrencyString(credit),
        display_order: idx,
      });
    }
    if (dr.minus(cr).abs().gt(money("0.01"))) {
      throw new AppError(
        "JOURNAL_UNBALANCED",
        `Debits (${toCurrencyString(dr)}) != credits (${toCurrencyString(cr)})`,
        409,
      );
    }

    const posting_date =
      entry.posting_date || new Date().toISOString().slice(0, 10);
    const period = await repo.findActivePeriod({
      client: c,
      brand,
      date: posting_date,
    });
    if (!period)
      throw new AppError(
        "NO_OPEN_PERIOD",
        `No open fiscal period for ${posting_date}`,
        409,
      );

    const entry_number = await repo.nextEntryNumber({ client: c, brand });
    const created = await repo.insertEntry({
      client: c,
      brand,
      entry: {
        entry_number,
        source_type: entry.source_type,
        source_table: entry.source_table,
        source_id: entry.source_id,
        fiscal_period_id: period.period_id,
        posting_date,
        transaction_currency: entry.transaction_currency,
        fx_rate_used: entry.fx_rate_used,
        description: entry.description,
        reference: entry.reference,
        idempotency_key: entry.idempotency_key,
      },
    });
    if (!created) {
      // Lost the race to a concurrent post under the same idempotency_key —
      // the unique index rejected us (ON CONFLICT DO NOTHING, no exception).
      // That post already completed lines/status/audit/event; just return it.
      const existing = await repo.findEntryByIdempotencyKey({
        client: c,
        brand,
        idempotency_key: entry.idempotency_key,
      });
      return repo.findEntryById({ client: c, brand, id: existing.entry_id });
    }
    for (const line of resolved)
      await repo.insertLine({
        client: c,
        brand,
        line: { ...line, entry_id: created.entry_id },
      });
    await repo.setEntryStatus({
      client: c,
      brand,
      id: created.entry_id,
      status: "posted",
      user_id,
    });
    await audit({
      business: brand,
      user_id,
      action_key: "accounting.journal.post",
      target_type: "journal_entry",
      target_id: created.entry_id,
      after: { entry_number, total: toCurrencyString(dr) },
    });
    events.emit("journal.posted", {
      brand,
      entry_id: created.entry_id,
      source_type: entry.source_type,
    });
    return repo.findEntryById({ client: c, brand, id: created.entry_id });
  };
  return client ? run(client) : transaction(run);
}

async function reverseEntry({ brand, user, request_id, id, reason }) {
  return transaction(async (client) => {
    const original = await repo.findEntryById({ client, brand, id });
    if (!original) throw new NotFoundError("Journal entry");
    if (original.status !== "posted")
      throw new AppError(
        "INVALID_STATE",
        `Cannot reverse a ${original.status} entry`,
        409,
      );
    const reversal = await postEntry({
      client,
      brand,
      user_id: user.user_id,
      entry: {
        source_type: "reversal",
        source_table: "journal_entries",
        source_id: id,
        description: `Reversal of ${original.entry_number}: ${reason || ""}`,
        reference: original.entry_number,
        posting_date: new Date().toISOString().slice(0, 10),
      },
      lines: original.lines.map((l) => ({
        account_id: l.account_id,
        debit_ngn: l.credit_ngn,
        credit_ngn: l.debit_ngn,
        contact_id: l.contact_id,
      })),
    });
    await repo.setEntryReversed({
      client,
      brand,
      id,
      reversal_entry_id: reversal.entry_id,
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "accounting.journal.reverse",
      target_type: "journal_entry",
      target_id: id,
      after: { reversal_entry_id: reversal.entry_id },
      request_id,
    });
    return reversal;
  });
}

// Manual journal (controller-driven)
async function createManualJournal({ brand, user, request_id, input }) {
  const entry = await postEntry({
    brand,
    user_id: user.user_id,
    entry: {
      source_type: "manual",
      description: input.description,
      reference: input.reference,
      posting_date: input.posting_date,
    },
    lines: input.lines,
  });
  void request_id;
  return entry;
}

// ── Reads + COA / periods management ─────────────────────
const listGroups = ({ brand }) => repo.listGroups({ brand });
const updateGroup = ({ brand, id, input }) =>
  repo.updateGroup({ brand, id, patch: input });
const listAccounts = ({ brand, filters }) =>
  repo.listAccounts({ brand, filters });
async function getAccount({ brand, id }) {
  const a = await repo.getAccount({ brand, id });
  if (!a) throw new NotFoundError("Account");
  return a;
}
async function createAccount({ brand, user, request_id, input }) {
  const a = await repo.createAccount({ brand, input });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "accounting.account.create",
    target_type: "chart_of_accounts",
    target_id: a.account_id,
    after: a,
    request_id,
  });
  return a;
}
async function updateAccount({ brand, user, request_id, id, patch }) {
  const a = await repo.updateAccount({ brand, id, patch });
  if (!a) throw new NotFoundError("Account");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "accounting.account.update",
    target_type: "chart_of_accounts",
    target_id: id,
    after: a,
    request_id,
  });
  return a;
}
const listPeriods = ({ brand }) => repo.listPeriods({ brand });
async function createPeriod({ brand, user, request_id, input }) {
  const p = await repo.createPeriod({ brand, input });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "accounting.period.create",
    target_type: "fiscal_period",
    target_id: p.period_id,
    after: p,
    request_id,
  });
  return p;
}
async function closePeriod({ brand, user, request_id, id }) {
  const p = await repo.closePeriod({ brand, id, user_id: user.user_id });
  if (!p) throw new NotFoundError("Period");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "accounting.period.close",
    target_type: "fiscal_period",
    target_id: id,
    after: { status: "closed" },
    request_id,
  });
  return p;
}
/** Source-record → journal lookup (e.g. invoice → its accrual entry). */
function findEntryBySource({ brand, source_type, source_id }) {
  return repo.findEntryBySource({ brand, source_type, source_id });
}
function listJournals({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listEntries({ brand, filters, page, page_size, offset });
}
async function getJournal({ brand, id }) {
  const e = await repo.findEntryById({ brand, id });
  if (!e) throw new NotFoundError("Journal entry");
  return e;
}

// ── Financial reports (V2.2 §6.6) ────────────────────────
function rowBalance(r) {
  const debit = money(r.debit_ngn);
  const credit = money(r.credit_ngn);
  return r.normal_balance === "debit"
    ? debit.minus(credit)
    : credit.minus(debit);
}

async function trialBalance({ brand, as_of }) {
  const rows = await repo.accountActivity({ brand, to: as_of || null });
  let totalDebit = money(0),
    totalCredit = money(0);
  const accounts = rows.map((r) => {
    const debit = money(r.debit_ngn),
      credit = money(r.credit_ngn);
    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
    return {
      account_code: r.account_code,
      account_name: r.account_name,
      group_type: r.group_type,
      debit_ngn: toCurrencyString(debit),
      credit_ngn: toCurrencyString(credit),
    };
  });
  return {
    as_of: as_of || new Date().toISOString().slice(0, 10),
    accounts,
    total_debit_ngn: toCurrencyString(totalDebit),
    total_credit_ngn: toCurrencyString(totalCredit),
    balanced: totalDebit.minus(totalCredit).abs().lte(money("0.01")),
  };
}

async function profitAndLoss({ brand, from, to }) {
  const rows = await repo.accountActivity({ brand, from, to });
  const revenue = [],
    expenses = [];
  let revTotal = money(0),
    expTotal = money(0);
  for (const r of rows) {
    if (r.statement !== "income_statement") continue;
    const bal = rowBalance(r);
    const item = {
      account_code: r.account_code,
      account_name: r.account_name,
      amount_ngn: toCurrencyString(bal),
    };
    if (["revenue", "contra_revenue"].includes(r.group_type)) {
      revenue.push(item);
      revTotal = revTotal.plus(bal);
    } else if (r.group_type === "expense") {
      expenses.push(item);
      expTotal = expTotal.plus(bal);
    }
  }
  return {
    period: { from, to },
    revenue,
    total_revenue_ngn: toCurrencyString(revTotal),
    expenses,
    total_expenses_ngn: toCurrencyString(expTotal),
    net_profit_ngn: toCurrencyString(revTotal.minus(expTotal)),
  };
}

async function balanceSheet({ brand, as_of }) {
  const rows = await repo.accountActivity({ brand, to: as_of || null });
  const assets = [],
    liabilities = [],
    equity = [];
  let aT = money(0),
    lT = money(0),
    eT = money(0);
  for (const r of rows) {
    if (r.statement !== "balance_sheet") continue;
    const bal = rowBalance(r);
    const item = {
      account_code: r.account_code,
      account_name: r.account_name,
      amount_ngn: toCurrencyString(bal),
    };
    if (["asset", "contra_asset"].includes(r.group_type)) {
      assets.push(item);
      aT = aT.plus(bal);
    } else if (r.group_type === "liability") {
      liabilities.push(item);
      lT = lT.plus(bal);
    } else if (r.group_type === "equity") {
      equity.push(item);
      eT = eT.plus(bal);
    }
  }
  return {
    as_of: as_of || new Date().toISOString().slice(0, 10),
    assets,
    total_assets_ngn: toCurrencyString(aT),
    liabilities,
    total_liabilities_ngn: toCurrencyString(lT),
    equity,
    total_equity_ngn: toCurrencyString(eT),
    balanced: aT.minus(lT.plus(eT)).abs().lte(money("0.01")),
  };
}

// Map each journal source_type to a cash-flow activity bucket.
const SOURCE_ACTIVITY = {
  sales: "operating",
  pos: "operating",
  invoice: "operating",
  payment: "operating",
  purchase: "operating",
  goods_received: "operating",
  payroll: "operating",
  expense: "operating",
  tax_filing: "operating",
  refund: "operating",
  accrual: "operating",
  fx_revaluation: "operating",
  manual: "operating",
  stock_adjustment: "operating",
  reversal: "operating",
  closing: "operating",
  depreciation: "investing",
  intercompany: "financing",
  opening_balance: "financing",
};

function addDaysISO(isoDate, delta) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Cash Flow statement (V2.2 §6.6) — direct method. Net cash movement per
 * period grouped into operating / investing / financing by journal
 * source_type, reconciled against opening and closing cash balances.
 */
async function cashFlow({ brand, from, to }) {
  const rows = await repo.cashFlowByActivity({ brand, from, to });
  const buckets = { operating: [], investing: [], financing: [] };
  const totals = {
    operating: money(0),
    investing: money(0),
    financing: money(0),
  };
  for (const r of rows) {
    const activity = SOURCE_ACTIVITY[r.source_type] || "operating";
    const amt = money(r.cash_delta_ngn);
    buckets[activity].push({
      source_type: r.source_type,
      amount_ngn: toCurrencyString(amt),
    });
    totals[activity] = totals[activity].plus(amt);
  }
  const netChange = totals.operating
    .plus(totals.investing)
    .plus(totals.financing);

  const opening = from
    ? money(await repo.cashBalanceAsOf({ brand, as_of: addDaysISO(from, -1) }))
    : money(0);
  const closing = money(
    await repo.cashBalanceAsOf({ brand, as_of: to || null }),
  );

  return {
    period: { from: from || null, to: to || null },
    operating: {
      lines: buckets.operating,
      total_ngn: toCurrencyString(totals.operating),
    },
    investing: {
      lines: buckets.investing,
      total_ngn: toCurrencyString(totals.investing),
    },
    financing: {
      lines: buckets.financing,
      total_ngn: toCurrencyString(totals.financing),
    },
    net_change_ngn: toCurrencyString(netChange),
    opening_cash_ngn: toCurrencyString(opening),
    closing_cash_ngn: toCurrencyString(closing),
    reconciled: opening.plus(netChange).minus(closing).abs().lte(money("0.01")),
  };
}

const { ACCOUNTS } = require("./posting-map");
const FX_GAIN_ACCOUNT = ACCOUNTS.FX_GAIN_REALISED;
const FX_LOSS_ACCOUNT = ACCOUNTS.FX_LOSS_REALISED;
const CASH_BANK_ACCOUNT = ACCOUNTS.BANK_MAIN;

/**
 * Post a realised FX gain/loss (V2.2 §6.6). `delta_ngn` is the NGN variance
 * vs the booked rate: positive = we received more NGN than booked (gain),
 * negative = a loss. No-op for a zero delta. Pass a client to run inside the
 * caller's transaction.
 */
async function postFxGainLoss({
  client,
  brand,
  delta_ngn,
  reference,
  description,
  source_id,
  user_id,
  idempotency_key,
}) {
  const delta = money(delta_ngn);
  if (delta.abs().lte(money("0.01"))) return null;
  const amount = toCurrencyString(delta.abs());
  const lines = delta.gt(0)
    ? [
        { account_code: CASH_BANK_ACCOUNT, debit_ngn: amount, description },
        { account_code: FX_GAIN_ACCOUNT, credit_ngn: amount, description },
      ]
    : [
        { account_code: FX_LOSS_ACCOUNT, debit_ngn: amount, description },
        { account_code: CASH_BANK_ACCOUNT, credit_ngn: amount, description },
      ];
  return postEntry({
    client,
    brand,
    user_id,
    entry: {
      source_type: "fx_revaluation",
      source_table: "sales_order_payments",
      source_id: source_id || null,
      reference,
      description:
        description || `Realised FX ${delta.gt(0) ? "gain" : "loss"}`,
      idempotency_key,
    },
    lines,
  });
}

function summariseAgeing(rows, as_of) {
  const buckets = {
    b_0_30: money(0),
    b_31_60: money(0),
    b_61_90: money(0),
    b_90_plus: money(0),
  };
  let grand = money(0);
  const parties = rows.map((r) => {
    buckets.b_0_30 = buckets.b_0_30.plus(money(r.b_0_30));
    buckets.b_31_60 = buckets.b_31_60.plus(money(r.b_31_60));
    buckets.b_61_90 = buckets.b_61_90.plus(money(r.b_61_90));
    buckets.b_90_plus = buckets.b_90_plus.plus(money(r.b_90_plus));
    grand = grand.plus(money(r.total_ngn));
    return {
      party_id: r.party_id,
      party_name: r.party_name,
      total_ngn: toCurrencyString(money(r.total_ngn)),
      current_0_30_ngn: toCurrencyString(money(r.b_0_30)),
      days_31_60_ngn: toCurrencyString(money(r.b_31_60)),
      days_61_90_ngn: toCurrencyString(money(r.b_61_90)),
      days_90_plus_ngn: toCurrencyString(money(r.b_90_plus)),
    };
  });
  return {
    as_of: as_of || new Date().toISOString().slice(0, 10),
    parties,
    totals: {
      current_0_30_ngn: toCurrencyString(buckets.b_0_30),
      days_31_60_ngn: toCurrencyString(buckets.b_31_60),
      days_61_90_ngn: toCurrencyString(buckets.b_61_90),
      days_90_plus_ngn: toCurrencyString(buckets.b_90_plus),
      total_ngn: toCurrencyString(grand),
    },
  };
}

/**
 * AR ageing (V2.2 §6.5/6.6) — open customer balances bucketed by age off the
 * live balance due.
 */
async function receivablesAgeing({ brand, as_of }) {
  const rows = await repo.receivablesAgeing({ brand, as_of });
  return summariseAgeing(rows, as_of);
}

/** AP ageing — open supplier balances bucketed by age. */
async function payablesAgeing({ brand, as_of }) {
  const rows = await repo.payablesAgeing({ brand, as_of });
  return summariseAgeing(rows, as_of);
}

// ── FX Period-End Revaluation (F-9) ──────────────────────
const UNREALISED_FX_GAIN = ACCOUNTS.FX_GAIN_UNREALISED;
const UNREALISED_FX_LOSS = ACCOUNTS.FX_LOSS_UNREALISED;

/**
 * Run a period-end FX revaluation. For every FX-denominated account with a
 * balance in the given period, restate the NGN equivalent at the new_rates and
 * post a single balanced journal entry.
 *
 * @param {Object} input.new_rates  - e.g. { "USD": 1600, "GBP": 2000 }
 */
async function runRevaluation({
  brand,
  user,
  request_id,
  period_id,
  reval_date,
  new_rates,
}) {
  return transaction(async (client) => {
    const period = await repo.getPeriod({ client, brand, id: period_id });
    if (!period) throw new NotFoundError("Fiscal period");
    if (!["open", "adjusted", "closing"].includes(period.status))
      throw new AppError(
        "PERIOD_CLOSED",
        "Period is not open for posting",
        409,
      );

    const accounts = await repo.listFxAccountBalances({
      client,
      brand,
      period_id,
    });
    if (accounts.length === 0)
      throw new AppError(
        "NO_FX_ACCOUNTS",
        "No FX-denominated accounts with balances in this period",
        409,
      );

    const run = await repo.insertRevalRun({
      client,
      brand,
      run: {
        fiscal_period_id: period_id,
        reval_date: reval_date || new Date().toISOString().slice(0, 10),
        rates_used: new_rates,
        run_by: user.user_id,
      },
    });

    let totalGain = money(0);
    let totalLoss = money(0);
    const journalLines = [];

    for (const acc of accounts) {
      const currency = acc.account_currency;
      const newRate = new_rates[currency];
      if (!newRate)
        throw new AppError(
          "RATE_MISSING",
          `No new rate provided for currency ${currency}`,
          400,
        );

      const balanceInCurrency = money(acc.closing_balance_in_currency || 0);
      const oldNgn = money(acc.closing_balance_ngn || 0);

      // old rate: compute from last run or derive from current balance
      let oldRate;
      const lastReval = await repo.findLastRevalRate({
        client,
        brand,
        account_id: acc.account_id,
      });
      if (lastReval) {
        oldRate = parseFloat(lastReval.new_rate);
      } else if (balanceInCurrency.gt(0) && oldNgn.gt(0)) {
        oldRate = parseFloat(toCurrencyString(oldNgn.div(balanceInCurrency)));
      } else {
        oldRate = parseFloat(newRate);
      }

      const newNgn = balanceInCurrency.times(money(newRate));
      const delta = newNgn.minus(oldNgn);
      const deltaStr = toCurrencyString(delta.abs());
      const impactType = delta.gt(money("0.01"))
        ? "gain"
        : delta.lt(money("-0.01"))
          ? "loss"
          : "no_change";

      await repo.insertRevalEntry({
        client,
        brand,
        entry: {
          run_id: run.run_id,
          account_id: acc.account_id,
          account_currency: currency,
          balance_in_currency: toCurrencyString(balanceInCurrency),
          old_rate: oldRate,
          new_rate: parseFloat(newRate),
          old_ngn_equivalent: toCurrencyString(oldNgn),
          new_ngn_equivalent: toCurrencyString(newNgn),
          delta_ngn: toCurrencyString(delta),
        },
      });

      if (impactType === "gain") {
        totalGain = totalGain.plus(delta);
        journalLines.push({
          account_id: acc.account_id,
          debit_ngn: deltaStr,
          description: `FX reval ${currency}→NGN (gain)`,
        });
        journalLines.push({
          account_code: UNREALISED_FX_GAIN,
          credit_ngn: deltaStr,
          description: `FX reval ${currency}→NGN (gain)`,
        });
      } else if (impactType === "loss") {
        totalLoss = totalLoss.plus(delta.abs());
        journalLines.push({
          account_code: UNREALISED_FX_LOSS,
          debit_ngn: deltaStr,
          description: `FX reval ${currency}→NGN (loss)`,
        });
        journalLines.push({
          account_id: acc.account_id,
          credit_ngn: deltaStr,
          description: `FX reval ${currency}→NGN (loss)`,
        });
      }
    }

    let journalEntry = null;
    if (journalLines.length >= 2) {
      journalEntry = await postEntry({
        client,
        brand,
        user_id: user.user_id,
        entry: {
          source_type: "fx_revaluation",
          source_table: "fx_revaluation_runs",
          source_id: run.run_id,
          posting_date: reval_date || new Date().toISOString().slice(0, 10),
          description: `Period-end FX revaluation — ${period.period_name}`,
          reference: `REVAL-${period.fiscal_year}-${String(period.period_number).padStart(2, "0")}`,
        },
        lines: journalLines,
      });
    }

    const updated = await repo.updateRevalRun({
      client,
      brand,
      id: run.run_id,
      patch: {
        total_gain_ngn: toCurrencyString(totalGain),
        total_loss_ngn: toCurrencyString(totalLoss),
        journal_entry_id: journalEntry?.entry_id || null,
        status: journalEntry ? "posted" : "draft",
        posted_at: journalEntry ? new Date().toISOString() : null,
      },
    });

    audit({
      business: brand,
      user_id: user.user_id,
      action_key: "accounting.fx_revaluation.run",
      target_type: "fx_revaluation_run",
      target_id: run.run_id,
      after: {
        period_id,
        total_gain: toCurrencyString(totalGain),
        total_loss: toCurrencyString(totalLoss),
      },
      request_id,
    });

    return repo.getRevalRun({ client, brand, id: updated.run_id });
  });
}

function listRevaluationRuns({ brand, page = 1, page_size = 20 }) {
  const offset = (page - 1) * page_size;
  return repo.listRevalRuns({ brand, page, page_size, offset });
}

async function getRevaluationRun({ brand, id }) {
  const run = await repo.getRevalRun({ brand, id });
  if (!run) throw new NotFoundError("FX revaluation run");
  return run;
}

async function reverseRevaluation({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const run = await repo.getRevalRun({ client, brand, id });
    if (!run) throw new NotFoundError("FX revaluation run");
    if (run.status !== "posted")
      throw new AppError(
        "INVALID_STATE",
        `Cannot reverse a '${run.status}' run`,
        409,
      );
    if (run.journal_entry_id) {
      await reverseEntry({
        client,
        brand,
        user,
        id: run.journal_entry_id,
        reason: "FX revaluation reversal",
        request_id,
      });
    }
    const updated = await repo.updateRevalRun({
      client,
      brand,
      id,
      patch: { status: "reversed" },
    });
    audit({
      business: brand,
      user_id: user.user_id,
      action_key: "accounting.fx_revaluation.reverse",
      target_type: "fx_revaluation_run",
      target_id: id,
      after: { status: "reversed" },
      request_id,
    });
    return updated;
  });
}

/**
 * Customer/supplier statement → PDF (§6.6 / 4.2). Pulls posted journal lines for
 * the contact over [from, to], computes a running balance (decimal.js), and
 * persists the rendered statement via Documents.
 */
async function statementPdf({ brand, user, contact_id, from, to, party_type }) {
  const raw = await repo.contactStatement({ brand, contact_id, from, to });
  let running = money(0);
  const entries = raw.map((e) => {
    running = running
      .plus(money(e.debit_ngn || 0))
      .minus(money(e.credit_ngn || 0));
    return {
      date: e.date,
      description: e.description,
      debit_ngn: e.debit_ngn,
      credit_ngn: e.credit_ngn,
      balance_ngn: toCurrencyString(running),
    };
  });
  const party_name = await repo.contactName({ contact_id });
  const { statementHtml } = require("../../services/pdf.templates");
  return pdf.renderAndStore({
    brand,
    user_id: user ? user.user_id : null,
    html: statementHtml({
      brand,
      statement: {
        party_type: party_type === "supplier" ? "supplier" : "customer",
        party_name,
        from,
        to,
        entries,
        closing_balance_ngn: toCurrencyString(running),
      },
    }),
    title: `Statement ${party_name || contact_id}`,
    document_type: "statement",
    reference_type: "contact",
    reference_id: contact_id,
  });
}

module.exports = {
  postEntry,
  reverseEntry,
  createManualJournal,
  statementPdf,
  listGroups,
  updateGroup,
  listAccounts,
  getAccount,
  createAccount,
  updateAccount,
  listPeriods,
  createPeriod,
  closePeriod,
  listJournals,
  getJournal,
  findEntryBySource,
  trialBalance,
  profitAndLoss,
  balanceSheet,
  cashFlow,
  receivablesAgeing,
  payablesAgeing,
  postFxGainLoss,
  runRevaluation,
  listRevaluationRuns,
  getRevaluationRun,
  reverseRevaluation,
};
