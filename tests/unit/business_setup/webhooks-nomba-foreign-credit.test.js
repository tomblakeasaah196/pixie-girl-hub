"use strict";

/**
 * A USD Nomba capture is credited at what the buyer ACTUALLY paid.
 *
 * The confirm handler used to credit the order's whole outstanding Naira
 * balance for any USD capture, whatever the dollar amount. Paired with the
 * public "pay any amount" link (which let the caller pick the currency), that
 * meant: flip a ₦500,000 order to USD, pay a $1 checkout, and the order was
 * marked paid in full and its stock released. The same bug hit honest buyers —
 * a USD Flexi Pay deposit or a part top-up also settled the entire order.
 *
 * Now: credit = paid × the order's locked rate. Rounding either side of the
 * balance settles it (the whole-dollar ceil makes a full payment worth up to
 * $1 more); a real overpayment is credited in FULL and flagged by addPayment
 * (the excess is the customer's money, held in 2400); a capture on a
 * cancelled order parks for a refund; a replay of a recorded capture is a
 * no-op. Payload `metadata` (unsigned, and never sent by us) is ignored.
 */

let mockLog = null;
let mockOrder = null;
let mockAlreadyRecorded = false;
const mockParked = [];
const mockPayments = [];

jest.mock("../../../src/config/env", () => ({ config: {} }));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) => fn({ query: jest.fn() })),
  // gatewayFeeNgn reads business_config → no fee schedule → fee "0".
  query: jest.fn(async () => ({ rows: [] })),
}));
jest.mock("../../../src/config/request-context", () => ({
  run: (_ctx, fn) => fn(),
}));
jest.mock("../../../src/shared/outbox/outbox", () => ({
  enqueue: jest.fn(),
  register: jest.fn(),
}));
jest.mock("../../../src/services/paystack.service", () => ({}));
jest.mock("../../../src/services/opay.service", () => ({}));
jest.mock("../../../src/services/stripe.service", () => ({}));
jest.mock("../../../src/services/nomba.service", () => ({
  verifyTransaction: jest.fn(async () => null),
}));
jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findByOrderNumber: jest.fn(async ({ order_number }) =>
    mockOrder && mockOrder.order_number === order_number ? mockOrder : null,
  ),
  findQuotationByNumber: jest.fn(async () => null),
  findById: jest.fn(async ({ id }) => {
    // A forged metadata.order_id would point here — it must never be read.
    if (id === "ord-victim") throw new Error("metadata.order_id was trusted");
    return mockOrder && mockOrder.order_id === id ? mockOrder : null;
  }),
  paymentExistsByProviderRef: jest.fn(async () => mockAlreadyRecorded),
}));
// The rate resolver the pay link used: the order's locked rate.
jest.mock("../../../src/modules/sales/payment-link.service", () => ({
  settlementFxRate: jest.fn(async ({ order }) => {
    const r = Number(order.fx_rate_used);
    return r > 0 && r !== 1 ? r : null;
  }),
}));
jest.mock("../../../src/modules/sales/sales.service", () => ({
  addPayment: jest.fn(async ({ input }) => {
    mockPayments.push(input);
  }),
}));
jest.mock("../../../src/modules/business_setup/webhooks.repo", () => ({
  insertLog: jest.fn(),
  findById: jest.fn(async () => mockLog),
  markProcessed: jest.fn(),
  listReplayable: jest.fn(),
}));
jest.mock(
  "../../../src/modules/business_setup/payment-gateways.service",
  () => ({ resolveCredentials: jest.fn(async () => ({ client_id: "c" })) }),
);
jest.mock("../../../src/modules/pos/pos.repo", () => ({
  enqueueReconciliation: jest.fn(async ({ row }) => {
    mockParked.push(row);
    return { recon_id: `recon-${mockParked.length}`, ...row };
  }),
}));
jest.mock("../../../src/modules/pos/pos.events", () => ({ emit: jest.fn() }));

const service = require("../../../src/modules/business_setup/webhooks.service");

// ₦500,000 order locked to USD at ₦1,500/$ (the rate its checkout charged at).
const USD_ORDER = {
  order_id: "ord-1",
  order_number: "FLH-SO-0200",
  total_ngn: "500000.00",
  amount_paid_ngn: "0.00",
  display_currency: "USD",
  fx_rate_used: "1500.000000",
};

function onlineCapture({ amount, currency, metadata = {} }) {
  return {
    webhook_id: "wh-1",
    source: "nomba",
    processed: false,
    payload: {
      event_type: "payment_success",
      data: {
        order: {
          orderReference: "nomba-FLH-SO-0200-abc123",
          amount,
          currency,
          metadata,
        },
        transaction: {
          type: "online_checkout",
          transactionId: "TX-9",
          currency,
        },
      },
    },
  };
}

const confirm = () => service.onWebhookReceived({ webhook_id: "wh-1" });

beforeEach(() => {
  jest.clearAllMocks();
  mockParked.length = 0;
  mockPayments.length = 0;
  mockAlreadyRecorded = false;
  mockOrder = { ...USD_ORDER };
});

test("a $1 capture credits ₦1,500 — not the ₦500,000 balance", async () => {
  mockLog = onlineCapture({ amount: 1, currency: "USD" });
  await confirm();

  expect(mockParked).toHaveLength(0);
  expect(mockPayments).toHaveLength(1);
  expect(mockPayments[0]).toMatchObject({
    amount_ngn: "1500.00",
    paid_currency: "USD",
    paid_amount: "1.00",
    // Converted at the order's own locked rate → addPayment posts no FX.
    fx_rate_used: "1500.000000",
  });
});

test("a USD Flexi Pay deposit credits only the deposit", async () => {
  mockLog = onlineCapture({ amount: 100, currency: "USD" });
  await confirm();
  expect(mockPayments[0].amount_ngn).toBe("150000.00");
});

test("a full whole-dollar payment settles exactly the balance (ceil surplus absorbed)", async () => {
  // ₦500,000 ÷ 1,500 = 333.33 → the checkout charged $334 (= ₦501,000).
  mockLog = onlineCapture({ amount: 334, currency: "USD" });
  await confirm();
  expect(mockPayments[0].amount_ngn).toBe("500000.00");
  expect(mockPayments[0].paid_amount).toBe("334.00");
});

test("a second USD capture on a settled order is recorded in full as an overpayment", async () => {
  // A real second payment (not a replay): the dollars are in the wallet, so
  // the order carries them — addPayment flags order.overpaid for a refund or
  // credit decision instead of the money vanishing into the queue.
  mockOrder = { ...USD_ORDER, amount_paid_ngn: "500000.00" };
  mockLog = onlineCapture({ amount: 334, currency: "USD" });
  await confirm();

  expect(mockParked).toHaveLength(0);
  expect(mockPayments).toHaveLength(1);
  expect(mockPayments[0]).toMatchObject({
    amount_ngn: "501000.00",
    paid_currency: "USD",
    paid_amount: "334.00",
  });
});

test("paying $10 over the balance credits the full value (the excess is held for the customer)", async () => {
  // Balance ₦500,000 = $333.33; $343.33 is $10 over.
  mockLog = onlineCapture({ amount: 343.33, currency: "USD" });
  await confirm();
  expect(mockPayments[0].amount_ngn).toBe("514995.00");
});

test("rounding short of the balance settles it; more than a cent short does not", async () => {
  // One cent at ₦1,500/$ is ₦15.
  // $333.33 × 1,500 = ₦499,995 — ₦5 short (rounding) → settles the balance.
  mockLog = onlineCapture({ amount: 333.33, currency: "USD" });
  await confirm();
  expect(mockPayments[0].amount_ngn).toBe("500000.00");

  mockPayments.length = 0;
  // $333.32 × 1,500 = ₦499,980 — ₦20 short → credited as paid.
  mockLog = onlineCapture({ amount: 333.32, currency: "USD" });
  await confirm();
  expect(mockPayments[0].amount_ngn).toBe("499980.00");
});

test("a USD capture on a cancelled order parks for a refund", async () => {
  mockOrder = { ...USD_ORDER, status: "cancelled" };
  mockLog = onlineCapture({ amount: 334, currency: "USD" });
  await confirm();

  expect(mockPayments).toHaveLength(0);
  expect(mockParked).toHaveLength(1);
  expect(mockParked[0].note).toMatch(/cancelled — refund it/);
  expect(mockParked[0].amount_ngn).toBe("501000.00");
});

test("a replay of an already-recorded capture is a silent no-op (not parked)", async () => {
  mockOrder = { ...USD_ORDER, amount_paid_ngn: "500000.00" };
  mockAlreadyRecorded = true;
  mockLog = onlineCapture({ amount: 334, currency: "USD" });
  await confirm();

  expect(mockPayments).toHaveLength(0);
  expect(mockParked).toHaveLength(0);
});

test("a USD capture on an order with no rate to convert at parks for staff", async () => {
  mockOrder = { ...USD_ORDER, fx_rate_used: "1.000000" };
  mockLog = onlineCapture({ amount: 334, currency: "USD" });
  await confirm();

  expect(mockPayments).toHaveLength(0);
  expect(mockParked[0].note).toMatch(/no ₦\/USD rate/);
});

test("payload metadata can't pick the order or the Naira amount", async () => {
  // Unsigned fields: a forged order_id / amount_ngn used to be honoured.
  mockOrder = {
    ...USD_ORDER,
    display_currency: "NGN",
    fx_rate_used: "1.000000",
  };
  mockLog = onlineCapture({
    amount: 20000,
    currency: "NGN",
    metadata: { order_id: "ord-victim", amount_ngn: "500000", brand: "pixiegirl" },
  });
  await confirm();

  expect(mockParked).toHaveLength(0);
  expect(mockPayments).toHaveLength(1);
  // Nomba's own NGN figure, against the order the reference names.
  expect(mockPayments[0].amount_ngn).toBe("20000.00");
});

test("a capture within one cent of the balance settles it (cent-rounded USD totals)", async () => {
  // ₦992,400 at ₦1,300/$ → $763.38 (to the cent) is worth ₦992,394 — ₦6 short
  // of the balance, under one cent. It must settle, not leave ₦6 owing.
  mockOrder = {
    ...USD_ORDER,
    order_number: "FLH-SO-0200",
    total_ngn: "992400.00",
    fx_rate_used: "1300.000000",
  };
  mockLog = onlineCapture({ amount: 763.38, currency: "USD" });
  await confirm();
  expect(mockPayments[0].amount_ngn).toBe("992400.00");
});

test("a capture more than a cent short credits only what was paid", async () => {
  mockOrder = {
    ...USD_ORDER,
    total_ngn: "992400.00",
    fx_rate_used: "1300.000000",
  };
  mockLog = onlineCapture({ amount: 763.0, currency: "USD" });
  await confirm();
  expect(mockPayments[0].amount_ngn).toBe("991900.00");
});
