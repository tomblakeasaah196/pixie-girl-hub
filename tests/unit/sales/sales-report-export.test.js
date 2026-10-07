"use strict";

/**
 * Sales report export — builder-level tests (no database).
 *
 * Verifies the period summary aggregation (totals, paid-revenue, by-status and
 * by-channel rollups) and that buildWorkbook emits a valid four-sheet .xlsx
 * that round-trips through the binary format.
 */

// The builder pulls TZ from config/env via the dates util (eager read at load),
// so satisfy the env schema with throwaway values before requiring it. No DB or
// network is touched — these only let config validation pass.
process.env.DB_HOST = process.env.DB_HOST || "localhost";
process.env.DB_NAME = process.env.DB_NAME || "test";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";
process.env.REDIS_HOST = process.env.REDIS_HOST || "localhost";
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(40);
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "y".repeat(40);
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "z".repeat(64);

const ExcelJS = require("exceljs");
const xport = require("../../../src/modules/sales/sales-report.export");

const { summarise, round2, labelStatus, labelChannel } = xport._internals;

const ORDERS = [
  {
    order_number: "FLH-SO-0001",
    status: "paid",
    sales_channel: "instagram",
    order_type: "dispatch",
    is_custom_order: false,
    subtotal_ngn: "100000.00",
    discount_amount_ngn: "5000.00",
    tax_amount_ngn: "0.00",
    shipping_fee_ngn: "4000.00",
    total_ngn: "99000.00",
    amount_paid_ngn: "99000.00",
    balance_due_ngn: "0.00",
    display_currency: "NGN",
    display_total: null,
    fx_rate_used: "1.000000",
    coupon_code: null,
    payment_model: "full_payment_only",
    placed_at: "2026-01-05T10:00:00Z",
    paid_at: "2026-01-05T10:05:00Z",
    created_at: "2026-01-05T09:59:00Z",
    contact_name: "Ada Test",
    closed_by_name: "Staff One",
    campaign_name: null,
  },
  {
    order_number: "FLH-SO-0002",
    status: "pending_payment",
    sales_channel: "whatsapp",
    order_type: "walk_in",
    is_custom_order: true,
    subtotal_ngn: "50000.00",
    discount_amount_ngn: "0.00",
    tax_amount_ngn: "3750.00",
    shipping_fee_ngn: "0.00",
    total_ngn: "53750.00",
    amount_paid_ngn: "20000.00",
    balance_due_ngn: "33750.00",
    display_currency: "USD",
    display_total: "35.00",
    fx_rate_used: "1535.000000",
    coupon_code: "WELCOME",
    payment_model: "deposit_triggered",
    placed_at: null,
    paid_at: null,
    created_at: "2026-01-06T12:00:00Z",
    contact_name: "Bola Test",
    closed_by_name: null,
    campaign_name: "Launch",
  },
];

describe("sales report — summarise", () => {
  const s = summarise(ORDERS);

  it("sums order economics across the period", () => {
    expect(s.count).toBe(2);
    expect(round2(s.total)).toBe(152750);
    expect(round2(s.subtotal)).toBe(150000);
    expect(round2(s.discount)).toBe(5000);
    expect(round2(s.tax)).toBe(3750);
    expect(round2(s.shipping)).toBe(4000);
    expect(round2(s.paid)).toBe(119000); // amount collected (across all statuses)
    expect(round2(s.balance)).toBe(33750);
  });

  it("counts gross ORDER VALUE only for PAID_STATES (not revenue, not cash)", () => {
    expect(s.paid_orders).toBe(1);
    // Only FLH-SO-0001 (paid). This is what was SOLD — the workbook labels it
    // "Order Value (paid-state orders)"; the cash figure is separate.
    expect(round2(s.paid_order_value)).toBe(99000);
  });

  it("rolls up by status and by channel", () => {
    expect(s.by_status.get("paid").count).toBe(1);
    expect(round2(s.by_status.get("paid").total)).toBe(99000);
    expect(s.by_channel.get("instagram").count).toBe(1);
    expect(s.by_channel.get("whatsapp").count).toBe(1);
  });

  it("handles an empty period without throwing", () => {
    const e = summarise([]);
    expect(e.count).toBe(0);
    expect(round2(e.total)).toBe(0);
    expect(e.paid_orders).toBe(0);
  });
});

describe("sales report — collections split + period cash", () => {
  // A cancelled order keeps its balance on the row (history is never zeroed),
  // but that balance is not a receivable: the report splits it out instead of
  // folding it into "Outstanding Balance".
  const WITH_DEAD = [
    ...ORDERS,
    {
      order_number: "FLH-SO-0003",
      status: "cancelled",
      sales_channel: "whatsapp",
      subtotal_ngn: "300000.00",
      discount_amount_ngn: "0.00",
      tax_amount_ngn: "0.00",
      shipping_fee_ngn: "0.00",
      total_ngn: "300000.00",
      amount_paid_ngn: "0.00",
      balance_due_ngn: "300000.00",
    },
  ];

  it("separates live receivables from balances stranded on dead orders", () => {
    const s = summarise(WITH_DEAD);
    expect(round2(s.balance)).toBe(333750); // raw positive-balance total
    expect(round2(s.active_balance)).toBe(33750); // FLH-SO-0002 only
    expect(s.active_balance_orders).toBe(1);
    expect(round2(s.dead_balance)).toBe(300000); // FLH-SO-0003 (cancelled)
    expect(s.dead_balance_orders).toBe(1);
    // active + dead must reconcile with the raw total, never lose a naira.
    expect(round2(s.active_balance + s.dead_balance)).toBe(round2(s.balance));
  });

  it("counts only captured/authorised payment rows as cash", () => {
    const s = summarise(ORDERS, [
      { status: "captured", amount_ngn: "50000.00" },
      { status: "authorised", amount_ngn: "25000.00" },
      { status: "pending", amount_ngn: "99999.00" },
      { status: "failed", amount_ngn: "99999.00" },
      { status: "refunded", amount_ngn: "99999.00" },
    ]);
    expect(round2(s.cash_collected)).toBe(75000);
    expect(s.cash_payments).toBe(2);
    expect(s.cash_scope).toBe("listed");
  });

  it("prefers the capture-time ledger figure when the service supplies it", () => {
    // reportPayments rows are order-scoped; reportCashCollected is scoped by
    // when the money landed. The Summary must show the latter (that is what
    // reconciles with the Sales "Cash Collected MTD" tile).
    const s = summarise(
      ORDERS,
      [{ status: "captured", amount_ngn: "99000.00" }],
      { cash_collected_ngn: "1480000.00", payments: 7 },
    );
    expect(round2(s.cash_collected)).toBe(1480000);
    expect(s.cash_payments).toBe(7);
    expect(s.cash_scope).toBe("period");
  });

  it("labels the cash row in the Summary sheet", async () => {
    const buf = await xport.buildWorkbook({
      brandLabel: "Faitlynhair",
      fromLabel: "2026-01-01",
      toLabel: "2026-01-31",
      generatedAt: "2026-01-31 17:00",
      generatedBy: null,
      orders: WITH_DEAD,
      lines: [],
      payments: [],
      cash: { cash_collected_ngn: "1480000.00", payments: 7 },
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const labels = [];
    wb.getWorksheet("Summary").eachRow((row) => {
      const v = row.getCell(1).value;
      if (typeof v === "string") labels.push(v);
    });
    expect(labels).toContain("Cash Collected in Period (7 payments)");
    expect(labels).toContain("Outstanding Balance (active · 1 orders)");
    expect(labels).toContain(
      "Not Collectable (cancelled/refunded/failed · 1 orders)",
    );
    expect(labels).toContain("Order Value (paid-state orders)");
    // The old mislabel must be gone: gross order value is never "revenue".
    expect(labels.some((l) => /revenue/i.test(l))).toBe(false);
  });
});

describe("sales report — labels", () => {
  it("maps known statuses and channels to human labels", () => {
    expect(labelStatus("pending_payment")).toBe("Pending Payment");
    expect(labelChannel("storefront")).toBe("Website");
  });
  it("falls back to the raw value for unknown keys", () => {
    expect(labelStatus("some_new_status")).toBe("some_new_status");
    expect(labelChannel("")).toBe("—");
  });
});

describe("sales report — buildWorkbook", () => {
  it("emits a valid four-sheet workbook", async () => {
    const buf = await xport.buildWorkbook({
      brandLabel: "Faitlynhair",
      fromLabel: "2026-01-01",
      toLabel: "2026-01-31",
      generatedAt: "2026-01-31 17:00",
      generatedBy: "Owner",
      orders: ORDERS,
      lines: [
        {
          order_number: "FLH-SO-0001",
          status: "paid",
          product_name_snapshot: "Bone Straight 24",
          variant_label_snapshot: "Natural Black",
          sku_snapshot: "BS-24-NB",
          quantity: 1,
          unit_price_ngn: "100000.00",
          line_discount_ngn: "5000.00",
          tax_amount_ngn: "0.00",
          line_total_ngn: "95000.00",
          display_order: 0,
        },
      ],
      payments: [
        {
          order_number: "FLH-SO-0001",
          payment_number: "FLH-PAY-0001",
          method: "paystack_transfer",
          provider: "paystack",
          provider_reference: "ref_123",
          amount_ngn: "99000.00",
          fee_ngn: "1485.00",
          net_received_ngn: "97515.00",
          status: "captured",
          paid_currency: null,
          paid_amount: null,
          captured_at: "2026-01-05T10:05:00Z",
          recorded_at: "2026-01-05T10:05:00Z",
        },
      ],
    });

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Summary",
      "Orders",
      "Order Items",
      "Payments",
    ]);
    // Orders sheet: header row + 2 data rows + totals row.
    expect(wb.getWorksheet("Orders").rowCount).toBe(4);
  });

  it("builds an empty-period workbook without throwing", async () => {
    const buf = await xport.buildWorkbook({
      brandLabel: "Faitlynhair",
      fromLabel: "Beginning",
      toLabel: "Today",
      generatedAt: "2026-01-31 17:00",
      generatedBy: null,
      orders: [],
      lines: [],
      payments: [],
    });
    expect(buf.length).toBeGreaterThan(0);
  });
});
