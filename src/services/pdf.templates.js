/**
 * HTML templates for PDF rendering (pdf.service).
 *
 * Markup lives as editable .html files in ./templates (one per document, named
 * by report). This module is the renderer: it loads a template, fills its
 * placeholders, and wraps it in the shared _shell layout. Data-shaping (rows,
 * totals, conditional lines) stays here in JS so the .html files are pure markup
 * an admin can restyle without touching code.
 *
 * Placeholder syntax (mustache-ish):
 *   {{name}}     scalar, HTML-escaped
 *   {{{name}}}   raw HTML (pre-built + trusted, e.g. table rows) - NOT escaped
 *
 * Keep markup self-contained (inline CSS, no external assets) so Chromium needs
 * no network at render time.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const TEMPLATE_DIR = path.join(__dirname, "templates");
const cache = new Map();

const present = (v) => v !== null && v !== undefined;

function esc(s) {
  if (!present(s)) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ngn = (v) =>
  `₦${Number(v || 0).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;

const day = (v) => (present(v) ? String(v).slice(0, 10) : "");

function load(name) {
  if (!cache.has(name)) {
    cache.set(
      name,
      fs.readFileSync(path.join(TEMPLATE_DIR, `${name}.html`), "utf8"),
    );
  }
  return cache.get(name);
}

/**
 * Fill placeholders in ONE pass. The alternation matches {{{raw}}} or {{scalar}}
 * left-to-right; because it is a single pass, the substituted content (raw HTML
 * or escaped scalar) is never re-scanned - so a data value that happens to
 * contain "{{x}}" stays inert, and there is no sentinel to collide with markup.
 */
function fill(tpl, vars) {
  return tpl.replace(
    /\{\{\{\s*(\w+)\s*\}\}\}|\{\{\s*(\w+)\s*\}\}/g,
    (_, rawKey, scalarKey) => {
      if (rawKey !== undefined) {
        return present(vars[rawKey]) ? String(vars[rawKey]) : "";
      }
      return esc(vars[scalarKey]);
    },
  );
}

/** Wrap a body fragment in the shared shell. Exported for ad-hoc callers. */
function shell(title, bodyHtml) {
  return fill(load("_shell"), { title, body: bodyHtml });
}

/** Render a named template with vars, wrapped in the shell. */
function render(name, title, vars) {
  return shell(title, fill(load(name), vars));
}

// Shared totals row (raw HTML)
const totalsRow = (label, val) =>
  `<tr><td></td><td></td><td class="right muted">${esc(label)}</td><td class="right">${esc(ngn(val))}</td></tr>`;

// Report (J-7 report-generate)
function reportSections(sections) {
  return (sections || [])
    .map((sec) => {
      if (sec.rows) {
        const rows = sec.rows
          .map(
            ([k, v]) =>
              `<tr><td>${esc(k)}</td><td class="right">${esc(v)}</td></tr>`,
          )
          .join("");
        return `<h2>${esc(sec.heading || "")}</h2><table>${rows}</table>`;
      }
      if (sec.table) {
        const head = `<tr>${sec.table.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>`;
        const rows = sec.table.data
          .map(
            (r) =>
              `<tr>${r.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`,
          )
          .join("");
        return `<h2>${esc(sec.heading || "")}</h2><table>${head}${rows}</table>`;
      }
      return `<h2>${esc(sec.heading || "")}</h2><p>${esc(sec.text || "")}</p>`;
    })
    .join("");
}

function reportHtml({ title, subtitle, generated_at, sections = [] }) {
  return render("report", title || "Report", {
    title: title || "Report",
    subtitle: subtitle ? `<div class="meta">${esc(subtitle)}</div>` : "",
    generated_at: generated_at || new Date().toISOString(),
    sections: reportSections(sections),
  });
}

// Delivery letter / waybill (X-1)
function deliveryLetterHtml({ brand, delivery }) {
  const d = delivery || {};
  const items = Array.isArray(d.items) ? d.items : [];
  const itemsHtml = items.length
    ? `<h2>Items</h2><table>
         <tr><th>Item</th><th class="right">Qty</th></tr>
         ${items
           .map(
             (it) =>
               `<tr><td>${esc(it.description || it.name || it.sku || "-")}</td><td class="right">${esc(it.quantity ?? "")}</td></tr>`,
           )
           .join("")}
       </table>`
    : "";
  return render("delivery-letter", "Delivery Letter", {
    brand,
    waybill: d.tracking_number || d.delivery_number || d.delivery_id || "",
    recipient_name: d.recipient_name || d.contact_name || "-",
    recipient_phone: d.recipient_phone || d.contact_phone || "-",
    address: d.delivery_address || d.address || "-",
    courier: d.courier_name || d.courier_id || "-",
    order: d.order_number || d.order_id || "-",
    cod_row: present(d.cod_amount_ngn)
      ? `<tr><td>Cash on delivery</td><td class="right">${esc(ngn(d.cod_amount_ngn))}</td></tr>`
      : "",
    items: itemsHtml,
  });
}

// Invoice (6.5)
function invoiceHtml({ brand, invoice }) {
  const inv = invoice || {};
  const lines = Array.isArray(inv.lines) ? inv.lines : [];
  const rows =
    lines
      .map(
        (l) => `<tr>
          <td>${esc(l.description || l.item || l.name || "-")}</td>
          <td class="right">${esc(l.quantity ?? l.qty ?? "")}</td>
          <td class="right">${esc(ngn(l.unit_price_ngn ?? l.unit_price ?? 0))}</td>
          <td class="right">${esc(ngn(l.line_total_ngn ?? l.amount_ngn ?? 0))}</td>
        </tr>`,
      )
      .join("") || `<tr><td colspan="4" class="muted">No line items</td></tr>`;
  let totals = totalsRow("Subtotal", inv.subtotal_ngn);
  if (present(inv.tax_ngn) || present(inv.vat_ngn)) {
    totals += totalsRow(
      "Tax / VAT",
      present(inv.tax_ngn) ? inv.tax_ngn : inv.vat_ngn,
    );
  }
  totals += totalsRow("Total", inv.total_ngn);
  if (present(inv.amount_paid_ngn)) {
    totals += totalsRow("Paid", inv.amount_paid_ngn);
  }
  if (present(inv.balance_due_ngn)) {
    totals += totalsRow("Balance due", inv.balance_due_ngn);
  }
  return render("invoice", `Invoice ${inv.invoice_number || ""}`, {
    invoice_number: inv.invoice_number || inv.invoice_id || "",
    brand,
    status: inv.status || "-",
    bill_to: inv.contact_name || inv.customer_name || inv.bill_to || "-",
    issue_date: day(inv.issue_date || inv.created_at) || "-",
    due_date: day(inv.due_date) || "-",
    rows,
    totals,
  });
}

// Quotation (reuses the invoice layout)
function quotationHtml({ brand, quotation }) {
  const q = quotation || {};
  const lines = Array.isArray(q.lines) ? q.lines : [];
  const rows =
    lines
      .map(
        (l) => `<tr>
          <td>${esc(l.description || l.item || l.name || "-")}</td>
          <td class="right">${esc(l.quantity ?? l.qty ?? "")}</td>
          <td class="right">${esc(ngn(l.unit_price_ngn ?? l.unit_price ?? 0))}</td>
          <td class="right">${esc(ngn(l.line_total_ngn ?? l.amount_ngn ?? 0))}</td>
        </tr>`,
      )
      .join("") || `<tr><td colspan="4" class="muted">No line items</td></tr>`;
  let totals = totalsRow("Subtotal", q.subtotal_ngn);
  if (present(q.discount_amount_ngn))
    totals += totalsRow("Discount", q.discount_amount_ngn);
  if (present(q.tax_amount_ngn))
    totals += totalsRow("Tax / VAT", q.tax_amount_ngn);
  totals += totalsRow("Total", q.total_ngn);
  return render("invoice", `Quotation ${q.quotation_number || ""}`, {
    invoice_number: q.quotation_number || q.quotation_id || "",
    brand,
    status: q.status || "-",
    bill_to: q.contact_name || q.customer_name || q.bill_to || "-",
    issue_date: day(q.created_at) || "-",
    due_date: day(q.valid_until || q.expires_at) || "-",
    rows,
    totals,
  });
}

// Sales / POS receipt
function receiptHtml({ brand, order }) {
  const o = order || {};
  const lines = Array.isArray(o.lines) ? o.lines : [];
  const rows =
    lines
      .map(
        (l) => `<tr>
          <td>${esc(l.description || l.name || l.variant_name || "-")}</td>
          <td class="right">${esc(l.quantity ?? "")}</td>
          <td class="right">${esc(ngn(l.line_total_ngn ?? l.amount_ngn ?? 0))}</td>
        </tr>`,
      )
      .join("") || `<tr><td colspan="3" class="muted">No items</td></tr>`;
  let totals = totalsRow("Subtotal", o.subtotal_ngn);
  if (present(o.discount_ngn)) totals += totalsRow("Discount", o.discount_ngn);
  if (present(o.tax_ngn)) totals += totalsRow("VAT", o.tax_ngn);
  totals += totalsRow(
    "Total paid",
    present(o.total_ngn) ? o.total_ngn : o.amount_paid_ngn,
  );
  return render("receipt", "Receipt", {
    brand,
    order_number: o.order_number || o.order_id || "",
    date: day(o.paid_at || o.placed_at || o.created_at),
    payment_method: o.payment_method || o.channel || "-",
    rows,
    totals,
  });
}

// Payslip (6.11)
function payslipHtml({ brand, payslip }) {
  const p = payslip || {};
  const lines = Array.isArray(p.lines) ? p.lines : [];
  const breakdown = lines.length
    ? `<h2>Breakdown</h2><table>${lines
        .map(
          (l) =>
            `<tr><td>${esc(l.description || l.line_type || "-")}</td><td class="right">${esc(ngn(l.amount_ngn ?? l.amount ?? 0))}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  return render("payslip", "Payslip", {
    brand,
    staff_name: p.staff_name || p.employee_name || "",
    period: p.period_label || p.period || "",
    net_pay: ngn(p.net_pay_ngn),
    totals:
      totalsRow("Gross pay", p.gross_pay_ngn) +
      totalsRow("Total deductions", p.total_deductions_ngn),
    breakdown,
  });
}

// Purchase order (6.8)
function purchaseOrderHtml({ brand, po }) {
  const o = po || {};
  const lines = Array.isArray(o.lines) ? o.lines : [];
  const rows =
    lines
      .map(
        (l) => `<tr>
          <td>${esc(l.description || l.item || l.name || l.sku || "-")}</td>
          <td class="right">${esc(l.quantity ?? l.qty ?? "")}</td>
          <td class="right">${esc(ngn(l.unit_cost_ngn ?? l.unit_price_ngn ?? l.unit_price ?? 0))}</td>
          <td class="right">${esc(ngn(l.line_total_ngn ?? l.amount_ngn ?? 0))}</td>
        </tr>`,
      )
      .join("") || `<tr><td colspan="4" class="muted">No line items</td></tr>`;
  let totals = totalsRow("Subtotal", o.subtotal_ngn);
  if (present(o.tax_ngn)) totals += totalsRow("Tax", o.tax_ngn);
  if (present(o.shipping_ngn) || present(o.freight_ngn)) {
    totals += totalsRow(
      "Freight",
      present(o.shipping_ngn) ? o.shipping_ngn : o.freight_ngn,
    );
  }
  totals += totalsRow(
    "Total",
    present(o.total_ngn) ? o.total_ngn : o.grand_total_ngn,
  );
  return render("purchase-order", `Purchase Order ${o.po_number || ""}`, {
    po_number: o.po_number || o.po_id || "",
    brand,
    status: o.status || "-",
    supplier: o.supplier_name || o.supplier || "-",
    order_date: day(o.order_date || o.created_at) || "-",
    expected_date: day(o.expected_date || o.eta) || "-",
    currency: o.currency || "NGN",
    rows,
    totals,
  });
}

// Customer / supplier statement
function statementHtml({ brand, statement }) {
  const s = statement || {};
  const entries = Array.isArray(s.entries) ? s.entries : [];
  const rows =
    entries
      .map(
        (e) => `<tr>
          <td>${esc(day(e.date || e.posting_date || e.created_at))}</td>
          <td>${esc(e.description || e.narration || e.reference || "-")}</td>
          <td class="right">${esc(present(e.debit_ngn) ? ngn(e.debit_ngn) : "")}</td>
          <td class="right">${esc(present(e.credit_ngn) ? ngn(e.credit_ngn) : "")}</td>
          <td class="right">${esc(present(e.balance_ngn) ? ngn(e.balance_ngn) : "")}</td>
        </tr>`,
      )
      .join("") ||
    `<tr><td colspan="5" class="muted">No entries in this period</td></tr>`;
  return render("statement", "Statement", {
    brand,
    party_label: s.party_type === "supplier" ? "Supplier" : "Customer",
    party_name: s.party_name || s.contact_name || s.supplier_name || "-",
    from: day(s.from),
    to: day(s.to),
    rows,
    totals: present(s.closing_balance_ngn)
      ? totalsRow("Closing balance", s.closing_balance_ngn)
      : "",
  });
}

// Employment contract (HR — contract generation)
function contractHtml({ brand, contract, staff }) {
  const c = contract || {};
  const s = staff || {};
  const brandName = (brand && (brand.display_name || brand.name)) || "The Company";
  const typeLabel = String(c.contract_type || "full_time").replace(/_/g, " ");
  const body = `
    <h1>Employment Contract</h1>
    <div class="meta">${esc(brandName)} · ${esc(typeLabel)} · effective ${esc(c.effective_from || "")}</div>
    <p>This agreement is made between <strong>${esc(brandName)}</strong> ("the Company")
       and <strong>${esc(s.display_name || "the Employee")}</strong> ("the Employee"),
       employee no. <strong>${esc(s.employee_number || "-")}</strong>.</p>
    <h2>1. Position</h2>
    <p>The Employee is engaged as <strong>${esc(s.job_title || "-")}</strong>${
      s.department ? ` in ${esc(s.department)}` : ""
    }, commencing ${esc(c.effective_from || "")}${
      c.effective_to ? ` until ${esc(c.effective_to)}` : " (open-ended)"
    }.</p>
    <h2>2. Remuneration</h2>
    <p>Gross monthly salary: <strong>${esc(ngn(c.gross_salary))}</strong>, paid monthly to the
       Employee's registered bank account, subject to statutory deductions (PAYE, pension, NHF).</p>
    <h2>3. Hours, attendance & conduct</h2>
    <p>The Employee shall observe the Company's working schedule, clock-in/attendance policy
       (including geofenced clock-in where applicable), and lateness/deduction rules as set out
       in the Staff Handbook and the Hub.</p>
    <h2>4. Performance</h2>
    <p>The Employee's performance is reviewed against targets and KPIs communicated each period;
       bonuses and commissions accrue per Company policy.</p>
    ${c.notes ? `<h2>5. Additional terms</h2><p>${esc(c.notes)}</p>` : ""}
    <h2>Signatures</h2>
    <table>
      <tr><td>Employee: ____________________</td><td>Date: __________</td></tr>
      <tr><td>For the Company: ____________________</td><td>Date: __________</td></tr>
    </table>
    <p class="muted">Contract ${esc(c.contract_number || c.contract_id || "")} ·
       generated ${esc(new Date().toISOString().slice(0, 10))}</p>`;
  return shell("Employment Contract", body);
}

module.exports = {
  reportHtml,
  deliveryLetterHtml,
  invoiceHtml,
  quotationHtml,
  receiptHtml,
  payslipHtml,
  purchaseOrderHtml,
  statementHtml,
  contractHtml,
  shell,
  render,
  esc,
  ngn,
};
