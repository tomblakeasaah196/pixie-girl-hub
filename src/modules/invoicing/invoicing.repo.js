/**
 * Invoicing & Billing (V2.2 §6.5) — repository.
 * invoices.amount_paid_ngn is recomputed by a TRIGGER from invoice_payments;
 * this layer only inserts rows + flips status.
 */

"use strict";

const { query } = require("../../config/database");

const { VALID } = require("../../config/brands");
const t = (brand, tbl) => {
  if (!VALID.has(brand)) throw new Error(`Invalid brand: ${brand}`);
  return `${brand}.${tbl}`;
};
const ex = (client) => (client ? client.query.bind(client) : query);

const INV_COLS = [
  "invoice_number",
  "order_id",
  "contact_id",
  "status",
  "subtotal_ngn",
  "discount_amount_ngn",
  "tax_amount_ngn",
  "wht_rate",
  "wht_amount_ngn",
  "shipping_fee_ngn",
  "total_ngn",
  "display_currency",
  "display_subtotal",
  "display_total",
  "fx_rate_used",
  "issue_date",
  "due_date",
  "payment_terms",
  "issued_by",
];
const LINE_COLS = [
  "invoice_id",
  "sales_order_line_id",
  "product_id",
  "variant_id",
  "description",
  "sku_snapshot",
  "quantity",
  "unit_price_ngn",
  "line_discount_ngn",
  "tax_rate",
  "tax_amount_ngn",
  "line_total_ngn",
  "revenue_account_code",
  "display_order",
];

function buildInsert(cols, src, extra = {}) {
  const f = [],
    ph = [],
    p = [];
  let i = 1;
  for (const col of cols) {
    if (src[col] === undefined) continue;
    f.push(col);
    ph.push(`$${i++}`);
    p.push(src[col]);
  }
  for (const [col, val] of Object.entries(extra)) {
    f.push(col);
    ph.push(`$${i++}`);
    p.push(val);
  }
  return { f, ph, p };
}

async function nextNumber({ client, brand, type }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}($1) AS n`,
    [type],
  );
  return rows[0].n;
}
async function createInvoice({ client, brand, invoice }) {
  const { f, ph, p } = buildInsert(INV_COLS, invoice);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "invoices")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function insertLine({ client, brand, line }) {
  const { f, ph, p } = buildInsert(LINE_COLS, line);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "invoice_lines")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function findById({ client, brand, id }) {
  // Pull the customer's contact details + their best billing address so the
  // invoice "Bill to" block is fully populated (name was all we had before).
  // The LATERAL picks one address, preferring a billing address, then the
  // default, then the oldest; contacts without an address simply yield NULLs.
  const { rows } = await ex(client)(
    `SELECT i.*, c.display_name AS contact_name, c.email AS contact_email,
            c.primary_phone AS contact_phone,
            addr.line1 AS cust_line1, addr.line2 AS cust_line2,
            addr.area AS cust_area, addr.city AS cust_city, addr.state AS cust_state
       FROM ${t(brand, "invoices")} i
       LEFT JOIN shared.contacts c ON c.contact_id = i.contact_id
       LEFT JOIN LATERAL (
         SELECT line1, line2, area, city, state
           FROM shared.contact_addresses a
          WHERE a.contact_id = i.contact_id
          ORDER BY (a.address_type = 'billing') DESC, a.is_default DESC, a.created_at
          LIMIT 1
       ) addr ON true
      WHERE i.invoice_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: lines } = await ex(client)(
    `SELECT * FROM ${t(brand, "invoice_lines")} WHERE invoice_id = $1 ORDER BY display_order`,
    [id],
  );
  const { rows: payments } = await ex(client)(
    `SELECT * FROM ${t(brand, "invoice_payments")} WHERE invoice_id = $1 ORDER BY applied_at`,
    [id],
  );
  return { ...rows[0], lines, payments };
}
async function findByOrderId({ client, brand, order_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "invoices")} WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [order_id],
  );
  return rows[0] || null;
}
async function listInvoices({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`i.status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.contact_id) {
    where.push(`i.contact_id = $${i++}`);
    params.push(filters.contact_id);
  }
  if (filters.order_id) {
    where.push(`i.order_id = $${i++}`);
    params.push(filters.order_id);
  }
  if (filters.overdue) {
    where.push(
      `i.status NOT IN ('paid','void','refunded') AND i.due_date < CURRENT_DATE`,
    );
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "invoices")} i ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT i.*, c.display_name AS contact_name
       FROM ${t(brand, "invoices")} i
       LEFT JOIN shared.contacts c ON c.contact_id = i.contact_id
       ${w}
      ORDER BY i.issue_date DESC, i.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setStatus({ client, brand, id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "invoices")} SET ${sets.join(", ")} WHERE invoice_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function applyPayment({ client, brand, payment }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "invoice_payments")} (invoice_id, sales_order_payment_id, amount_applied_ngn, applied_by, notes)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [
      payment.invoice_id,
      payment.sales_order_payment_id || null,
      payment.amount_applied_ngn,
      payment.applied_by || null,
      payment.notes || null,
    ],
  );
  return rows[0];
}

// ── Credit notes (+ lines) ───────────────────────────────
async function createCreditNote({ client, brand, note }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "credit_notes")}
       (credit_note_number, invoice_id, reason, reason_category, cancellation_request_id,
        subtotal_ngn, tax_amount_ngn, total_ngn, status, issue_date, issued_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',CURRENT_DATE,$9) RETURNING *`,
    [
      note.credit_note_number,
      note.invoice_id,
      note.reason,
      note.reason_category || null,
      note.cancellation_request_id || null,
      note.subtotal_ngn,
      note.tax_amount_ngn,
      note.total_ngn,
      note.issued_by || null,
    ],
  );
  return rows[0];
}
async function insertCreditNoteLine({ client, brand, line }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "credit_note_lines")}
       (credit_note_id, source_invoice_line_id, description, quantity, unit_price_ngn, tax_rate, tax_amount_ngn, line_total_ngn, display_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      line.credit_note_id,
      line.source_invoice_line_id || null,
      line.description,
      line.quantity,
      line.unit_price_ngn,
      line.tax_rate,
      line.tax_amount_ngn,
      line.line_total_ngn,
      line.display_order,
    ],
  );
  return rows[0];
}
async function findCreditNoteById({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT cn.*, i.invoice_number, c.display_name AS contact_name
       FROM ${t(brand, "credit_notes")} cn
       LEFT JOIN ${t(brand, "invoices")} i ON i.invoice_id = cn.invoice_id
       LEFT JOIN shared.contacts c ON c.contact_id = i.contact_id
      WHERE cn.credit_note_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: lines } = await ex(client)(
    `SELECT * FROM ${t(brand, "credit_note_lines")} WHERE credit_note_id = $1 ORDER BY display_order`,
    [id],
  );
  return { ...rows[0], lines };
}
async function listCreditNotes({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`cn.status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.invoice_id) {
    where.push(`cn.invoice_id = $${i++}`);
    params.push(filters.invoice_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "credit_notes")} cn ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT cn.*, i.invoice_number, c.display_name AS contact_name
       FROM ${t(brand, "credit_notes")} cn
       LEFT JOIN ${t(brand, "invoices")} i ON i.invoice_id = cn.invoice_id
       LEFT JOIN shared.contacts c ON c.contact_id = i.contact_id
       ${w}
      ORDER BY cn.issue_date DESC, cn.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setCreditNoteStatus({ client, brand, id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "credit_notes")} SET ${sets.join(", ")} WHERE credit_note_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Receipts ─────────────────────────────────────────────
async function createReceipt({ client, brand, receipt }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "receipts")} (receipt_number, invoice_id, payment_id, contact_id, amount_ngn, payment_method, issued_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      receipt.receipt_number,
      receipt.invoice_id || null,
      receipt.payment_id || null,
      receipt.contact_id || null,
      receipt.amount_ngn,
      receipt.payment_method,
      receipt.issued_by || null,
      receipt.notes || null,
    ],
  );
  return rows[0];
}
async function listReceipts({ client, brand, invoice_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "receipts")} WHERE invoice_id = $1 ORDER BY issued_at`,
    [invoice_id],
  );
  return rows;
}

// ── Invoice Reminders (F-10) ─────────────────────────────
async function insertReminder({ client, brand, reminder }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "invoice_reminders")}
       (invoice_id, reminder_type, channel, recipient_address, template_key, rendered_body, status, scheduled_for)
     VALUES ($1,$2,$3,$4,$5,$6,'scheduled',$7) RETURNING *`,
    [
      reminder.invoice_id,
      reminder.reminder_type,
      reminder.channel,
      reminder.recipient_address,
      reminder.template_key || null,
      reminder.rendered_body || null,
      reminder.scheduled_for,
    ],
  );
  return rows[0];
}

async function listReminders({ client, brand, invoice_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "invoice_reminders")} WHERE invoice_id = $1 ORDER BY scheduled_for`,
    [invoice_id],
  );
  return rows;
}

/** Cancel every still-scheduled reminder for an invoice (e.g. once it's paid),
 *  so none linger in the UI or ever fire. Returns the number cancelled. */
async function cancelScheduledReminders({ client, brand, invoice_id }) {
  const { rowCount } = await ex(client)(
    `UPDATE ${t(brand, "invoice_reminders")}
        SET status = 'cancelled'
      WHERE invoice_id = $1 AND status = 'scheduled'`,
    [invoice_id],
  );
  return rowCount;
}

async function findDueReminders({ client, brand, limit = 50 }) {
  const { rows } = await ex(client)(
    `SELECT ir.*, i.contact_id, i.invoice_number, i.due_date, i.balance_due_ngn
       FROM ${t(brand, "invoice_reminders")} ir
       JOIN ${t(brand, "invoices")} i ON i.invoice_id = ir.invoice_id
      WHERE ir.status = 'scheduled'
        AND ir.scheduled_for <= now()
        AND i.status NOT IN ('paid','void','refunded')
      ORDER BY ir.scheduled_for
      LIMIT $1
      FOR UPDATE OF ir SKIP LOCKED`,
    [limit],
  );
  return rows;
}

async function updateReminderStatus({ client, brand, id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  if (status === "sent") {
    sets.push(`sent_at = $${i++}`);
    params.push(new Date().toISOString());
  }
  if (status === "failed") {
    sets.push(`failure_reason = $${i++}`);
    params.push(extra.reason || null);
  }
  if (extra.provider_reference) {
    sets.push(`provider_reference = $${i++}`);
    params.push(extra.provider_reference);
  }
  if (extra.provider) {
    sets.push(`provider = $${i++}`);
    params.push(extra.provider);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "invoice_reminders")} SET ${sets.join(",")} WHERE reminder_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function bumpReminderCount({ client, brand, invoice_id }) {
  await ex(client)(
    `UPDATE ${t(brand, "invoices")}
       SET reminders_sent = reminders_sent + 1, last_reminder_sent_at = now()
      WHERE invoice_id = $1`,
    [invoice_id],
  );
}

module.exports = {
  nextNumber,
  createInvoice,
  insertLine,
  findById,
  findByOrderId,
  listInvoices,
  setStatus,
  applyPayment,
  createCreditNote,
  insertCreditNoteLine,
  findCreditNoteById,
  listCreditNotes,
  setCreditNoteStatus,
  createReceipt,
  listReceipts,
  insertReminder,
  listReminders,
  cancelScheduledReminders,
  findDueReminders,
  updateReminderStatus,
  bumpReminderCount,
};
