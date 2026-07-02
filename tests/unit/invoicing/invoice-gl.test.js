"use strict";

// Invoice GL lifecycle (policy Q1 — accrual for credit sales):
//   issue  → DR AR / CR revenue (per-line account) + VAT + shipping
//   pay    → DR Bank (+ DR WHT Receivable for the withheld share) / CR AR
//   void   → reversal of the accrual
// Order-backed invoices must post NOTHING here — the order.paid sale journal
// owns their GL, and double-posting revenue is the exact bug this guards.

const postedEntries = [];
const reversedEntries = [];

jest.mock("../../../src/modules/invoicing/invoicing.repo", () => ({
  findById: jest.fn(),
  setStatus: jest.fn(async ({ status }) => ({ status })),
  applyPayment: jest.fn(async () => ({ application_id: "app-1" })),
  listReceipts: jest.fn(async () => [{ receipt_id: "r-1" }]),
  cancelScheduledReminders: jest.fn(),
}));
jest.mock("../../../src/modules/invoicing/invoicing.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/modules/accounting/accounting.service", () => ({
  postEntry: jest.fn(async (args) => {
    postedEntries.push(args);
    return { entry_id: `entry-${postedEntries.length}` };
  }),
  reverseEntry: jest.fn(async (args) => {
    reversedEntries.push(args);
    return { entry_id: "rev-1" };
  }),
  findEntryBySource: jest.fn(async () => null),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) => fn({ query: jest.fn() })),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../src/services/pdf.service", () => ({}));
jest.mock("../../../src/services/pdf.brand-docs", () => ({}));
jest.mock("../../../src/services/document-copy", () => ({}));
jest.mock("../../../src/modules/email_campaigns/email-render", () => ({}));
jest.mock("../../../src/modules/invoicing/invoice-delivery.service", () => ({
  dispatchInvoice: jest.fn(async () => ({})),
}));
jest.mock("../../../src/modules/invoicing/receipt-delivery.service", () => ({}));
jest.mock("../../../src/services/comms-log.service", () => ({}));

const repo = require("../../../src/modules/invoicing/invoicing.repo");
const accounting = require("../../../src/modules/accounting/accounting.service");
const service = require("../../../src/modules/invoicing/invoicing.service");
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

const STANDALONE = {
  invoice_id: "inv-1",
  invoice_number: "PXG-INV-0007",
  order_id: null,
  contact_id: "contact-9",
  status: "draft",
  subtotal_ngn: "400000.00",
  discount_amount_ngn: "20000.00",
  tax_amount_ngn: "28500.00", // 7.5% of 380,000
  shipping_fee_ngn: "10000.00",
  wht_amount_ngn: "0.00",
  total_ngn: "418500.00",
  amount_paid_ngn: "0.00",
  balance_due_ngn: "418500.00",
  lines: [
    {
      line_total_ngn: "215000.00",
      tax_amount_ngn: "15000.00",
      revenue_account_code: null, // → 4000
    },
    {
      line_total_ngn: "193500.00",
      tax_amount_ngn: "13500.00",
      revenue_account_code: "4100", // service revenue — installation
    },
  ],
};

const USER = { user_id: "u-1" };

beforeEach(() => {
  postedEntries.length = 0;
  reversedEntries.length = 0;
  jest.clearAllMocks();
});

describe("buildInvoiceAccrualLines", () => {
  test("balances and splits revenue by line account", () => {
    const lines = service.buildInvoiceAccrualLines(STANDALONE);
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    expect(dr).toBe("418500.00");
    expect(lines.find((l) => l.account_code === "1200").debit_ngn).toBe(
      "418500.00",
    );
    expect(lines.find((l) => l.account_code === "4000").credit_ngn).toBe(
      "200000.00",
    );
    expect(lines.find((l) => l.account_code === "4100").credit_ngn).toBe(
      "180000.00",
    );
    expect(lines.find((l) => l.account_code === "2100").credit_ngn).toBe(
      "28500.00",
    );
    expect(lines.find((l) => l.account_code === "4200").credit_ngn).toBe(
      "10000.00",
    );
  });

  test("line-less invoice falls back to header net", () => {
    const lines = service.buildInvoiceAccrualLines({
      ...STANDALONE,
      lines: [],
      tax_amount_ngn: "0.00",
      shipping_fee_ngn: "0.00",
      total_ngn: "380000.00",
    });
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    expect(lines.find((l) => l.account_code === "4000").credit_ngn).toBe(
      "380000.00",
    );
  });
});

describe("send — issue accrual", () => {
  test("standalone draft accrues once with an idempotency key", async () => {
    repo.findById.mockResolvedValue({ ...STANDALONE });
    await service.send({ brand: "pixiegirl", user: USER, id: "inv-1" });
    expect(postedEntries).toHaveLength(1);
    expect(postedEntries[0].entry.source_type).toBe("invoice");
    expect(postedEntries[0].entry.idempotency_key).toBe(
      "invoice_issue:inv-1",
    );
    const { dr, cr } = totals(postedEntries[0].lines);
    expect(dr).toBe(cr);
  });

  test("order-backed invoice posts NOTHING (owned by order.paid journal)", async () => {
    repo.findById.mockResolvedValue({ ...STANDALONE, order_id: "ord-1" });
    await service.send({ brand: "pixiegirl", user: USER, id: "inv-1" });
    expect(postedEntries).toHaveLength(0);
  });
});

describe("recordPayment — settlement journal", () => {
  test("standalone: accrues (idempotent) then posts DR Bank / CR AR", async () => {
    repo.findById.mockResolvedValue({ ...STANDALONE, status: "sent" });
    await service.recordPayment({
      brand: "pixiegirl",
      user: USER,
      id: "inv-1",
      input: { amount_applied_ngn: "418500.00" },
    });
    // 1: accrual (idempotency key dedupes if already posted), 2: payment.
    expect(postedEntries).toHaveLength(2);
    const pay = postedEntries[1];
    expect(pay.entry.idempotency_key).toBe("invoice_payment:app-1");
    const { dr, cr } = totals(pay.lines);
    expect(dr).toBe(cr);
    expect(pay.lines.find((l) => l.account_code === "1100").debit_ngn).toBe(
      "418500.00",
    );
    expect(pay.lines.find((l) => l.account_code === "1200").credit_ngn).toBe(
      "418500.00",
    );
  });

  test("customer WHT splits the debit between cash and WHT receivable", async () => {
    repo.findById.mockResolvedValue({
      ...STANDALONE,
      status: "sent",
      wht_amount_ngn: "20925.00", // 5% of total
    });
    await service.recordPayment({
      brand: "pixiegirl",
      user: USER,
      id: "inv-1",
      input: { amount_applied_ngn: "209250.00" }, // half the invoice
    });
    const pay = postedEntries[1];
    const { dr, cr } = totals(pay.lines);
    expect(dr).toBe(cr);
    // Half the WHT rides on half the payment.
    expect(pay.lines.find((l) => l.account_code === "1420").debit_ngn).toBe(
      "10462.50",
    );
    expect(pay.lines.find((l) => l.account_code === "1100").debit_ngn).toBe(
      "198787.50",
    );
    expect(pay.lines.find((l) => l.account_code === "1200").credit_ngn).toBe(
      "209250.00",
    );
  });

  test("order-backed payment posts nothing", async () => {
    repo.findById.mockResolvedValue({
      ...STANDALONE,
      order_id: "ord-1",
      status: "sent",
    });
    await service.recordPayment({
      brand: "pixiegirl",
      user: USER,
      id: "inv-1",
      input: { amount_applied_ngn: "100000.00" },
    });
    expect(postedEntries).toHaveLength(0);
  });
});

describe("voidInvoice — accrual reversal", () => {
  test("sent standalone invoice reverses its posted accrual", async () => {
    repo.findById.mockResolvedValue({ ...STANDALONE, status: "sent" });
    accounting.findEntryBySource.mockResolvedValue({
      entry_id: "entry-77",
      status: "posted",
    });
    await service.voidInvoice({ brand: "pixiegirl", user: USER, id: "inv-1" });
    expect(reversedEntries).toHaveLength(1);
    expect(reversedEntries[0].id).toBe("entry-77");
  });

  test("draft with no journal voids without touching the GL", async () => {
    repo.findById.mockResolvedValue({ ...STANDALONE });
    accounting.findEntryBySource.mockResolvedValue(null);
    await service.voidInvoice({ brand: "pixiegirl", user: USER, id: "inv-1" });
    expect(reversedEntries).toHaveLength(0);
  });
});
