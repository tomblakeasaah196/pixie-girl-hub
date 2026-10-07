/**
 * Sales report — styled .xlsx export (V2.2 §6.2).
 *
 * Builds a multi-sheet, presentation-grade workbook for a chosen period:
 *   • Summary      — period header + headline totals, by-status and by-channel
 *                    breakdowns. Paid figures use the same PAID_STATES set as
 *                    the dashboard KPIs so the report reconciles with the tiles.
 *                    Money is reported as THREE distinct figures, never merged:
 *                    Cash Collected (captured/authorised payment rows in the
 *                    period), Order Value (gross total of the paid-state orders
 *                    — what was sold), and Outstanding Balance split into the
 *                    active receivable and the balances stranded on cancelled /
 *                    refunded / failed orders (reported, not collectable).
 *   • Orders       — one row per sales order (money in NGN + display currency).
 *   • Order Items  — one row per order line (product snapshot + line economics).
 *   • Payments     — one row per recorded payment (method, provider, fee, net).
 *
 * Read-only: pulls already-computed rows from sales.repo and never writes. The
 * builder is pure (rows in → Buffer out) so it can be unit-tested without a DB.
 * Maroon Noir house style: deep-red header (#690909) + cream text, frozen
 * header rows, zebra striping, ₦ number formats, bold totals.
 */

"use strict";

const ExcelJS = require("exceljs");
const { formatDateTime } = require("../../utils/dates");
const {
  REVENUE_STATES,
  COLLECTION_EXCLUDED_STATES,
  SETTLED_PAYMENT_STATUSES,
} = require("./order-status");

// ── House style ────────────────────────────────────────────
const ACCENT = "FF690909"; // Maroon Noir deep-red
const CREAM = "FFF4E9D9";
const ZEBRA = "FFF6F2F2";
const TITLE_FILL = "FF2A0A0A";
const NGN_FMT = "#,##0.00;[Red]-#,##0.00";
const INT_FMT = "#,##0";
const FX_FMT = "#,##0.0000";

// Paid-state orders — the lifecycle SSOT's revenue states (order-status.js).
// NOTE the naming: these are the states an order reaches once it was paid in
// full, so their `total_ngn` is the period's gross ORDER VALUE. It is not cash
// and it is not recognised revenue — the cash figure comes from the payment
// rows (SETTLED_PAYMENTS below) and recognition stays in the GL.
const PAID_STATES = new Set(REVENUE_STATES);

// Orders whose balance is NOT a receivable: draft, cancel-requested, cancelled,
// refunded, failed. Their balances stay on the rows (that is the audit trail —
// a cancelled order's history is never rewritten or zeroed), but they are
// reported apart from the live outstanding figure so the report cannot imply
// the business is owed money it can no longer collect. In the audited snapshot
// that distinction is ₦1,738,000 live vs ₦25,512,175 raw.
const DEAD_STATES = new Set(COLLECTION_EXCLUDED_STATES);

// Payment rows that are money in — the same set the DB trigger sums into
// `sales_orders.amount_paid_ngn`, so the report's cash figure reconciles with
// what each order shows as paid.
const SETTLED_PAYMENTS = new Set(SETTLED_PAYMENT_STATUSES);

const STATUS_LABELS = {
  draft: "Draft",
  pending_payment: "Pending Payment",
  partially_paid: "Partially Paid",
  paid: "Paid",
  assigned: "Assigned",
  order_ready: "Order Ready",
  dispatched: "Dispatched",
  completed: "Completed",
  cancellation_requested: "Cancellation Requested",
  cancelled: "Cancelled",
  refunded: "Refunded",
  // Legacy values (pre-lifecycle-collapse) kept so historical exports still label.
  awaiting_dispatch: "Order Ready",
  in_production: "Assigned",
  with_stylist: "Assigned",
  ready_for_dispatch: "Order Ready",
  in_transit: "Dispatched",
  out_for_delivery: "Dispatched",
  delivered: "Completed",
  returned: "Returned",
  failed: "Failed",
};
const CHANNEL_LABELS = {
  storefront: "Website",
  pos: "POS",
  woocommerce: "WooCommerce",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  wholesale: "Wholesale",
  partner: "Partner",
  stylist_routed: "Stylist",
  subscription: "Subscription",
  phone: "Phone",
  event: "Event",
  public_form: "Public Form",
  facebook: "Facebook",
  tiktok: "TikTok",
  intercompany: "Intercompany",
};
const labelStatus = (s) => STATUS_LABELS[s] || s || "—";
const labelChannel = (c) => CHANNEL_LABELS[c] || c || "—";

// ── Value coercion ─────────────────────────────────────────
/** Postgres NUMERIC comes back as a string — coerce for an Excel number cell. */
const num = (v) =>
  v === null || v === undefined || v === "" ? null : Number(v);
const fmtDate = (v) => formatDateTime(v);

// ── Styling helpers ────────────────────────────────────────
function styleHeader(ws, rowNumber = 1) {
  const row = ws.getRow(rowNumber);
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ACCENT },
    };
    cell.font = { bold: true, color: { argb: CREAM } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: ACCENT } } };
  });
  row.height = 22;
}

/** Add a data sheet with a styled header, ₦/number formats, zebra striping and
 *  an optional bold totals row. `columns` is [{header,key,width,fmt,align}]. */
function addTable(wb, name, columns, rows, { totals } = {}) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width ?? 18,
  }));
  styleHeader(ws);

  for (const r of rows) {
    const row = ws.addRow(r);
    columns.forEach((c, idx) => {
      const cell = row.getCell(idx + 1);
      if (c.fmt) cell.numFmt = c.fmt;
      if (c.align) cell.alignment = { horizontal: c.align };
    });
    if (row.number % 2 === 0) {
      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: ZEBRA },
        };
      });
    }
  }

  if (totals) {
    const row = ws.addRow(totals);
    row.eachCell((cell) => {
      cell.font = { bold: true };
      cell.border = { top: { style: "double", color: { argb: ACCENT } } };
    });
    columns.forEach((c, idx) => {
      if (c.fmt) row.getCell(idx + 1).numFmt = c.fmt;
    });
  }
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length },
  };
  return ws;
}

// ── Summary aggregation (pure) ─────────────────────────────
/**
 * @param {Object[]} orders   the period's sales_orders rows (reportOrders).
 * @param {Object[]} [payments] the period's payment rows (reportPayments) —
 *   the source of `cash_collected`, which is money that MOVED in the period and
 *   cannot be derived from the order rows (a deposit taken today on an order
 *   placed last month belongs to today's cash, and an order placed today that
 *   nobody has paid contributes none).
 * @param {?{cash_collected_ngn: string|number, payments: number}} [cash] the
 *   period's cash from the payment ledger scoped by capture time
 *   (reportCashCollected). Those rows are order-scoped, so without this the
 *   cash figure can only describe the payments the workbook lists — passing it
 *   makes the Summary reconcile with the Sales "Cash Collected MTD" tile.
 */
function summarise(orders, payments = [], cash = null) {
  const acc = {
    count: orders.length,
    subtotal: 0,
    discount: 0,
    tax: 0,
    shipping: 0,
    total: 0,
    paid: 0,
    balance: 0,
    // Live receivables vs balances stranded on dead orders (see DEAD_STATES).
    active_balance: 0,
    active_balance_orders: 0,
    dead_balance: 0,
    dead_balance_orders: 0,
    paid_orders: 0,
    // Gross order value of the paid-state orders — what was SOLD in the period.
    paid_order_value: 0,
    // Gross captured/authorised payments — what was COLLECTED in the period.
    cash_collected: 0,
    cash_payments: 0,
    by_status: new Map(),
    by_channel: new Map(),
  };
  const bump = (map, key, o) => {
    const e = map.get(key) || { count: 0, total: 0, paid: 0 };
    e.count += 1;
    e.total += num(o.total_ngn) || 0;
    e.paid += num(o.amount_paid_ngn) || 0;
    map.set(key, e);
  };
  for (const o of orders) {
    acc.subtotal += num(o.subtotal_ngn) || 0;
    acc.discount += num(o.discount_amount_ngn) || 0;
    acc.tax += num(o.tax_amount_ngn) || 0;
    acc.shipping += num(o.shipping_fee_ngn) || 0;
    acc.total += num(o.total_ngn) || 0;
    acc.paid += num(o.amount_paid_ngn) || 0;
    const balance = num(o.balance_due_ngn) || 0;
    acc.balance += balance;
    // Split the balance the same way the collection queue does: a live order's
    // balance is money still to collect, a dead order's is history.
    if (balance > 0) {
      if (DEAD_STATES.has(o.status)) {
        acc.dead_balance += balance;
        acc.dead_balance_orders += 1;
      } else {
        acc.active_balance += balance;
        acc.active_balance_orders += 1;
      }
    }
    if (PAID_STATES.has(o.status)) {
      acc.paid_orders += 1;
      acc.paid_order_value += num(o.total_ngn) || 0;
    }
    bump(acc.by_status, o.status, o);
    bump(acc.by_channel, o.sales_channel, o);
  }
  for (const p of payments) {
    // Pending / failed / refunded rows are not cash in. A row with no status at
    // all predates the status column and was counted as paid when it landed, so
    // it stays in (the same tolerance paid-currency.js applies).
    if (p.status && !SETTLED_PAYMENTS.has(p.status)) continue;
    acc.cash_collected += num(p.amount_ngn) || 0;
    acc.cash_payments += 1;
  }
  // `cash_scope` keeps the Summary row's label honest about what it counted:
  // the ledger figure is capture-time scoped (true period cash); the fallback
  // is only the payments belonging to the period's orders.
  acc.cash_scope = "listed";
  if (
    cash &&
    (cash.cash_collected_ngn !== undefined || cash.payments !== undefined)
  ) {
    acc.cash_collected = num(cash.cash_collected_ngn) || 0;
    acc.cash_payments = Number(cash.payments) || 0;
    acc.cash_scope = "period";
  }
  return acc;
}

// ── Summary sheet ──────────────────────────────────────────
function buildSummarySheet(wb, ctx, s) {
  const ws = wb.addWorksheet("Summary");
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 22;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 18;

  // Title banner
  ws.mergeCells("A1:D1");
  const title = ws.getCell("A1");
  title.value = "Sales Report";
  title.font = {
    name: "Playfair Display",
    size: 20,
    bold: true,
    color: { argb: CREAM },
  };
  title.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: TITLE_FILL },
  };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 36;

  const meta = [
    ["Business", ctx.brandLabel],
    ["Period", `${ctx.fromLabel}  —  ${ctx.toLabel}`],
    [
      "Generated",
      `${ctx.generatedAt}${ctx.generatedBy ? `  ·  ${ctx.generatedBy}` : ""}`,
    ],
  ];
  let r = 2;
  for (const [k, v] of meta) {
    ws.getCell(`A${r}`).value = k;
    ws.getCell(`A${r}`).font = { bold: true, color: { argb: ACCENT } };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value = v;
    r += 1;
  }
  r += 1;

  const section = (label) => {
    ws.mergeCells(`A${r}:D${r}`);
    const cell = ws.getCell(`A${r}`);
    cell.value = label;
    cell.font = { bold: true, color: { argb: CREAM } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: ACCENT },
    };
    cell.alignment = { indent: 1 };
    ws.getRow(r).height = 20;
    r += 1;
  };
  const moneyRow = (label, value, opts = {}) => {
    ws.getCell(`A${r}`).value = label;
    if (opts.bold) ws.getCell(`A${r}`).font = { bold: true };
    const c = ws.getCell(`B${r}`);
    c.value = value;
    c.numFmt = NGN_FMT;
    if (opts.bold) c.font = { bold: true };
    r += 1;
  };

  // Headline totals
  section("Totals (₦)");
  ws.getCell(`A${r}`).value = "Total Orders";
  ws.getCell(`B${r}`).value = s.count;
  ws.getCell(`B${r}`).numFmt = INT_FMT;
  r += 1;
  moneyRow("Subtotal (Goods)", round2(s.subtotal));
  moneyRow("Discounts", round2(s.discount));
  moneyRow("VAT / Tax", round2(s.tax));
  moneyRow("Logistics / Shipping", round2(s.shipping));
  moneyRow("Gross Sales (Total)", round2(s.total), { bold: true });
  moneyRow("Collected on These Orders", round2(s.paid));
  moneyRow(
    `Outstanding Balance (active · ${s.active_balance_orders} orders)`,
    round2(s.active_balance),
    {
      bold: true,
    },
  );
  if (s.dead_balance_orders > 0) {
    // Reported, never collected: balances left on cancelled / refunded / failed
    // / draft orders. The rows keep their history (nothing is zeroed), they are
    // simply not receivables — which is why the live figure above excludes them.
    moneyRow(
      `Not Collectable (cancelled/refunded/failed · ${s.dead_balance_orders} orders)`,
      round2(s.dead_balance),
    );
  }
  r += 1;
  ws.getCell(`A${r}`).value =
    "Paid-state Orders (paid / assigned / ready / dispatched / completed)";
  ws.getCell(`B${r}`).value = s.paid_orders;
  ws.getCell(`B${r}`).numFmt = INT_FMT;
  r += 1;
  // Gross order value of those orders — what the period SOLD. Deliberately not
  // called revenue: it includes balances nobody has paid and excludes deposits
  // taken in the period against older orders.
  moneyRow("Order Value (paid-state orders)", round2(s.paid_order_value), {
    bold: true,
  });
  // Cash that actually moved: captured/authorised payment rows. "In period" =
  // scoped by when each payment landed (reconciles with the Sales KPI tile);
  // "listed" = only the payments belonging to this period's orders.
  ws.getCell(`A${r}`).value =
    s.cash_scope === "period"
      ? `Cash Collected in Period (${s.cash_payments} payments)`
      : `Cash Collected on These Orders (${s.cash_payments} payments)`;
  ws.getCell(`A${r}`).font = { bold: true };
  const cashCell = ws.getCell(`B${r}`);
  cashCell.value = round2(s.cash_collected);
  cashCell.numFmt = NGN_FMT;
  cashCell.font = { bold: true };
  r += 1;
  r += 1;

  // By status
  section("By Status");
  styleSubHeader(ws, r, ["Status", "Orders", "Total (₦)", "Collected (₦)"]);
  r += 1;
  for (const [status, e] of sortByTotal(s.by_status)) {
    ws.getCell(`A${r}`).value = labelStatus(status);
    ws.getCell(`B${r}`).value = e.count;
    ws.getCell(`B${r}`).numFmt = INT_FMT;
    ws.getCell(`C${r}`).value = round2(e.total);
    ws.getCell(`C${r}`).numFmt = NGN_FMT;
    ws.getCell(`D${r}`).value = round2(e.paid);
    ws.getCell(`D${r}`).numFmt = NGN_FMT;
    r += 1;
  }
  r += 1;

  // By channel
  section("By Channel");
  styleSubHeader(ws, r, ["Channel", "Orders", "Total (₦)", "Collected (₦)"]);
  r += 1;
  for (const [channel, e] of sortByTotal(s.by_channel)) {
    ws.getCell(`A${r}`).value = labelChannel(channel);
    ws.getCell(`B${r}`).value = e.count;
    ws.getCell(`B${r}`).numFmt = INT_FMT;
    ws.getCell(`C${r}`).value = round2(e.total);
    ws.getCell(`C${r}`).numFmt = NGN_FMT;
    ws.getCell(`D${r}`).value = round2(e.paid);
    ws.getCell(`D${r}`).numFmt = NGN_FMT;
    r += 1;
  }
  return ws;
}

function styleSubHeader(ws, rowNumber, headers) {
  headers.forEach((h, idx) => {
    const cell = ws.getCell(rowNumber, idx + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: CREAM } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF8A1A1A" },
    };
  });
}
const sortByTotal = (map) =>
  [...map.entries()].sort((a, b) => b[1].total - a[1].total);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── Public: build the workbook ─────────────────────────────
/**
 * @param {Object} opts
 * @param {string} opts.brandLabel  Human business name.
 * @param {string} opts.fromLabel   Period start (display).
 * @param {string} opts.toLabel     Period end (display).
 * @param {string} opts.generatedAt Timestamp (display).
 * @param {string} [opts.generatedBy] User who exported.
 * @param {Object[]} opts.orders    sales.repo.reportOrders rows.
 * @param {Object[]} opts.lines     sales.repo.reportLines rows.
 * @param {Object[]} opts.payments  sales.repo.reportPayments rows.
 * @param {Object} [opts.cash]      sales.repo.reportCashCollected row — period
 *   cash scoped by capture time (see summarise).
 * @returns {Promise<Buffer>}
 */
async function buildWorkbook(opts) {
  const { orders, lines, payments, cash = null } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pixie Girl Hub";
  wb.created = new Date();
  wb.title = `Sales Report — ${opts.brandLabel}`;

  // The summary reads BOTH ledgers: order rows for what was sold / is still
  // owed, payment rows for what was actually collected in the period.
  const summary = summarise(orders, payments, cash);
  buildSummarySheet(wb, opts, summary);

  // Orders sheet
  const orderRows = orders.map((o) => ({
    order_number: o.order_number,
    placed_at: fmtDate(o.placed_at || o.created_at),
    customer: o.contact_name || "—",
    channel: labelChannel(o.sales_channel),
    type: o.order_type,
    custom: o.is_custom_order ? "Yes" : "",
    status: labelStatus(o.status),
    subtotal_ngn: num(o.subtotal_ngn),
    discount_ngn: num(o.discount_amount_ngn),
    tax_ngn: num(o.tax_amount_ngn),
    shipping_ngn: num(o.shipping_fee_ngn),
    total_ngn: num(o.total_ngn),
    paid_ngn: num(o.amount_paid_ngn),
    balance_ngn: num(o.balance_due_ngn),
    display_currency: o.display_currency,
    display_total: num(o.display_total),
    fx_rate: num(o.fx_rate_used),
    coupon: o.coupon_code || "",
    campaign: o.campaign_name || "",
    closed_by: o.closed_by_name || "",
    paid_at: fmtDate(o.paid_at),
  }));
  addTable(
    wb,
    "Orders",
    [
      { header: "Order #", key: "order_number", width: 16 },
      { header: "Date", key: "placed_at", width: 17 },
      { header: "Customer", key: "customer", width: 24 },
      { header: "Channel", key: "channel", width: 14 },
      { header: "Type", key: "type", width: 12 },
      { header: "Custom", key: "custom", width: 9, align: "center" },
      { header: "Status", key: "status", width: 18 },
      { header: "Subtotal ₦", key: "subtotal_ngn", width: 15, fmt: NGN_FMT },
      { header: "Discount ₦", key: "discount_ngn", width: 14, fmt: NGN_FMT },
      { header: "Tax ₦", key: "tax_ngn", width: 13, fmt: NGN_FMT },
      { header: "Shipping ₦", key: "shipping_ngn", width: 14, fmt: NGN_FMT },
      { header: "Total ₦", key: "total_ngn", width: 16, fmt: NGN_FMT },
      { header: "Paid ₦", key: "paid_ngn", width: 15, fmt: NGN_FMT },
      { header: "Balance ₦", key: "balance_ngn", width: 15, fmt: NGN_FMT },
      {
        header: "Disp. Ccy",
        key: "display_currency",
        width: 10,
        align: "center",
      },
      { header: "Disp. Total", key: "display_total", width: 14, fmt: NGN_FMT },
      { header: "FX Rate", key: "fx_rate", width: 12, fmt: FX_FMT },
      { header: "Coupon", key: "coupon", width: 14 },
      { header: "Campaign", key: "campaign", width: 18 },
      { header: "Closed By", key: "closed_by", width: 18 },
      { header: "Paid At", key: "paid_at", width: 17 },
    ],
    orderRows,
    {
      totals: {
        order_number: "TOTAL",
        status: `${summary.count} orders`,
        subtotal_ngn: round2(summary.subtotal),
        discount_ngn: round2(summary.discount),
        tax_ngn: round2(summary.tax),
        shipping_ngn: round2(summary.shipping),
        total_ngn: round2(summary.total),
        paid_ngn: round2(summary.paid),
        balance_ngn: round2(summary.balance),
      },
    },
  );

  // Order Items sheet
  const lineRows = lines.map((l) => ({
    order_number: l.order_number,
    status: labelStatus(l.status),
    product: l.product_name_snapshot,
    variant: l.variant_label_snapshot || "",
    sku: l.sku_snapshot || "",
    qty: num(l.quantity),
    unit_price_ngn: num(l.unit_price_ngn),
    line_discount_ngn: num(l.line_discount_ngn),
    tax_ngn: num(l.tax_amount_ngn),
    line_total_ngn: num(l.line_total_ngn),
  }));
  const lineUnits = lineRows.reduce((a, x) => a + (x.qty || 0), 0);
  const lineTotal = lineRows.reduce((a, x) => a + (x.line_total_ngn || 0), 0);
  addTable(
    wb,
    "Order Items",
    [
      { header: "Order #", key: "order_number", width: 16 },
      { header: "Status", key: "status", width: 16 },
      { header: "Product", key: "product", width: 34 },
      { header: "Variant", key: "variant", width: 22 },
      { header: "SKU", key: "sku", width: 18 },
      { header: "Qty", key: "qty", width: 8, fmt: INT_FMT, align: "right" },
      {
        header: "Unit Price ₦",
        key: "unit_price_ngn",
        width: 15,
        fmt: NGN_FMT,
      },
      {
        header: "Line Discount ₦",
        key: "line_discount_ngn",
        width: 16,
        fmt: NGN_FMT,
      },
      { header: "Tax ₦", key: "tax_ngn", width: 13, fmt: NGN_FMT },
      {
        header: "Line Total ₦",
        key: "line_total_ngn",
        width: 16,
        fmt: NGN_FMT,
      },
    ],
    lineRows,
    {
      totals: {
        order_number: "TOTAL",
        qty: lineUnits,
        line_total_ngn: round2(lineTotal),
      },
    },
  );

  // Payments sheet
  const payRows = payments.map((p) => ({
    order_number: p.order_number,
    payment_number: p.payment_number,
    method: p.method,
    provider: p.provider || "",
    reference: p.provider_reference || "",
    amount_ngn: num(p.amount_ngn),
    fee_ngn: num(p.fee_ngn),
    net_ngn: num(p.net_received_ngn),
    paid_currency: p.paid_currency || "",
    paid_amount: num(p.paid_amount),
    status: p.status,
    captured_at: fmtDate(p.captured_at || p.recorded_at),
  }));
  const payAmount = payRows.reduce((a, x) => a + (x.amount_ngn || 0), 0);
  const payFee = payRows.reduce((a, x) => a + (x.fee_ngn || 0), 0);
  const payNet = payRows.reduce((a, x) => a + (x.net_ngn || 0), 0);
  addTable(
    wb,
    "Payments",
    [
      { header: "Order #", key: "order_number", width: 16 },
      { header: "Payment #", key: "payment_number", width: 16 },
      { header: "Method", key: "method", width: 18 },
      { header: "Provider", key: "provider", width: 12 },
      { header: "Reference", key: "reference", width: 26 },
      { header: "Amount ₦", key: "amount_ngn", width: 15, fmt: NGN_FMT },
      { header: "Fee ₦", key: "fee_ngn", width: 12, fmt: NGN_FMT },
      { header: "Net ₦", key: "net_ngn", width: 15, fmt: NGN_FMT },
      { header: "Paid Ccy", key: "paid_currency", width: 10, align: "center" },
      { header: "Paid Amt", key: "paid_amount", width: 13, fmt: NGN_FMT },
      { header: "Status", key: "status", width: 14 },
      { header: "Captured At", key: "captured_at", width: 17 },
    ],
    payRows,
    {
      totals: {
        order_number: "TOTAL",
        amount_ngn: round2(payAmount),
        fee_ngn: round2(payFee),
        net_ngn: round2(payNet),
      },
    },
  );

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

module.exports = { buildWorkbook };
// Exposed for unit tests (no DB needed).
module.exports._internals = {
  summarise,
  labelStatus,
  labelChannel,
  num,
  round2,
  PAID_STATES,
  DEAD_STATES,
  SETTLED_PAYMENTS,
};
