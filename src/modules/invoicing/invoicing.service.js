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
const { logger } = require("../../config/logger");
const pdf = require("../../services/pdf.service");
const brandDocs = require("../../services/pdf.brand-docs");
const docCopy = require("../../services/document-copy");
const emailRender = require("../email_campaigns/email-render");

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
    // The invoice is born fully paid → issue its receipt automatically so the
    // Receipts section is populated without a manual step.
    await issueReceiptInternal({
      client: c,
      brand,
      invoice: inv,
      amount_ngn: order.total_ngn,
      payment_method: "gateway",
      user_id,
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
        issued_by: user.user_id,
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
  // Schedule payment reminders now that the invoice is live.
  scheduleRemindersForInvoice({
    brand,
    invoice: { ...inv, sent_via: input.sent_via || inv.sent_via },
  }).catch(() => {});
  // Best-effort: archive the sent invoice PDF in Documents. Non-blocking, but
  // we LOG failures (previously swallowed silently) — a PDF_UNAVAILABLE here is
  // why system-generated docs never reach the Documents vault, and it must be
  // visible in the logs instead of disappearing.
  archiveInvoicePdf({ brand, user, id }).catch((err) =>
    logger.warn(
      { err: err.message, invoice_id: id, brand },
      "invoice PDF archive failed — check PDF rendering (PDF_ENABLED / Chromium)",
    ),
  );
  return updated;
}

/** First word of a display name, for personalised copy tokens. */
function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}
const dayISO = (v) => (v ? String(v).slice(0, 10) : "");

const INVOICE_STATUS_LABEL = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Part-paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
  refunded: "Refunded",
};

/**
 * Map an invoice (header + lines + contact_name) → the normalised document the
 * brand-doc renderer expects, with personalised, Settings-driven copy. A paid
 * invoice carries the PAID stamp; every money line (discount/delivery/VAT) is
 * passed through with the real column names so none are dropped.
 */
function buildInvoiceDoc({ invoice, brandObj, copy }) {
  const subtotal = Number(invoice.subtotal_ngn || 0);
  const discount = Number(invoice.discount_amount_ngn || 0);
  const tax = Number(invoice.tax_amount_ngn || 0);
  const base = subtotal - discount;
  const taxRate = tax > 0 && base > 0 ? tax / base : null;
  const total = Number(invoice.total_ngn || 0);
  const paid =
    invoice.status === "paid" ||
    (total > 0 && Number(invoice.amount_paid_ngn || 0) >= total);

  const tokens = {
    first_name: firstName(invoice.contact_name),
    brand_name: brandObj.brand_name,
    invoice_number: invoice.invoice_number || "",
    order_number: "",
    total: invoice.total_ngn,
  };
  const c = (copy.invoice && copy.invoice.pdf) || {};

  // A paid invoice must never nag for payment. Swap the "please settle within
  // terms" note for a settled-in-full acknowledgement (both operator-editable
  // via the Invoicing → Settings tab; defaults live in services/document-copy).
  const noteLabel = paid
    ? c.note_label_paid || "Payment received"
    : c.note_label;
  const noteText = paid ? c.note_paid : c.note;

  // The logo carries the brand name in the header, so the "From" block is where
  // the name lives on the page: lead with the brand name, then the legal entity
  // (only when it differs), then the contact lines.
  const brandName = brandObj.brand_name;
  const legalName = brandObj.brand_legal_name;

  return {
    status_label: INVOICE_STATUS_LABEL[invoice.status] || invoice.status,
    status_tone: paid ? "paid" : "due",
    watermark: paid ? "Paid" : null,
    watermark_tone: "paid",
    from: {
      name: brandName || legalName,
      company: legalName && legalName !== brandName ? legalName : null,
      address: brandObj.brand_address,
      phone: brandObj.brand_phone,
      email: brandObj.support_email,
    },
    bill_to: {
      name: invoice.contact_name,
      address:
        [invoice.cust_line1, invoice.cust_line2].filter(Boolean).join(", ") ||
        null,
      cityline:
        [invoice.cust_area, invoice.cust_city, invoice.cust_state]
          .filter(Boolean)
          .join(", ") || null,
      phone: invoice.contact_phone,
      email: invoice.contact_email,
    },
    meta: [
      ["Invoice #", invoice.invoice_number],
      ["Issue date", dayISO(invoice.issue_date || invoice.created_at)],
      [
        "Due date",
        invoice.due_date
          ? dayISO(invoice.due_date)
          : invoice.payment_terms || "Due on receipt",
      ],
    ],
    lines: (invoice.lines || []).map((l) => ({
      description:
        l.description ||
        [l.product_name_snapshot, l.variant_label_snapshot]
          .filter(Boolean)
          .join(" — "),
      quantity: l.quantity,
      unit_price_ngn: l.unit_price_ngn,
      line_total_ngn: l.line_total_ngn,
    })),
    subtotal_ngn: invoice.subtotal_ngn,
    discount_amount_ngn: invoice.discount_amount_ngn,
    shipping_fee_ngn: invoice.shipping_fee_ngn,
    tax_amount_ngn: invoice.tax_amount_ngn,
    tax_rate: taxRate,
    total_ngn: invoice.total_ngn,
    amount_paid_ngn: invoice.amount_paid_ngn,
    balance_due_ngn: invoice.balance_due_ngn,
    notes_label: noteLabel,
    notes: docCopy.fillTokens(noteText, tokens),
    thanks: docCopy.fillTokens(c.message, tokens),
  };
}

/** Resolve brand identity + copy and render the invoice PDF into Documents. */
async function _renderInvoicePdf({ brand, user, id }) {
  const full = await getById({ brand, id });
  if (!full) return null;
  const [tokens, copy] = await Promise.all([
    emailRender.resolveBrandTokens(brand),
    docCopy.resolveCopy(brand),
  ]);
  const brandObj = brandDocs.brandFromTokens(tokens);
  const html = brandDocs.invoiceHtml(
    brandObj,
    buildInvoiceDoc({ invoice: full, brandObj, copy }),
  );
  return pdf.renderAndStore({
    brand,
    user_id: user ? user.user_id : null,
    html,
    title: `Invoice ${full.invoice_number || id}`,
    document_type: "invoice",
    reference_type: "invoice",
    reference_id: id,
    pdfOptions: brandDocs.PDF_OPTIONS,
  });
}

/** Render the invoice to PDF and register it in shared.documents. */
async function archiveInvoicePdf({ brand, user, id }) {
  await _renderInvoicePdf({ brand, user, id });
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
    // Guard overpayment: an invoice carries no customer-credit concept, so a
    // payment beyond the outstanding balance would drive balance_due_ngn (a
    // generated column) negative. Reject anything over the current balance.
    const outstanding = money(inv.balance_due_ngn || 0);
    if (money(input.amount_applied_ngn).gt(outstanding))
      throw new AppError(
        "OVERPAYMENT",
        `Payment exceeds the outstanding balance of ${toCurrencyString(outstanding)}.`,
        422,
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

    // Fully paid → stop chasing it and give the customer a receipt.
    if (status === "paid") {
      await repo.cancelScheduledReminders({ client, brand, invoice_id: id });
      const existingReceipts = await repo.listReceipts({
        client,
        brand,
        invoice_id: id,
      });
      if (!existingReceipts.length) {
        await issueReceiptInternal({
          client,
          brand,
          invoice: updated,
          amount_ngn: updated.total_ngn,
          payment_method: input.payment_method || "manual",
          payment_id: input.sales_order_payment_id || null,
          user_id: user.user_id,
        });
      }
    }

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
  // Any recorded payment means money changed hands; voiding would orphan
  // those payment rows. Block fully- AND partially-paid invoices alike and
  // direct to a credit note / refund instead.
  if (inv.status === "paid" || money(inv.amount_paid_ngn || 0).gt(0))
    throw new AppError(
      "INVALID_STATE",
      "Invoices with recorded payments cannot be voided — issue a credit note or refund instead.",
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

// ── Invoice Reminders (F-10) ─────────────────────────────

const REMINDER_SCHEDULE = [
  { type: "pre_due", dayOffset: -3 },
  { type: "overdue_first", dayOffset: 1 },
  { type: "overdue_second", dayOffset: 7 },
  { type: "overdue_final", dayOffset: 14 },
];

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

async function scheduleRemindersForInvoice({ client, brand, invoice }) {
  if (!invoice.due_date || !invoice.contact_id) return;
  // Never schedule reminders for a non-collectible invoice — a paid/void/
  // refunded invoice owes nothing, so chasing it would be a wrong reminder.
  if (["paid", "void", "refunded"].includes(invoice.status)) return;
  // Resolve recipient contact address
  const { query } = require("../../config/database");
  const { rows: contacts } = await (client ? client.query.bind(client) : query)(
    `SELECT email, primary_phone, display_name FROM shared.contacts WHERE contact_id = $1`,
    [invoice.contact_id],
  );
  const contact = contacts[0];
  if (!contact) return;
  const channel = invoice.sent_via === "whatsapp" ? "whatsapp" : "email";
  const recipientAddress =
    channel === "whatsapp" ? contact.primary_phone : contact.email;
  if (!recipientAddress) return;

  for (const sched of REMINDER_SCHEDULE) {
    const scheduledFor = addDays(invoice.due_date, sched.dayOffset);
    // Only schedule future reminders
    if (new Date(scheduledFor) <= new Date()) continue;
    await repo.insertReminder({
      client,
      brand,
      reminder: {
        invoice_id: invoice.invoice_id,
        reminder_type: sched.type,
        channel,
        recipient_address: recipientAddress,
        template_key: `invoice_reminder.${sched.type}`,
        rendered_body: null,
        scheduled_for: scheduledFor,
      },
    });
  }
}

function listReminders({ brand, invoice_id }) {
  return repo.listReminders({ brand, invoice_id });
}

async function cancelReminder({
  brand,
  user,
  request_id,
  invoice_id,
  reminder_id,
}) {
  await getById({ brand, id: invoice_id });
  const updated = await repo.updateReminderStatus({
    brand,
    id: reminder_id,
    status: "cancelled",
  });
  if (!updated) throw new NotFoundError("Reminder");
  await A(
    brand,
    user.user_id,
    "invoicing.reminder.cancel",
    "invoice_reminder",
    reminder_id,
    null,
    request_id,
  );
  return updated;
}

async function sendDueReminders({ brand }) {
  const reminders = await repo.findDueReminders({ brand, limit: 50 });
  let sent = 0;
  let failed = 0;
  for (const r of reminders) {
    try {
      const smartcomm = require("../smartcomm/smartcomm.service");
      await smartcomm.sendToCustomer({
        brand,
        contact_id: r.contact_id,
        channel: r.channel,
        template_key: r.template_key || "invoice_reminder",
        variables: {
          invoice_number: r.invoice_number,
          due_date: r.due_date,
          balance_due_ngn: r.balance_due_ngn,
          reminder_type: r.reminder_type,
        },
      });
      await repo.updateReminderStatus({
        brand,
        id: r.reminder_id,
        status: "sent",
      });
      await repo.bumpReminderCount({ brand, invoice_id: r.invoice_id });
      sent += 1;
    } catch (err) {
      await repo.updateReminderStatus({
        brand,
        id: r.reminder_id,
        status: "failed",
        extra: { reason: err.message?.slice(0, 255) },
      });
      failed += 1;
    }
  }
  return { sent, failed };
}

// ── Receipts ─────────────────────────────────────────────
function listReceipts({ brand, invoice_id }) {
  return repo.listReceipts({ brand, invoice_id });
}
/**
 * Issue a receipt record for a fully-paid invoice. Used by the automatic paths
 * (auto-invoice on order.paid + manual full payment) so the Receipts section is
 * never empty for a paid invoice and no one has to issue it by hand. Runs inside
 * the caller's transaction; idempotent guarding is the caller's responsibility.
 */
async function issueReceiptInternal({
  client,
  brand,
  invoice,
  amount_ngn,
  payment_method = "gateway",
  payment_id = null,
  user_id = null,
}) {
  const receipt_number = await repo.nextNumber({
    client,
    brand,
    type: "receipt",
  });
  const receipt = await repo.createReceipt({
    client,
    brand,
    receipt: {
      receipt_number,
      invoice_id: invoice.invoice_id,
      payment_id,
      contact_id: invoice.contact_id,
      amount_ngn,
      payment_method,
      issued_by: user_id,
      notes: "Auto-issued on payment",
    },
  });
  await A(
    brand,
    user_id,
    "invoicing.receipt.auto_issue",
    "receipt",
    receipt.receipt_id,
    { receipt_number, invoice_id: invoice.invoice_id },
    null,
  );
  events.emit("receipt.issued", {
    brand,
    receipt_id: receipt.receipt_id,
    invoice_id: invoice.invoice_id,
  });
  return receipt;
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

/**
 * Render an invoice to PDF and persist it via the Documents gateway (§6.5 /
 * 4.2). Returns the stored document (document_id + url). Read-permission gated
 * by the route; degrades to a 503 if PDF rendering is disabled.
 */
async function invoicePdf({ brand, user, id }) {
  const stored = await _renderInvoicePdf({ brand, user, id });
  if (!stored) throw new NotFoundError("Invoice");
  return stored;
}

// ── Document settings (Invoicing → Settings tab) ─────────────
// Editable copy for invoice/receipt PDFs + their mail, per brand. Reads return
// the curated defaults merged with the brand's overrides so the editor always
// shows the effective wording; writes persist only the overridden fields.
async function getDocumentSettings({ brand }) {
  const [effective, overrides] = await Promise.all([
    docCopy.resolveCopy(brand),
    docCopy.getStored(brand),
  ]);
  return { effective, overrides, defaults: docCopy.DEFAULTS };
}

async function updateDocumentSettings({ brand, user, request_id, input }) {
  const overrides = await docCopy.saveCopy({
    brand,
    patch: input,
    user_id: user ? user.user_id : null,
  });
  await A(
    brand,
    user ? user.user_id : null,
    "invoicing.document_settings.update",
    "document_settings",
    brand,
    { fields: Object.keys(input || {}) },
    request_id,
  );
  events.emit("document_settings.updated", { brand });
  return { effective: docCopy.deepMerge(docCopy.DEFAULTS, overrides), overrides };
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
  scheduleRemindersForInvoice,
  listReminders,
  cancelReminder,
  sendDueReminders,
  invoicePdf,
  getDocumentSettings,
  updateDocumentSettings,
};
