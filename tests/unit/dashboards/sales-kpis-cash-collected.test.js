"use strict";

/**
 * Sales KPIs — the monthly money headline is CASH COLLECTED, not gross order
 * value.
 *
 * The tile used to read `revenue_mtd` = SUM(total_ngn) over the revenue-state
 * orders placed this month. That is a fulfilment-lifecycle figure: it counts
 * orders nobody has paid (a dispatched order with a balance open is in it at its
 * FULL total), it misses a deposit taken today on an order placed last month,
 * and it labels all of that "revenue". The production audit's decision is that
 * the primary monthly money KPI must be gross captured/authorised customer
 * payments recorded in the current Lagos calendar month — read from the payment
 * ledger, never from an order status.
 *
 * Gross order value stays available, under its own accurate name
 * (`order_value_mtd`). Accounting journals are untouched by all of this.
 */

jest.mock("../../../src/config/database", () => ({
  ex: (client) => client.query.bind(client),
  query: jest.fn(),
  transaction: jest.fn(),
}));

const { query } = require("../../../src/config/database");
const repo = require("../../../src/modules/dashboards/dashboards.repo");
const {
  SETTLED_PAYMENT_STATUSES_SQL,
} = require("../../../src/modules/sales/order-status");

const BRAND = "faitlynhair";
const LAGOS_MONTH_START =
  "(date_trunc('month', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos')";

/** Route each of the three KPI queries to a recognisable row set. */
function mockKpiQueries() {
  query.mockImplementation((sql) => {
    if (/sales_order_payments/.test(sql))
      return Promise.resolve({
        rows: [{ cash_collected_mtd: "1738000.00", payments_mtd: 4 }],
      });
    if (/quotations/.test(sql))
      return Promise.resolve({ rows: [{ open_quotes: 2 }] });
    return Promise.resolve({
      rows: [
        {
          orders_mtd: 9,
          order_value_mtd: "2500000.00",
          pending_payment_count: 3,
          avg_order_value: "277777.78",
        },
      ],
    });
  });
}

function sqlFor(pattern) {
  const call = query.mock.calls.find(([sql]) => pattern.test(sql));
  if (!call) throw new Error(`no query matched ${pattern}`);
  return { sql: call[0], params: call[1] };
}

beforeEach(() => {
  mockKpiQueries();
});

describe("salesKpis — cash collected MTD", () => {
  test("reads the payment ledger, not the order lifecycle", async () => {
    await repo.salesKpis({ brand: BRAND });
    const { sql } = sqlFor(/sales_order_payments/);
    expect(sql).toMatch(/SUM\(amount_ngn\)/);
    expect(sql).toMatch(/AS cash_collected_mtd/);
    // Gross order value and fulfilment statuses cannot answer "what did we
    // collect" — neither belongs in the cash query.
    expect(sql).not.toMatch(/total_ngn/);
    expect(sql).not.toMatch(/sales_orders/);
    expect(sql).not.toMatch(
      /'paid'|'assigned'|'order_ready'|'dispatched'|'completed'/,
    );
    expect(sql).not.toMatch(/'pending_payment'/);
  });

  test("counts only captured/authorised payments — the set amount_paid_ngn is built from", async () => {
    await repo.salesKpis({ brand: BRAND });
    const { sql } = sqlFor(/sales_order_payments/);
    expect(SETTLED_PAYMENT_STATUSES_SQL).toBe("('captured','authorised')");
    expect(sql).toContain(`status IN ${SETTLED_PAYMENT_STATUSES_SQL}`);
    // A pending / failed / refunded row never arrived (or went back).
    expect(sql).not.toMatch(/'refunded'/);
    expect(sql).not.toMatch(/'failed'/);
  });

  test("dates each payment by when the money landed (captured_at, else recorded_at)", async () => {
    await repo.salesKpis({ brand: BRAND });
    const { sql } = sqlFor(/sales_order_payments/);
    expect(sql).toMatch(/COALESCE\(captured_at, recorded_at\) BETWEEN/);
  });

  test("defaults to the current Lagos calendar month, computed in SQL", async () => {
    await repo.salesKpis({ brand: BRAND });
    const { sql } = sqlFor(/sales_order_payments/);
    expect(sql).toContain(LAGOS_MONTH_START);
    expect(sql).toMatch(
      /BETWEEN \(date_trunc\('month', now\(\) AT TIME ZONE 'Africa\/Lagos'\).*AND now\(\)/s,
    );
  });

  test("honours an explicit window with the SAME bounds as the order query", async () => {
    const from = "2026-09-01T00:00:00.000Z";
    const to = "2026-09-30T23:59:59.999Z";
    await repo.salesKpis({ brand: BRAND, from, to });
    const cash = sqlFor(/sales_order_payments/);
    const orders = sqlFor(/FROM faitlynhair\.sales_orders/);
    expect(cash.params).toEqual([from, to]);
    expect(orders.params).toEqual([from, to]);
    expect(cash.sql).toMatch(/BETWEEN \$1::timestamptz AND \$2::timestamptz/);
  });

  test("reports cash alongside — never as — gross order value", async () => {
    const kpis = await repo.salesKpis({ brand: BRAND });
    expect(kpis.cash_collected_mtd).toBe("1738000.00");
    expect(kpis.payments_mtd).toBe(4);
    expect(kpis.order_value_mtd).toBe("2500000.00");
    // The mislabelled field is gone: nothing may call gross order value revenue.
    expect(kpis.revenue_mtd).toBeUndefined();
    const everySql = query.mock.calls.map(([sql]) => sql).join("\n");
    expect(everySql).not.toMatch(/AS revenue_mtd/);
  });

  test("keeps the surrounding KPIs intact", async () => {
    const kpis = await repo.salesKpis({ brand: BRAND });
    expect(kpis.orders_mtd).toBe(9);
    expect(kpis.pending_payment_count).toBe(3);
    expect(kpis.avg_order_value).toBe("277777.78");
    expect(kpis.open_quotes).toBe(2);
  });
});

describe("overview — the Command Center mapping", () => {
  const service = require("../../../src/modules/dashboards/dashboards.service");

  function mockOverview() {
    query.mockImplementation((sql) => {
      if (/sales_order_payments/.test(sql))
        return Promise.resolve({
          rows: [{ cash_collected_mtd: "1738000.00", payments_mtd: 4 }],
        });
      if (/quotations/.test(sql))
        return Promise.resolve({ rows: [{ open_quotes: 0 }] });
      if (/FROM faitlynhair\.invoices/.test(sql))
        return Promise.resolve({ rows: [{ outstanding_ngn: "1738000.00" }] });
      if (
        /pending_payment/.test(sql) &&
        /count\(\*\)::int AS pending_orders/.test(sql)
      )
        return Promise.resolve({ rows: [{ pending_orders: 1 }] });
      if (/service_jobs/.test(sql))
        return Promise.resolve({
          rows: [{ jobs_pending: 0, jobs_in_progress: 0 }],
        });
      if (/deliveries/.test(sql))
        return Promise.resolve({
          rows: [{ deliveries_active: 0, deliveries_failed: 0 }],
        });
      if (/ai_briefings/.test(sql)) return Promise.resolve({ rows: [] });
      if (/sales_orders/.test(sql))
        return Promise.resolve({
          rows: [
            {
              orders_mtd: 9,
              order_value_mtd: "2500000.00",
              pending_payment_count: 3,
              avg_order_value: "277777.78",
            },
          ],
        });
      return Promise.resolve({ rows: [] });
    });
  }

  test("exposes cash collected as the monthly money figure, order value under its own name", async () => {
    mockOverview();
    const insights = require("../../../src/modules/ai_insights/insights.service");
    jest.spyOn(insights, "summary").mockResolvedValue({});
    const out = await service.overview({
      brand: BRAND,
      user: { user_id: "u1" },
    });
    expect(out.sales.cash_collected_ngn).toBe("1738000.00");
    expect(out.sales.order_value_ngn).toBe("2500000.00");
    expect(out.sales.revenue_ngn).toBeUndefined();
  });
});

describe("one definition of cash, everywhere", () => {
  // The Dashboard "Cash Collected" tile, its Payment Methods donut and the
  // payments drill-down used to sum EVERY payment row in the window by
  // `captured_at` alone — so a pending or failed charge counted as cash, a row
  // the gateway never stamped a capture on vanished, and the tile disagreed
  // with the Sales figure. All of them now use the locked predicate.
  const metricsRepo = require("../../../src/modules/dashboards/dashboards.metrics.repo");
  const detailsRepo = require("../../../src/modules/dashboards/dashboards.details.repo");
  const FROM = "2026-10-01T00:00:00.000Z";
  const TO = "2026-10-07T00:00:00.000Z";

  function capturedSql() {
    return query.mock.calls.map(([sql]) => sql).join("\n");
  }

  beforeEach(() => {
    query.mockImplementation(() =>
      Promise.resolve({
        rows: [
          {
            cash_collected: "0",
            label: "cash",
            payments: 0,
            value: 0,
            total: 0,
          },
        ],
      }),
    );
  });

  test.each([
    [
      "the Cash Collected tile",
      () => metricsRepo.cashCollected({ brand: BRAND, from: FROM, to: TO }),
    ],
    [
      "the Payment Methods breakdown",
      () =>
        metricsRepo.paymentMethodBreakdown({
          brand: BRAND,
          from: FROM,
          to: TO,
        }),
    ],
    [
      "the payments drill-down",
      () =>
        detailsRepo.DETAILS.sales.payments({
          brand: BRAND,
          from: FROM,
          to: TO,
          limit: 10,
          offset: 0,
        }),
    ],
  ])(
    "%s counts captured/authorised rows dated by when the money landed",
    async (_name, run) => {
      await run();
      const sql = capturedSql();
      expect(sql).toContain(`status IN ${SETTLED_PAYMENT_STATUSES_SQL}`);
      expect(sql).toMatch(/COALESCE\(p?\.?captured_at, p?\.?recorded_at\)/);
      expect(sql).not.toMatch(/WHERE captured_at BETWEEN/);
      expect(sql).not.toMatch(/WHERE p\.captured_at BETWEEN/);
    },
  );

  test("the sales report export scopes cash the same way", async () => {
    const salesRepo = require("../../../src/modules/sales/sales.repo");
    query.mockResolvedValue({
      rows: [{ cash_collected_ngn: "0", payments: 0 }],
    });
    await salesRepo.reportCashCollected({
      brand: BRAND,
      filters: { from: FROM, to: TO },
    });
    const sql = capturedSql();
    expect(sql).toContain(`p.status IN ${SETTLED_PAYMENT_STATUSES_SQL}`);
    expect(sql).toMatch(/COALESCE\(p\.captured_at, p\.recorded_at\)/);
  });
});
