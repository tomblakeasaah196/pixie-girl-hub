"use strict";

// The sale journal is the highest-volume posting in the system. These tests
// pin the trial-balance invariant — debits === credits — across order shapes,
// and prove the weighted-average COGS fallback (policy Q9) engages when an
// order line was captured without a unit cost.

const postedEntries = [];

jest.mock("../../../src/shared/outbox/outbox", () => ({
  register: jest.fn(),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));
jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findById: jest.fn(),
}));
jest.mock("../../../src/modules/stock/stock.repo", () => ({
  getCostBasisForVariants: jest.fn(),
}));
jest.mock("../../../src/modules/accounting/accounting.repo", () => ({
  findEntryBySource: jest.fn(async () => null),
}));
jest.mock("../../../src/modules/accounting/accounting.service", () => ({
  postEntry: jest.fn(async (args) => {
    postedEntries.push(args);
    return { entry_id: "entry-1" };
  }),
}));

const salesRepo = require("../../../src/modules/sales/sales.repo");
const stockRepo = require("../../../src/modules/stock/stock.repo");
const {
  buildSaleJournalLines,
  postSaleJournal,
} = require("../../../src/modules/accounting/accounting.subscribers");
const { money } = require("../../../src/utils/money");

function totals(lines) {
  let dr = money(0);
  let cr = money(0);
  for (const l of lines) {
    dr = dr.plus(money(l.debit_ngn || 0));
    cr = cr.plus(money(l.credit_ngn || 0));
  }
  return { dr: dr.toFixed(2), cr: cr.toFixed(2) };
}

const BASE_ORDER = {
  order_id: "ord-1",
  order_number: "PXG-SO-0001",
  contact_id: "contact-1",
  sales_channel: "storefront",
  subtotal_ngn: "100000.00",
  discount_amount_ngn: "5000.00",
  shipping_fee_ngn: "2500.00",
  tax_amount_ngn: "7125.00", // 7.5% of net 95,000
  total_ngn: "104625.00",
  lines: [
    { variant_id: "v1", quantity: 2, unit_cost_ngn: "20000.00" },
    { variant_id: "v2", quantity: 1, unit_cost_ngn: "15000.00" },
  ],
};

describe("buildSaleJournalLines — trial-balance invariant", () => {
  test("full order (discount + shipping + VAT + COGS) balances", () => {
    const lines = buildSaleJournalLines(BASE_ORDER, new Map());
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    // Deposits drawdown (Q7), revenue net of discount, VAT, shipping, COGS.
    expect(dr).toBe("159625.00");
    expect(lines.find((l) => l.account_code === "2400").debit_ngn).toBe(
      "104625.00",
    );
    expect(lines.find((l) => l.account_code === "4000").credit_ngn).toBe(
      "95000.00",
    );
    expect(lines.find((l) => l.account_code === "2100").credit_ngn).toBe(
      "7125.00",
    );
    expect(lines.find((l) => l.account_code === "5000").debit_ngn).toBe(
      "55000.00",
    );
    expect(lines.find((l) => l.account_code === "1300").credit_ngn).toBe(
      "55000.00",
    );
  });

  test("order with no VAT, no shipping, no costs → cash vs revenue only", () => {
    const lines = buildSaleJournalLines(
      {
        ...BASE_ORDER,
        discount_amount_ngn: "0.00",
        shipping_fee_ngn: "0.00",
        tax_amount_ngn: "0.00",
        total_ngn: "100000.00",
        lines: [{ variant_id: "v1", quantity: 1, unit_cost_ngn: null }],
      },
      new Map(),
    );
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    expect(lines).toHaveLength(2);
  });

  test("channel maps to its revenue account (wholesale → 4040)", () => {
    const lines = buildSaleJournalLines(
      { ...BASE_ORDER, sales_channel: "wholesale" },
      new Map(),
    );
    expect(lines.find((l) => l.credit_ngn === "95000.00").account_code).toBe(
      "4040",
    );
  });

  test("unknown channel falls back to storefront revenue (4000)", () => {
    const lines = buildSaleJournalLines(
      { ...BASE_ORDER, sales_channel: "carrier_pigeon" },
      new Map(),
    );
    expect(lines.find((l) => l.credit_ngn === "95000.00").account_code).toBe(
      "4000",
    );
  });

  test("weighted-average basis fills lines with no captured cost", () => {
    const order = {
      ...BASE_ORDER,
      lines: [
        { variant_id: "v1", quantity: 2, unit_cost_ngn: null },
        { variant_id: "v2", quantity: 1, unit_cost_ngn: "15000.00" },
      ],
    };
    const lines = buildSaleJournalLines(
      order,
      new Map([["v1", "18000.0000"]]),
    );
    // COGS = 2×18,000 (avg) + 1×15,000 (captured) = 51,000.
    expect(lines.find((l) => l.account_code === "5000").debit_ngn).toBe(
      "51000.00",
    );
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
  });

  test("lines with no basis at all skip COGS rather than posting zero-cost noise", () => {
    const lines = buildSaleJournalLines(
      {
        ...BASE_ORDER,
        lines: [{ variant_id: "v1", quantity: 2, unit_cost_ngn: null }],
      },
      new Map(),
    );
    expect(lines.find((l) => l.account_code === "5000")).toBeUndefined();
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
  });
});

describe("postSaleJournal — COGS fallback wiring", () => {
  beforeEach(() => {
    postedEntries.length = 0;
    jest.clearAllMocks();
  });

  test("looks up the weighted average only for lines missing a cost", async () => {
    salesRepo.findById.mockResolvedValue({
      ...BASE_ORDER,
      lines: [
        { variant_id: "v1", quantity: 2, unit_cost_ngn: null },
        { variant_id: "v2", quantity: 1, unit_cost_ngn: "15000.00" },
      ],
    });
    stockRepo.getCostBasisForVariants.mockResolvedValue(
      new Map([["v1", "18000.0000"]]),
    );

    await postSaleJournal({ brand: "pixiegirl", order_id: "ord-1" });

    expect(stockRepo.getCostBasisForVariants).toHaveBeenCalledWith({
      brand: "pixiegirl",
      variant_ids: ["v1"],
    });
    expect(postedEntries).toHaveLength(1);
    const { dr, cr } = totals(postedEntries[0].lines);
    expect(dr).toBe(cr);
    expect(
      postedEntries[0].lines.find((l) => l.account_code === "5000").debit_ngn,
    ).toBe("51000.00");
  });
});
