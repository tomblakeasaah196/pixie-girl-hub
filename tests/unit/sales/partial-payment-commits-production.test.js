"use strict";

/**
 * Owner directive (2026-09-29): "once an order is even partially paid not
 * only fully paid we can be able to have it in the stylist studio and be
 * able to assign it... include partially paid please... meaning the stock
 * considers it as a sale at once."
 *
 * Before, only a `deposit_triggered` custom order opened its Studio job (and
 * only markPaid, on FULL settlement, ever drew stock as a real sale). These
 * tests pin the new rule: the FIRST payment of any size, on ANY order, opens
 * the styling job (order.deposit_met) and draws its stock as a sale — with a
 * shortfall flagged as a formal pre-order instead of blocking the payment —
 * and that a later top-up or the eventual full settlement never repeats
 * either effect.
 */

let mockOrder;
let mockPaidSoFar;

jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findById: jest.fn(async () => ({ ...mockOrder, amount_paid_ngn: mockPaidSoFar })),
  nextNumber: jest.fn(async () => "FLH-PAY-0001"),
  addPayment: jest.fn(async ({ payment }) => {
    mockPaidSoFar = (Number(mockPaidSoFar) + Number(payment.amount_ngn)).toFixed(2);
    return { ...payment, payment_id: "pay-1", _alreadyExisted: false };
  }),
  setStatus: jest.fn(async ({ status }) => ({
    ...mockOrder,
    status,
    amount_paid_ngn: mockPaidSoFar,
  })),
  advanceStatus: jest.fn(async ({ to }) => ({
    ...mockOrder,
    status: to,
    amount_paid_ngn: mockPaidSoFar,
  })),
  mergeInternalNotes: jest.fn(),
  getPreorderPolicy: jest.fn(async () => ({ enabled: true, min_weeks: 4, max_weeks: 8 })),
  markOrderPreorder: jest.fn(),
  markLinesPreorder: jest.fn(),
  sumCampaignDiscount: jest.fn(async () => "0"),
}));
jest.mock("../../../src/modules/invoicing/invoicing.repo", () => ({
  findByOrderId: jest.fn(async () => null),
  applyPayment: jest.fn(),
}));
jest.mock("../../../src/modules/accounting/accounting.service", () => ({
  postEntry: jest.fn(),
  postFxGainLoss: jest.fn(),
}));
jest.mock("../../../src/shared/outbox/outbox", () => ({
  enqueue: jest.fn(),
  register: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) => fn({ query: jest.fn(async () => ({ rows: [] })) })),
  query: jest.fn(async () => ({ rows: [] })),
}));
jest.mock("../../../src/modules/stock/stock.repo", () => ({
  getDefaultLocation: jest.fn(async () => ({ location_id: "loc-1" })),
  netSoldForOrder: jest.fn(async () => 0),
}));
jest.mock("../../../src/modules/stock/stock.service", () => ({
  releaseOrderReservation: jest.fn(async () => null),
  deductForSale: jest.fn(async () => ({})),
}));

const repo = require("../../../src/modules/sales/sales.repo");
const outbox = require("../../../src/shared/outbox/outbox");
const stockRepo = require("../../../src/modules/stock/stock.repo");
const stockService = require("../../../src/modules/stock/stock.service");
const service = require("../../../src/modules/sales/sales.service");

const BASE_ORDER = {
  order_id: "ord-1",
  order_number: "FLH-SO-0300",
  contact_id: "contact-1",
  status: "pending_payment",
  total_ngn: "100000.00",
  payment_plan: "instalment",
  payment_model: "layaway",
  required_deposit_ngn: "30000.00",
  sales_channel: "storefront",
  fx_rate_used: null,
  lines: [
    {
      line_id: "line-1",
      variant_id: "variant-1",
      quantity: 1,
      unit_cost_ngn: "20000",
      product_name_snapshot: "Lorato Bloom 22\"",
    },
  ],
};

const pay = (amount_ngn) =>
  service.addPayment({
    brand: "faitlynhair",
    user: { user_id: "user-1" },
    request_id: "req-1",
    id: BASE_ORDER.order_id,
    input: {
      method: "bank_transfer",
      provider: "manual",
      provider_reference: `GTB/${Math.random()}`,
      amount_ngn,
      payment_path: "gateway",
    },
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockPaidSoFar = "0.00";
  mockOrder = { ...BASE_ORDER };
  stockRepo.getDefaultLocation.mockResolvedValue({ location_id: "loc-1" });
  stockRepo.netSoldForOrder.mockResolvedValue(0);
  stockService.releaseOrderReservation.mockResolvedValue(null);
  stockService.deductForSale.mockResolvedValue({});
});

describe("first partial payment — Studio opens + stock draws at once", () => {
  it("emits order.deposit_met on the very first payment, whatever the payment_model", async () => {
    await pay("20000.00"); // 20% of 100,000 — well under required_deposit_ngn

    const enqueued = outbox.enqueue.mock.calls.map(([, evt]) => evt.event_type);
    expect(enqueued).toContain("order.deposit_met");

    const depositEvt = outbox.enqueue.mock.calls.find(
      ([, evt]) => evt.event_type === "order.deposit_met",
    )[1];
    expect(depositEvt.dedup_key).toBe("order.deposit_met:ord-1");
    expect(depositEvt.payload.order_id).toBe("ord-1");
  });

  it("draws the line's stock as a real sale, not just a reservation hold", async () => {
    await pay("20000.00");

    expect(stockService.releaseOrderReservation).toHaveBeenCalledWith(
      expect.objectContaining({ variant_id: "variant-1", quantity: 1 }),
    );
    expect(stockService.deductForSale).toHaveBeenCalledWith(
      expect.objectContaining({
        variant_id: "variant-1",
        quantity: 1,
        reference_id: "ord-1",
      }),
    );
  });

  it("a top-up on an already partially-paid order does not re-open the job or re-draw stock", async () => {
    await pay("20000.00");
    jest.clearAllMocks();
    stockRepo.getDefaultLocation.mockResolvedValue({ location_id: "loc-1" });
    // Simulate the ledger already reflecting the first draw.
    stockRepo.netSoldForOrder.mockResolvedValue(1);
    mockOrder = { ...BASE_ORDER, status: "partially_paid" };

    await pay("10000.00");

    const enqueued = outbox.enqueue.mock.calls.map(([, evt]) => evt.event_type);
    expect(enqueued).not.toContain("order.deposit_met");
    expect(stockService.deductForSale).not.toHaveBeenCalled();
  });

  it("a stock shortfall on the first payment never blocks it — the line becomes a formal pre-order", async () => {
    stockService.deductForSale.mockRejectedValue(new Error("INSUFFICIENT_STOCK"));

    await expect(pay("20000.00")).resolves.toBeDefined();

    expect(repo.markOrderPreorder).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: "ord-1" }),
    );
    expect(repo.markLinesPreorder).toHaveBeenCalledWith(
      expect.objectContaining({ line_ids: ["line-1"] }),
    );
    expect(repo.mergeInternalNotes).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          stock_shortfall: expect.objectContaining({
            lines: [
              expect.objectContaining({ variant_id: "variant-1", quantity: 1 }),
            ],
          }),
        }),
      }),
    );
  });

  it("no active stock location flags the line as a pre-order instead of throwing", async () => {
    stockRepo.getDefaultLocation.mockResolvedValue(null);

    await expect(pay("20000.00")).resolves.toBeDefined();

    expect(repo.markLinesPreorder).toHaveBeenCalledWith(
      expect.objectContaining({ line_ids: ["line-1"] }),
    );
    expect(stockService.deductForSale).not.toHaveBeenCalled();
  });
});

describe("full settlement after a partial draw — never double-deducts", () => {
  it("markPaid finds the line already drawn and deducts nothing a second time", async () => {
    // The ledger already shows this order drew its 1 unit at the partial-
    // payment stage; the balance now clears.
    stockRepo.netSoldForOrder.mockResolvedValue(1);
    mockOrder = { ...BASE_ORDER, status: "partially_paid" };
    mockPaidSoFar = "20000.00";

    await pay("80000.00"); // crosses the 100,000 total

    expect(stockService.deductForSale).not.toHaveBeenCalled();
    const enqueued = outbox.enqueue.mock.calls.map(([, evt]) => evt.event_type);
    expect(enqueued).toContain("order.paid");
  });
});
