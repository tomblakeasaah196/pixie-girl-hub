/**
 * Invoicing & Billing (V2.2 §6.5) — business logic.
 * Invoices are generated automatically from a paid sales order (subscriber)
 * or created manually. Payments applied here recompute amount_paid via the
 * invoice trigger; this service flips status (sent/partially_paid/paid/void).
 */

"use strict";

const repo = require("./invoicing.repo");
const events = require("./invoicing.events");
const accounting = require("../accounting/accounting.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");

const A = (
  brand,
  user_id,
  action_key,
  target_type,
  target_id,
  after,
  request_id,
) =>
  audit({
    business: brand,
    user_id,
    action_key,
    target_type,
    target_id,
    after,
    request_id,
  });

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Create a fully-paid invoice from a settled sales order. Idempotent: returns
 * the existing invoice if one already exists for the order. Pass a client to
 * run inside the order transaction.
 */
async function createFromOrder({ client, brand, order, user_id }) {
  const existing = await repo.findByOrderId({
    client,
    brand,
    order_id: order.order_id,
  });
  if (existing) return existing;
  const run = async (c) => {
    const invoice_number = await repo.nextNumber({
      client: c,
      brand,
      type: "invoice",
    });
    // Multi-currency display (V2.2 §6.5): carry the currency the customer saw
    // from the source order. NGN orders fall back to a 1:1 NGN display.
    const displayCurrency = order.display_currency || "NGN";
    const fxRate = order.fx_rate_used || 1;
    const totalNgn = money(order.total_ngn);
    const displayTotal =
      order.display_total !== null && order.display_total !== undefined
        ? money(order.display_total)
        : totalNgn;
    const displaySubtotal = totalNgn.gt(0)
      ? displayTotal.times(money(order.subtotal_ngn)).dividedBy(totalNgn)
      : money(order.subtotal_ngn);
    const inv = await repo.createInvoice({
      client: c,
      brand,
      invoice: {
        invoice_number,
        order_id: order.order_id,
        contact_id: order.contact_id,
        status: "paid",
        subtotal_ngn: order.subtotal_ngn,
        discount_amount_ngn: order.discount_amount_ngn,
        tax_amount_ngn: order.tax_amount_ngn,
        wht_rate: 0,
        wht_amount_ngn: 0,
        shipping_fee_ngn: order.shipping_fee_ngn,
        total_ngn: order.total_ngn,
        display_currency: displayCurrency,
        display_subtotal: toCurrencyString(displaySubtotal),
        display_total: toCurrencyString(displayTotal),
        fx_rate_used: fxRate,
        issue_date: todayISO(),
        due_date: todayISO(),
        payment_terms: "Due on receipt",
      },
    });
    for (const l of order.lines || []) {
      await repo.insertLine({
        client: c,
        brand,
        line: {
          invoice_id: inv.invoice_id,
          sales_order_line_id: l.line_id,
          product_id: l.product_id,
          variant_id: l.variant_id,
          description:
            [l.product_name_snapshot, l.variant_label_snapshot]
              .filter(Boolean)
              .join(" — ") || l.product_name_snapshot,
          sku_snapshot: l.sku_snapshot,
          quantity: l.quantity,
          unit_price_ngn: l.unit_price_ngn,
          line_discount_ngn: l.line_discount_ngn,
          tax_rate: l.tax_rate,
          tax_amount_ngn: l.tax_amount_ngn,
          line_total_ngn: l.line_total_ngn,
          display_order: l.display_order,
        },
      });
    }
    await repo.applyPayment({
      client: c,
      brand,
      payment: {
        invoice_id: inv.invoice_id,
        amount_applied_ngn: order.total_ngn,
        applied_by: user_id,
        notes: "Auto-applied from paid order",
      },
    });
    await A(
      brand,
      user_id,
      "invoicing.invoice.auto_create",
      "invoice",
      inv.invoice_id,
      { invoice_number, order_id: order.order_id },
      null,
    );
    events.emit("invoice.issued", {
      brand,
      invoice_id: inv.invoice_id,
      order_id: order.order_id,
    });
    return repo.findById({ client: c, brand, id: inv.invoice_id });
  };
  return client ? run(client) : transaction(run);
}

async function createManual({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    let subtotal = money(0),
      discountTotal = money(0),
      taxTotal = money(0);
    const lineRows = input.lines.map((l, idx) => {
      const unit = money(l.unit_price_ngn);
      const disc = money(l.line_discount_ngn || 0);
      const rate = money(l.tax_rate || 0);
      const base = unit.times(l.quantity).minus(disc);
      const tax = base.times(rate);
      subtotal = subtotal.plus(unit.times(l.quantity));
      discountTotal = discountTotal.plus(disc);
      taxTotal = taxTotal.plus(tax);
      return {
        product_id: l.product_id,
        variant_id: l.variant_id,
        description: l.description,
        sku_snapshot: l.sku_snapshot,
        quantity: l.quantity,
        unit_price_ngn: toCurrencyString(unit),
        line_discount_ngn: toCurrencyString(disc),
        tax_rate: rate.toFixed(4),
        tax_amount_ngn: toCurrencyString(tax),
        line_total_ngn: toCurrencyString(base.plus(tax)),
        revenue_account_code: l.revenue_account_code,
        display_order: idx,
      };
    });
    const shipping = money(input.shipping_fee_ngn || 0);
    const whtRate = money(input.wht_rate || 0);
    const total = subtotal.minus(discountTotal).plus(taxTotal).plus(shipping);
    const wht = total.times(whtRate);
    const invoice_number = await repo.nextNumber({
      client,
      brand,
      type: "invoice",
    });
    const inv = await repo.createInvoice({
      client,
      brand,
      invoice: {
        invoice_number,
        order_id: input.order_id,
        contact_id: input.contact_id,
        status: "draft",
        subtotal_ngn: toCurrencyString(subtotal),
        discount_amount_ngn: toCurrencyString(discountTotal),
        tax_amount_ngn: toCurrencyString(taxTotal),
        wht_rate: whtRate.toFixed(4),
        wht_amount_ngn: toCurrencyString(wht),
        shipping_fee_ngn: toCurrencyString(shipping),
        total_ngn: toCurrencyString(total),
        issue_date: input.issue_date || todayISO(),
        due_date: input.due_date,
        payment_terms: input.payment_terms,
      },
    });
    for (const lr of lineRows)
      await repo.insertLine({
        client,
        brand,
        line: { ...lr, invoice_id: inv.invoice_id },
      });
    await A(
      brand,
      user.user_id,
      "invoicing.invoice.create",
      "invoice",
      inv.invoice_id,
      { invoice_number },
      request_id,
    );
    events.emit("invoice.created", { brand, invoice_id: inv.invoice_id });
    return repo.findById({ client, brand, id: inv.invoice_id });
  });
}

function listInvoices({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listInvoices({ brand, filters, page, page_size, offset });
}
async function getById({ brand, id }) {
  const inv = await repo.findById({ brand, id });
  if (!inv) throw new NotFoundError("Invoice");
  return inv;
}
async function send({ brand, user, request_id, id, input = {} }) {
  const inv = await repo.findById({ brand, id });
  if (!inv) throw new NotFoundError("Invoice");
  if (["void", "refunded"].includes(inv.status))
    throw new AppError(
      "INVALID_STATE",
      `Cannot send a ${inv.status} invoice`,
      409,
    );
  const status = inv.status === "draft" ? "sent" : inv.status;
  const updated = await repo.setStatus({
    brand,
    id,
    status,
    extra: {
      sent_at: new Date().toISOString(),
      sent_via: input.sent_via || "email",
    },
  });
  await A(
    brand,
    user.user_id,
    "invoicing.invoice.send",
    "invoice",
    id,
    { sent_via: input.sent_via },
    request_id,
  );
  events.emit("invoice.sent", { brand, invoice_id: id });
  return updated;
}
async function recordPayment({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const inv = await repo.findById({ client, brand, id });
    if (!inv) throw new NotFoundError("Invoice");
    if (["void", "refunded"].includes(inv.status))
      throw new AppError(
        "INVALID_STATE",
        `Cannot pay a ${inv.status} invoice`,
        409,
      );
    await repo.applyPayment({
      client,
      brand,
      payment: {
        invoice_id: id,
        sales_order_payment_id: input.sales_order_payment_id,
        amount_applied_ngn: input.amount_applied_ngn,
        applied_by: user.user_id,
        notes: input.notes,
      },
    });
    const updated = await repo.findById({ client, brand, id });
    const balance = money(updated.balance_due_ngn);
    const status = balance.lte(money("0.00")) ? "paid" : "partially_paid";
    await repo.setStatus({ client, brand, id, status });
    await A(
      brand,
      user.user_id,
      "invoicing.invoice.payment",
      "invoice",
      id,
      { amount: input.amount_applied_ngn, status },
      request_id,
    );
    events.emit("invoice.payment", { brand, invoice_id: id, status });
    return repo.findById({ client, brand, id });
  });
}
async function voidInvoice({ brand, user, request_id, id }) {
  const inv = await repo.findById({ brand, id });
  if (!inv) throw new NotFoundError("Invoice");
  if (inv.status === "paid")
    throw new AppError(
      "INVALID_STATE",
      "Paid invoices cannot be voided (issue a credit note)",
      409,
    );
  const updated = await repo.setStatus({ brand, id, status: "void" });
  await A(
    brand,
    user.user_id,
    "invoicing.invoice.void",
    "invoice",
    id,
    null,
    request_id,
  );
  events.emit("invoice.void", { brand, invoice_id: id });
  return updated;
}

// ── Credit notes (V2.2 §6.5) ─────────────────────────────
function listCreditNotes({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listCreditNotes({ brand, filters, page, page_size, offset });
}
async function getCreditNote({ brand, id }) {
  const cn = await repo.findCreditNoteById({ brand, id });
  if (!cn) throw new NotFoundError("Credit note");
  return cn;
}
async function createCreditNote({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const inv = await repo.findById({ client, brand, id: input.invoice_id });
    if (!inv) throw new NotFoundError("Invoice");
    let subtotal = money(0),
      taxTotal = money(0);
    const lineRows = input.lines.map((l, idx) => {
      const unit = money(l.unit_price_ngn);
      const rate = money(l.tax_rate || 0);
      const base = unit.times(l.quantity);
      const tax = base.times(rate);
      subtotal = subtotal.plus(base);
      taxTotal = taxTotal.plus(tax);
      return {
        source_invoice_line_id: l.source_invoice_line_id,
        description: l.description,
        quantity: l.quantity,
        unit_price_ngn: toCurrencyString(unit),
        tax_rate: rate.toFixed(4),
        tax_amount_ngn: toCurrencyString(tax),
        line_total_ngn: toCurrencyString(base.plus(tax)),
        display_order: idx,
      };
    });
    const total = subtotal.plus(taxTotal);
    const credit_note_number = await repo.nextNumber({
      client,
      brand,
      type: "credit_note",
    });
    const cn = await repo.createCreditNote({
      client,
      brand,
      note: {
        credit_note_number,
        invoice_id: input.invoice_id,
        reason: input.reason,
        reason_category: input.reason_category,
        cancellation_request_id: input.cancellation_request_id,
        subtotal_ngn: toCurrencyString(subtotal),
        tax_amount_ngn: toCurrencyString(taxTotal),
        total_ngn: toCurrencyString(total),
        issued_by: user.user_id,
      },
    });
    for (const lr of lineRows)
      await repo.insertCreditNoteLine({
        client,
        brand,
        line: { ...lr, credit_note_id: cn.credit_note_id },
      });
    await A(
      brand,
      user.user_id,
      "invoicing.credit_note.create",
      "credit_note",
      cn.credit_note_id,
      { credit_note_number },
      request_id,
    );
    events.emit("credit_note.created", {
      brand,
      credit_note_id: cn.credit_note_id,
    });
    return repo.findCreditNoteById({ client, brand, id: cn.credit_note_id });
  });
}
async function issueCreditNote({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const cn = await repo.findCreditNoteById({ client, brand, id });
    if (!cn) throw new NotFoundError("Credit note");
    if (cn.status !== "draft")
      throw new AppError(
        "INVALID_STATE",
        `Cannot issue a '${cn.status}' credit note`,
        409,
      );
    const inv = await repo.findById({ client, brand, id: cn.invoice_id });
    // Reverse the sale on the GL: DR Revenue + DR VAT, CR Accounts Receivable.
    const lines = [
      {
        account_code: "4000",
        debit_ngn: cn.subtotal_ngn,
        description: "Sales returns / credit",
        contact_id: inv ? inv.contact_id : null,
      },
    ];
    if (money(cn.tax_amount_ngn).gt(0))
      lines.push({
        account_code: "2100",
        debit_ngn: cn.tax_amount_ngn,
        description: "VAT output reversal",
      });
    lines.push({
      account_code: "1200",
      credit_ngn: cn.total_ngn,
      description: `Credit note ${cn.credit_note_number}`,
      contact_id: inv ? inv.contact_id : null,
    });
    const journal = await accounting.postEntry({
      client,
      brand,
      user_id: user.user_id,
      entry: {
        source_type: "refund",
        source_table: "credit_notes",
        source_id: id,
        reference: cn.credit_note_number,
        description: `Credit note ${cn.credit_note_number}`,
      },
      lines,
    });
    const updated = await repo.setCreditNoteStatus({
      client,
      brand,
      id,
      status: "issued",
    });
    // Reflect on the invoice.
    if (inv) {
      const fullyCredited = money(cn.total_ngn).gte(money(inv.total_ngn));
      await repo.setStatus({
        client,
        brand,
        id: inv.invoice_id,
        status: fullyCredited ? "refunded" : "partially_refunded",
      });
    }
    await A(
      brand,
      user.user_id,
      "invoicing.credit_note.issue",
      "credit_note",
      id,
      { journal_entry_id: journal.entry_id },
      request_id,
    );
    events.emit("credit_note.issued", { brand, credit_note_id: id });
    return updated;
  });
}

// ── Receipts ─────────────────────────────────────────────
function listReceipts({ brand, invoice_id }) {
  return repo.listReceipts({ brand, invoice_id });
}
async function issueReceipt({ brand, user, request_id, input }) {
  const receipt_number = await repo.nextNumber({ brand, type: "receipt" });
  const receipt = await repo.createReceipt({
    brand,
    receipt: { ...input, receipt_number, issued_by: user.user_id },
  });
  await A(
    brand,
    user.user_id,
    "invoicing.receipt.issue",
    "receipt",
    receipt.receipt_id,
    { receipt_number },
    request_id,
  );
  return receipt;
}

module.exports = {
  createFromOrder,
  createManual,
  listInvoices,
  getById,
  send,
  recordPayment,
  voidInvoice,
  listCreditNotes,
  getCreditNote,
  createCreditNote,
  issueCreditNote,
  listReceipts,
  issueReceipt,
};
