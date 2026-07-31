"use strict";

/**
 * Unmatchable gateway payments must PARK, never throw.
 *
 * Three Kaizen bugs, one root cause: a captured payment that couldn't be
 * attached to an order threw, so the webhook stayed unprocessed, the replay
 * sweep re-drove it up to 25 times, and each pass logged a fresh error — while
 * the payment itself never appeared anywhere staff could see it.
 *
 *   1. "relation pixiegirl.pos_terminals does not exist" (335 occurrences) —
 *      the handler looked the terminal up in a per-brand registry that the POS
 *      teardown (template 000074) dropped.
 *   2. "TEST-FAITLYNHAIR-…: missing/invalid metadata.brand/order_id" — a paid
 *      Settings → Test connection checkout, retried forever.
 *   3. "cannot resolve order for USD settlement" — a foreign-currency capture
 *      with no order behind it.
 *
 * All three now land in shared.pos_terminal_reconciliation (Sales → POS
 * Reconciliation) and mark the webhook processed.
 */

const mockParked = [];
let mockLog = null;

jest.mock("../../../src/config/env", () => ({ config: {} }));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) => fn({ query: jest.fn() })),
  query: jest.fn(async () => ({ rows: [] })),
}));
jest.mock("../../../src/config/request-context", () => ({}));
jest.mock("../../../src/shared/outbox/outbox", () => ({
  enqueue: jest.fn(),
  register: jest.fn(),
}));
jest.mock("../../../src/services/paystack.service", () => ({}));
jest.mock("../../../src/services/opay.service", () => ({}));
jest.mock("../../../src/services/stripe.service", () => ({}));
jest.mock("../../../src/services/nomba.service", () => ({
  // No re-verification hit: the handler falls back to the payload as delivered.
  verifyTransaction: jest.fn(async () => null),
}));
jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findByOrderNumber: jest.fn(async () => null),
  findQuotationByNumber: jest.fn(async () => null),
  findById: jest.fn(async () => null),
  paymentExistsByProviderRef: jest.fn(async () => false),
}));
jest.mock("../../../src/modules/business_setup/webhooks.repo", () => ({
  insertLog: jest.fn(),
  findById: jest.fn(async () => mockLog),
  markProcessed: jest.fn(),
  listReplayable: jest.fn(),
}));
jest.mock(
  "../../../src/modules/business_setup/payment-gateways.service",
  () => ({
    resolveCredentials: jest.fn(async () => ({ client_id: "c" })),
  }),
);

// The queue. Any per-brand pos_* query would be a bug — this mock has none.
jest.mock("../../../src/modules/pos/pos.repo", () => ({
  enqueueReconciliation: jest.fn(async ({ row }) => {
    mockParked.push(row);
    return { recon_id: `recon-${mockParked.length}`, ...row };
  }),
}));
jest.mock("../../../src/modules/pos/pos.events", () => ({ emit: jest.fn() }));

const repo = require("../../../src/modules/business_setup/webhooks.repo");
const posRepo = require("../../../src/modules/pos/pos.repo");
const service = require("../../../src/modules/business_setup/webhooks.service");

function nombaLog(payload) {
  return {
    webhook_id: "wh-1",
    source: "nomba",
    processed: false,
    payload,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParked.length = 0;
});

test("an in-store terminal payment with no order parks instead of throwing", async () => {
  mockLog = nombaLog({
    event_type: "payment_success",
    data: {
      transaction: {
        type: "nqr_transaction",
        transactionId: "TX-1",
        transactionAmount: 15000,
        currency: "NGN",
        time: "2026-07-30T18:10:00Z",
        aliasAccountName: "Faitlyn Salon de luxe",
      },
      terminal: { terminalId: "TERM-7" },
      customer: { senderName: "Omolara Adeyemi", bankName: "GTBank" },
    },
  });

  await expect(
    service.onWebhookReceived({ webhook_id: "wh-1" }),
  ).resolves.toBeUndefined();

  expect(mockParked).toHaveLength(1);
  expect(mockParked[0]).toMatchObject({
    provider: "nomba",
    nomba_terminal_id: "TERM-7",
    // The sender columns 000374 added — these used to be dropped on the floor,
    // which is why every row rendered its SENDER cell as "—".
    sender_name: "Omolara Adeyemi",
    sender_bank: "GTBank",
  });
  expect(mockParked[0].note).toMatch(/no order reference/i);
  // Webhook marked processed → the replay sweep leaves it alone.
  expect(repo.markProcessed).toHaveBeenCalledWith("wh-1", {
    error_message: null,
  });
});

test("a paid gateway self-test checkout parks, labelled as ours to ignore", async () => {
  mockLog = nombaLog({
    event_type: "payment_success",
    data: {
      order: {
        orderReference: "TEST-FAITLYNHAIR-1753900000000",
        amount: 100,
        currency: "NGN",
        metadata: {},
      },
      transaction: {
        type: "online_checkout",
        transactionId: "TX-2",
        currency: "NGN",
      },
      customer: {},
    },
  });

  await expect(
    service.onWebhookReceived({ webhook_id: "wh-1" }),
  ).resolves.toBeUndefined();

  expect(mockParked).toHaveLength(1);
  expect(mockParked[0].note).toMatch(/self-test/i);
  // The brand is recoverable from the TEST-<BRAND>- reference, so this lands in
  // Faitlyn's own queue rather than the CEO cross-brand one.
  expect(mockParked[0].resolved_brand).toBe("faitlynhair");
  expect(repo.markProcessed).toHaveBeenCalledWith("wh-1", {
    error_message: null,
  });
});

test("a USD capture with no matching order parks with the foreign amount stated", async () => {
  mockLog = nombaLog({
    event_type: "payment_success",
    data: {
      order: {
        orderReference: "nomba-FLH-SO-9999-abc",
        amount: 426.89,
        currency: "USD",
        metadata: {},
      },
      transaction: {
        type: "online_checkout",
        transactionId: "TX-3",
        currency: "USD",
      },
      customer: { senderName: "A Buyer" },
    },
  });

  await expect(
    service.onWebhookReceived({ webhook_id: "wh-1" }),
  ).resolves.toBeUndefined();

  expect(mockParked).toHaveLength(1);
  // No order → no NGN figure exists; the note carries the truth instead.
  expect(mockParked[0].note).toMatch(/USD 426.89/);
  expect(repo.markProcessed).toHaveBeenCalledWith("wh-1", {
    error_message: null,
  });
});

test("nothing in the confirm path queries a retired per-brand pos_* table", async () => {
  // pos.repo no longer exposes a terminal-registry lookup at all — the guard
  // that keeps 42P01 out of this path permanently.
  const realPosRepo = jest.requireActual("../../../src/modules/pos/pos.repo");
  expect(realPosRepo.findTerminalByNombaId).toBeUndefined();
  expect(posRepo.enqueueReconciliation).toBeDefined();
});
