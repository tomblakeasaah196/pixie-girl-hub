/**
 * Point of Sale (V2.2 §6.3) — service.
 *
 * Terminals + staff PINs are admin config. A cashier opens a SESSION on a
 * terminal (one open session per terminal), then CHECKS OUT: each checkout
 * creates a canonical sales_order (sales_channel='pos') through the Sales
 * module, records split payments (which, once the order is paid in full, drives
 * stock deduction + GL posting + auto-invoice via the existing order.paid
 * spine), and stores POS context in pos_transactions + pos_payment_splits.
 * Closing a session produces the Z-report (pos_session_summary) with cash
 * variance. PINs are bcrypt-hashed and never returned.
 */

"use strict";

const bcrypt = require("bcrypt");
const { transaction } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const { money, toCurrencyString } = require("../../utils/money");
const repo = require("./pos.repo");
const events = require("./pos.events");
const salesService = require("../sales/sales.service");
const {
  NotFoundError,
  ConflictError,
  ValidationError,
  AppError,
} = require("../../utils/errors");

const PIN_SALT_ROUNDS = 10;
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 30;

// POS split method → sales_order_payments.method (voucher has no sales equivalent).
const SALES_METHOD = {
  cash: "cash",
  paystack_card: "paystack_card",
  paystack_transfer: "paystack_transfer",
  opay: "opay",
  nomba_terminal: "nomba_terminal",
  bank_transfer: "bank_transfer",
  points: "points",
  wallet: "wallet",
  voucher: "wallet",
};

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

// ── Terminals ────────────────────────────────────────────
async function createTerminal({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const terminal = await repo.createTerminal({ client, brand, row: input });
    await A(
      brand,
      user?.user_id,
      "pos.terminal.create",
      "pos_terminal",
      terminal.terminal_id,
      { terminal_code: terminal.terminal_code },
      request_id,
    );
    return terminal;
  });
}
async function getTerminal({ brand, id }) {
  const terminal = await repo.getTerminal({ client: null, brand, id });
  if (!terminal) throw new NotFoundError("Terminal not found");
  return terminal;
}
const listTerminals = ({ brand, is_active }) =>
  repo.listTerminals({ client: null, brand, is_active });
async function updateTerminal({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const existing = await repo.getTerminal({ client, brand, id });
    if (!existing) throw new NotFoundError("Terminal not found");
    const terminal = await repo.updateTerminal({
      client,
      brand,
      id,
      patch: input,
    });
    await A(
      brand,
      user?.user_id,
      "pos.terminal.update",
      "pos_terminal",
      id,
      { fields: Object.keys(input) },
      request_id,
    );
    return terminal;
  });
}

// ── PIN credentials (never return the PIN/hash) ──────────
async function setPin({
  brand,
  user,
  request_id,
  target_user_id,
  pin,
  must_change_pin = false,
}) {
  if (!/^\d{4,6}$/.test(String(pin)))
    throw new ValidationError("PIN must be 4–6 digits");
  return transaction(async (client) => {
    const pin_hash = await bcrypt.hash(String(pin), PIN_SALT_ROUNDS);
    const cred = await repo.upsertPin({
      client,
      brand,
      user_id: target_user_id,
      pin_hash,
      must_change_pin,
    });
    await A(
      brand,
      user?.user_id,
      "pos.pin.set",
      "pos_pin_credential",
      cred.credential_id,
      { user_id: target_user_id },
      request_id,
    );
    return {
      user_id: cred.user_id,
      is_active: cred.is_active,
      must_change_pin: cred.must_change_pin,
    };
  });
}
async function verifyPin({ brand, user_id, pin }) {
  const cred = await repo.getPinByUser({ client: null, brand, user_id });
  if (!cred || !cred.is_active)
    throw new AppError("PIN_NOT_SET", "No active POS PIN for this user", 401);
  if (cred.locked_until && new Date(cred.locked_until) > new Date()) {
    throw new AppError("PIN_LOCKED", "POS PIN is locked; try again later", 423);
  }
  const ok = await bcrypt.compare(String(pin), cred.pin_hash);
  return transaction(async (client) => {
    if (!ok) {
      const attempts = (cred.failed_attempts || 0) + 1;
      const locked_until =
        attempts >= MAX_PIN_ATTEMPTS
          ? new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString()
          : null;
      await repo.setPinState({
        client,
        brand,
        user_id,
        patch: { failed_attempts: attempts, locked_until },
      });
      throw new AppError("PIN_INVALID", "Incorrect POS PIN", 401);
    }
    await repo.setPinState({
      client,
      brand,
      user_id,
      patch: {
        failed_attempts: 0,
        locked_until: null,
        last_used_at: new Date().toISOString(),
      },
    });
    return { verified: true, must_change_pin: cred.must_change_pin };
  });
}

// ── Sessions ─────────────────────────────────────────────
async function openSession({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const terminal = await repo.getTerminal({
      client,
      brand,
      id: input.terminal_id,
    });
    if (!terminal) throw new NotFoundError("Terminal not found");
    const open = await repo.findOpenSessionForTerminal({
      client,
      brand,
      terminal_id: input.terminal_id,
    });
    if (open)
      throw new ConflictError("This terminal already has an open session");
    const session_number = await repo.nextNumber({
      client,
      brand,
      type: "pos_session",
    });
    const session = await repo.createSession({
      client,
      brand,
      row: {
        session_number,
        terminal_id: input.terminal_id,
        staff_user_id: user?.user_id,
        opening_cash_ngn:
          input.opening_cash_ngn ?? terminal.opening_cash_float_ngn,
      },
    });
    await A(
      brand,
      user?.user_id,
      "pos.session.open",
      "pos_session",
      session.session_id,
      { session_number, terminal_id: input.terminal_id },
      request_id,
    );
    events.emit("session.opened", { brand, session_id: session.session_id });
    return session;
  });
}
async function getSession({ brand, id }) {
  const session = await repo.getSession({ client: null, brand, id });
  if (!session) throw new NotFoundError("Session not found");
  return session;
}
const listSessions = ({ brand, filters, page, page_size }) =>
  repo.listSessions({
    client: null,
    brand,
    filters,
    page,
    page_size,
    offset: (page - 1) * page_size,
  });

async function closeSession({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const session = await repo.getSession({ client, brand, id });
    if (!session) throw new NotFoundError("Session not found");
    if (!["open", "closing"].includes(session.status))
      throw new ConflictError(`Cannot close a '${session.status}' session`);
    const agg = await repo.aggregateSession({ client, brand, session_id: id });
    const dropsTotal = await repo.sumDrops({ client, brand, session_id: id });
    const opening = money(session.opening_cash_ngn);
    const cashCollected = money(agg.cash_collected_ngn);
    const expected = opening.plus(cashCollected).minus(money(dropsTotal));
    const declared =
      input.closing_cash_declared !== undefined
        ? money(input.closing_cash_declared)
        : null;
    const variance = declared ? declared.minus(expected) : null;
    if (variance && !variance.eq(0) && !input.variance_explanation) {
      throw new ValidationError(
        "A variance explanation is required when declared cash differs from expected",
      );
    }
    await repo.upsertSummary({
      client,
      brand,
      session_id: id,
      row: {
        total_transactions: agg.total_transactions,
        walk_in_transactions: agg.walk_in_transactions,
        dispatch_transactions: agg.dispatch_transactions,
        void_transactions: agg.void_transactions,
        refund_transactions: agg.refund_transactions,
        gross_sales_ngn: agg.gross_sales_ngn,
        discounts_given_ngn: agg.discounts_given_ngn,
        tax_collected_ngn: agg.tax_collected_ngn,
        net_sales_ngn: agg.net_sales_ngn,
        cash_collected_ngn: agg.cash_collected_ngn,
        card_collected_ngn: agg.card_collected_ngn,
        transfer_collected_ngn: agg.transfer_collected_ngn,
        points_redeemed_ngn: agg.points_redeemed_ngn,
        other_collected_ngn: agg.other_collected_ngn,
        opening_float_ngn: toCurrencyString(opening),
        cash_drops_total_ngn: toCurrencyString(money(dropsTotal)),
        expected_in_drawer: toCurrencyString(expected),
        declared_in_drawer: declared ? toCurrencyString(declared) : null,
        variance_ngn: variance ? toCurrencyString(variance) : null,
        unique_customers: agg.unique_customers,
      },
    });
    const updated = await repo.setSessionStatus({
      client,
      brand,
      id,
      status: "closed",
      extra: {
        closed_at: new Date().toISOString(),
        closing_cash_declared: declared ? toCurrencyString(declared) : null,
        closing_cash_expected: toCurrencyString(expected),
        cash_variance_ngn: variance ? toCurrencyString(variance) : null,
        variance_explanation: input.variance_explanation || null,
      },
    });
    await A(
      brand,
      user?.user_id,
      "pos.session.close",
      "pos_session",
      id,
      { variance_ngn: variance ? toCurrencyString(variance) : "0" },
      request_id,
    );
    events.emit("session.closed", { brand, session_id: id });
    return {
      ...updated,
      summary: await repo.getSummary({ client, brand, session_id: id }),
    };
  });
}
async function reconcileSession({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const session = await repo.getSession({ client, brand, id });
    if (!session) throw new NotFoundError("Session not found");
    if (session.status !== "closed")
      throw new ConflictError(
        `Only a closed session can be reconciled (is '${session.status}')`,
      );
    const updated = await repo.setSessionStatus({
      client,
      brand,
      id,
      status: "reconciled",
      extra: {
        reconciled_at: new Date().toISOString(),
        reconciled_by: user?.user_id,
        variance_explanation:
          input?.variance_explanation || session.variance_explanation,
      },
    });
    await A(
      brand,
      user?.user_id,
      "pos.session.reconcile",
      "pos_session",
      id,
      null,
      request_id,
    );
    return updated;
  });
}

// ── Cash drops ───────────────────────────────────────────
async function recordCashDrop({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const session = await repo.getSession({
      client,
      brand,
      id: input.session_id,
    });
    if (!session) throw new NotFoundError("Session not found");
    if (session.status !== "open")
      throw new ConflictError("Cash drops are only allowed on an open session");
    const drop_number = await repo.nextNumber({
      client,
      brand,
      type: "pos_cash_drop",
    });
    const drop = await repo.createDrop({
      client,
      brand,
      row: { ...input, drop_number, performed_by: user?.user_id },
    });
    await A(
      brand,
      user?.user_id,
      "pos.cash_drop",
      "pos_cash_drop",
      drop.drop_id,
      { amount_ngn: drop.amount_ngn, destination: drop.destination },
      request_id,
    );
    return drop;
  });
}

// ── Checkout ─────────────────────────────────────────────
async function checkout({ brand, user, request_id, input }) {
  const session = await repo.getSession({
    client: null,
    brand,
    id: input.session_id,
  });
  if (!session) throw new NotFoundError("Session not found");
  if (session.status !== "open")
    throw new ConflictError(
      "Cannot check out against a session that is not open",
    );

  // Idempotency: a retried offline sale must not double-charge.
  if (input.client_idempotency_key) {
    const existing = await repo.findTransactionByIdempotency({
      client: null,
      brand,
      terminal_id: session.terminal_id,
      key: input.client_idempotency_key,
    });
    if (existing)
      return repo.getTransaction({
        client: null,
        brand,
        id: existing.transaction_id,
      });
  }

  // 1. Canonical order through Sales (channel = pos).
  const order = await salesService.createOrder({
    brand,
    user,
    request_id,
    input: {
      lines: input.lines,
      sales_channel: "pos",
      order_type: input.is_walk_in === false ? "dispatch" : "walk_in",
      contact_id: input.customer_contact_id || null,
      sales_campaign_id: input.sales_campaign_id,
      campaign_slug: input.campaign_slug,
    },
  });

  // 2. POS transaction context (pending until paid).
  const transaction_number = await repo.nextNumber({
    client: null,
    brand,
    type: "pos_transaction",
  });
  const txn = await (async () =>
    transaction(async (client) => {
      const created = await repo.createTransaction({
        client,
        brand,
        row: {
          transaction_number,
          order_id: order.order_id,
          session_id: input.session_id,
          terminal_id: session.terminal_id,
          cashier_user_id: user?.user_id,
          customer_contact_id: input.customer_contact_id,
          is_walk_in: input.is_walk_in !== false,
          subtotal_ngn: order.subtotal_ngn,
          discount_total_ngn: order.discount_amount_ngn,
          tax_total_ngn: order.tax_amount_ngn,
          total_ngn: order.total_ngn,
          was_offline: input.was_offline,
          client_idempotency_key: input.client_idempotency_key,
        },
      });
      await A(
        brand,
        user?.user_id,
        "pos.checkout.open",
        "pos_transaction",
        created.transaction_id,
        { transaction_number, order_id: order.order_id },
        request_id,
      );
      return created;
    }))();

  // 3. Apply each split through Sales (last one trips markPaid → stock + GL + invoice).
  const totals = {
    cash: money(0),
    card: money(0),
    transfer: money(0),
    points: money(0),
    change: money(0),
  };
  for (const pay of input.payments || []) {
    await salesService.addPayment({
      brand,
      user,
      request_id,
      id: order.order_id,
      input: {
        method: SALES_METHOD[pay.method] || "cash",
        amount_ngn: pay.amount_ngn,
        provider: pay.provider,
        provider_reference: pay.provider_reference,
        payment_path: "pos",
      },
    });
    await transaction(async (client) => {
      await repo.addSplit({
        client,
        brand,
        split: {
          transaction_id: txn.transaction_id,
          method: pay.method,
          amount_ngn: pay.amount_ngn,
          provider_reference: pay.provider_reference,
          approval_code: pay.approval_code,
          card_last4: pay.card_last4,
          cash_tendered_ngn: pay.cash_tendered_ngn,
          cash_returned_ngn: pay.cash_returned_ngn,
        },
      });
    });
    const amt = money(pay.amount_ngn);
    if (pay.method === "cash") {
      totals.cash = totals.cash.plus(amt);
      if (pay.cash_returned_ngn)
        totals.change = totals.change.plus(money(pay.cash_returned_ngn));
    } else if (
      pay.method === "paystack_card" ||
      pay.method === "nomba_terminal"
    )
      totals.card = totals.card.plus(amt);
    else if (
      ["paystack_transfer", "bank_transfer", "opay"].includes(pay.method)
    )
      totals.transfer = totals.transfer.plus(amt);
    else if (pay.method === "points") totals.points = totals.points.plus(amt);
  }

  // 4. Finalise the POS transaction with the payment summary.
  return transaction(async (client) => {
    const finalised = await repo.setTransaction({
      client,
      brand,
      id: txn.transaction_id,
      patch: {
        status: "completed",
        cash_received_ngn: toCurrencyString(totals.cash),
        cash_returned_ngn: toCurrencyString(totals.change),
        card_received_ngn: toCurrencyString(totals.card),
        transfer_received_ngn: toCurrencyString(totals.transfer),
        points_redeemed_ngn: toCurrencyString(totals.points),
        receipt_emailed_to: input.receipt_emailed_to,
        receipt_whatsapp_to: input.receipt_whatsapp_to,
        offline_synced_at: input.was_offline ? new Date().toISOString() : null,
      },
    });
    await A(
      brand,
      user?.user_id,
      "pos.checkout.complete",
      "pos_transaction",
      txn.transaction_id,
      { order_id: order.order_id, total_ngn: order.total_ngn },
      request_id,
    );
    events.emit("checkout.completed", {
      brand,
      transaction_id: txn.transaction_id,
      order_id: order.order_id,
    });
    return repo.getTransaction({ client, brand, id: finalised.transaction_id });
  });
}
async function getTransaction({ brand, id }) {
  const txn = await repo.getTransaction({ client: null, brand, id });
  if (!txn) throw new NotFoundError("POS transaction not found");
  return txn;
}
const listTransactions = ({ brand, filters, page, page_size }) =>
  repo.listTransactions({
    client: null,
    brand,
    filters,
    page,
    page_size,
    offset: (page - 1) * page_size,
  });

// ── Voids ────────────────────────────────────────────────
async function voidTransaction({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const txn = await repo.getTransaction({ client, brand, id });
    if (!txn) throw new NotFoundError("POS transaction not found");
    if (["voided", "refunded"].includes(txn.status))
      throw new ConflictError(`Transaction already ${txn.status}`);
    await repo.addVoid({
      client,
      brand,
      row: {
        transaction_id: id,
        void_type: input.void_type || "full_void",
        voided_line_id: input.voided_line_id,
        amount_ngn: input.amount_ngn ?? txn.total_ngn,
        reason: input.reason,
        performed_by: user?.user_id,
        approved_by: user?.user_id,
      },
    });
    const updated = await repo.setTransaction({
      client,
      brand,
      id,
      patch: {
        status: "voided",
        voided_at: new Date().toISOString(),
        voided_by: user?.user_id,
        void_reason: input.reason,
      },
    });
    await A(
      brand,
      user?.user_id,
      "pos.transaction.void",
      "pos_transaction",
      id,
      { reason: input.reason, void_type: input.void_type },
      request_id,
    );
    events.emit("transaction.voided", { brand, transaction_id: id });
    return updated;
  });
}

module.exports = {
  createTerminal,
  getTerminal,
  listTerminals,
  updateTerminal,
  setPin,
  verifyPin,
  openSession,
  getSession,
  listSessions,
  closeSession,
  reconcileSession,
  recordCashDrop,
  checkout,
  getTransaction,
  listTransactions,
  voidTransaction,
};
