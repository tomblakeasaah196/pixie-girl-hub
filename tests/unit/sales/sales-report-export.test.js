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

  it("counts realised revenue only for PAID_STATES", () => {
    expect(s.paid_orders).toBe(1);
    expect(round2(s.paid_revenue)).toBe(99000); // only FLH-SO-0001 (paid)
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
