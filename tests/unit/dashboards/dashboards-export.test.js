"use strict";

/**
 * Dashboard Excel export — pure builder tests (no database).
 *
 * The domain workbook must carry the Summary sheet (title + period meta +
 * KPI block with Δ%), one sheet per chart, one per detail dataset, money
 * number formats, and round-trip through the .xlsx binary. Sheet names must
 * dedupe rather than crash.
 */

process.env.DB_HOST = process.env.DB_HOST || "localhost";
process.env.DB_NAME = process.env.DB_NAME || "test";
process.env.DB_USER = process.env.DB_USER || "test";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "test";
process.env.REDIS_HOST = process.env.REDIS_HOST || "localhost";
process.env.JWT_SECRET = process.env.JWT_SECRET || "x".repeat(40);
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "y".repeat(40);
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "z".repeat(64);

const ExcelJS = require("exceljs");
const xl = require("../../../src/services/excel/workbook");
const xport = require("../../../src/modules/dashboards/dashboards.export");

const { buildDomainWorkbook, buildReportRunWorkbook, chartRows } =
  xport._internals;

const PAYLOAD = {
  domain: "sales",
  label: "Sales",
  period: { from: "2026-06-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z", granularity: "day" },
  previous_period: { from: "2026-05-02T00:00:00.000Z", to: "2026-05-31T23:59:59.999Z" },
  kpis: [
    { key: "revenue", label: "Revenue", format: "money", value: "1500000.00", previous: "1000000.00", delta_pct: 50 },
    { key: "orders", label: "Orders", format: "int", value: 42, previous: 40, delta_pct: 5 },
    { key: "quote_conversion", label: "Quote Conversion", format: "pct", value: 61.5, previous: null, delta_pct: null },
  ],
  charts: [
    {
      key: "revenue_trend",
      label: "Revenue Trend",
      type: "line",
      series: [
        { key: "current", label: "This period", points: [{ x: "2026-06-01", y: 50000 }, { x: "2026-06-02", y: 75000 }] },
        { key: "previous", label: "Previous period", points: [{ x: "2026-05-02", y: 40000 }] },
      ],
    },
    {
      key: "channel_breakdown",
      label: "Revenue by Channel",
      type: "donut",
      slices: [
        { label: "storefront", orders: 30, value: 900000 },
        { label: "instagram", orders: 12, value: 600000 },
      ],
    },
    { key: "empty_chart", label: "Empty", type: "donut", slices: [] },
  ],
  tables: [],
};

const DETAIL = {
  label: "Orders",
  columns: [
    { key: "order_number", label: "Order #", format: "text" },
    { key: "placed_at", label: "Placed", format: "datetime" },
    { key: "total_ngn", label: "Total ₦", format: "money" },
  ],
  rows: [
    { order_number: "PXG-SO-0001", placed_at: "2026-06-03T10:00:00Z", total_ngn: "250000.00" },
    { order_number: "PXG-SO-0002", placed_at: "2026-06-04T12:30:00Z", total_ngn: "125000.50" },
  ],
};

describe("buildDomainWorkbook", () => {
  test("emits Summary + chart sheets + detail sheets and round-trips", async () => {
    const wb = buildDomainWorkbook({
      brandLabel: "pixiegirl",
      payload: PAYLOAD,
      detailSets: [DETAIL],
      generatedBy: "ceo@pixiegirl.ng",
      generatedAt: new Date("2026-07-02T09:00:00Z"),
    });
    const names = wb.worksheets.map((ws) => ws.name);
    expect(names).toContain("Summary");
    expect(names).toContain("Revenue Trend");
    expect(names).toContain("Revenue by Channel");
    expect(names).toContain("Orders");
    // Empty charts are skipped, not emitted as blank sheets.
    expect(names).not.toContain("Empty");

    const buf = await xl.toBuffer(wb);
    const round = new ExcelJS.Workbook();
    await round.xlsx.load(buf);
    const summary = round.getWorksheet("Summary");
    expect(summary.getCell("A1").value).toBe("Sales Dashboard");

    // KPI block carries value + previous + Δ% with money formatting.
    let revenueRow = null;
    summary.eachRow((row, n) => {
      if (row.getCell(1).value === "Revenue") revenueRow = n;
    });
    expect(revenueRow).not.toBeNull();
    expect(summary.getCell(revenueRow, 2).value).toBe(1500000);
    expect(summary.getCell(revenueRow, 3).value).toBe(1000000);
    expect(summary.getCell(revenueRow, 4).value).toBe(50);

    // Detail money cells are numbers with the ₦ format.
    const orders = round.getWorksheet("Orders");
    expect(orders.getCell(2, 3).value).toBe(250000);
    expect(orders.getCell(2, 3).numFmt).toBe(xl.NGN_FMT);
    // Header row is styled + frozen.
    expect(orders.views[0].ySplit).toBe(1);
  });

  test("series charts pivot into one row per x", () => {
    const rows = chartRows(PAYLOAD.charts[0]);
    expect(rows).toEqual([
      { x: "2026-06-01", current: 50000 },
      { x: "2026-06-02", current: 75000 },
      { x: "2026-05-02", previous: 40000 },
    ]);
  });
});

describe("sheet-name handling", () => {
  test("duplicate and illegal sheet names are made safe", () => {
    const wb = xl.newWorkbook();
    const cols = [{ key: "a", label: "A", format: "text" }];
    xl.addManifestTable(wb, "Report: 2026/06", cols, []);
    xl.addManifestTable(wb, "Report: 2026/06", cols, []);
    const names = wb.worksheets.map((ws) => ws.name);
    expect(names[0]).toBe("Report  2026 06");
    expect(names[1]).toBe("Report  2026 06 (2)");
  });
});

describe("buildReportRunWorkbook", () => {
  test("array payloads become tables, object payloads become metric rows", async () => {
    const wb = buildReportRunWorkbook({
      run: {
        run_number: "PXG-RPT-0007",
        template_name: "Weekly Sales Report",
        status: "confirmed",
        period_start: "2026-06-21T00:00:00Z",
        period_end: "2026-06-28T00:00:00Z",
        created_at: "2026-06-28T20:00:00Z",
        outputs: [
          {
            inline_payload: {
              totals: { orders: 12, revenue_ngn: "480000.00" },
              top_products: [
                { product: "Pixie Bob 12\"", units: 5, revenue_ngn: "200000.00" },
                { product: "Deep Wave 20\"", units: 3, revenue_ngn: "180000.00" },
              ],
            },
          },
        ],
      },
    });
    const names = wb.worksheets.map((ws) => ws.name);
    expect(names[0]).toBe("Summary");
    expect(names.some((n) => n.includes("totals"))).toBe(true);
    expect(names.some((n) => n.includes("top products"))).toBe(true);
    const buf = await xl.toBuffer(wb);
    expect(buf.length).toBeGreaterThan(1000);
  });
});
