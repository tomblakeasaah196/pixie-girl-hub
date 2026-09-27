"use strict";

// POS terminal-payment reconciliation — matching an unattributed payment to an
// order. The match runs the payment through the same path a gateway webhook
// uses, but a PERSON decided which order it belongs to, so their user id has to
// reach the payment row: without it the order's Payments ledger claimed the
// gateway captured it automatically and nobody could tell who made the call.

jest.mock("../../../src/modules/pos/pos.repo", () => ({
  findById: jest.fn(),
  markMatched: jest.fn(async () => ({
    recon_id: "recon-1",
    status: "matched",
  })),
}));
jest.mock("../../../src/modules/pos/pos.events", () => ({ emit: jest.fn() }));
jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findReconcilablePosOrders: jest.fn(async () => []),
  findById: jest.fn(async ({ id }) => ({
    order_id: id,
    order_number: "FLH-SO-0200",
    status: "pending_payment",
    total_ngn: "374985.00",
    amount_paid_ngn: "0.00",
    display_currency: "USD",
    fx_rate_used: "1500.000000",
  })),
}));
jest.mock("../../../src/modules/business_setup/webhooks.service", () => ({
  recordGatewayPayment: jest.fn(async () => {}),
  foreignCaptureCredit: jest.fn(async ({ paidAmount }) => ({
    amount_ngn: (Number(paidAmount) * 1500).toFixed(2),
    fx_rate: 1500,
  })),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/services/notifications.service", () => ({
  create: jest.fn(),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const repo = require("../../../src/modules/pos/pos.repo");
const webhooksService = require("../../../src/modules/business_setup/webhooks.service");
const service = require("../../../src/modules/pos/pos.service");

const USER = {
  user_id: "user-77",
  is_ceo: false,
  available_businesses: ["faitlynhair"],
};
const PENDING = {
  recon_id: "recon-1",
  status: "pending",
  amount_ngn: "330800.00",
  provider_reference: "NOMBA-TERM-991",
  webhook_id: "wh-1",
};

beforeEach(() => {
  jest.clearAllMocks();
  repo.findById.mockResolvedValue(PENDING);
  repo.markMatched.mockResolvedValue({
    recon_id: "recon-1",
    status: "matched",
  });
});

describe("pos.match — who confirmed the payment", () => {
  test("stamps the matching staff member onto the order's payment row", async () => {
    await service.match({
      id: "recon-1",
      brand: "faitlynhair",
      order_id: "ord-9",
      user: USER,
      request_id: "req-1",
    });
    expect(webhooksService.recordGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "faitlynhair",
        order_id: "ord-9",
        reference: "NOMBA-TERM-991",
        amount_ngn: "330800.00",
        recorded_by_user_id: "user-77",
      }),
    );
    // Still recorded on the reconciliation row itself, as before.
    expect(repo.markMatched).toHaveBeenCalledWith(
      expect.objectContaining({ matched_by: "user-77" }),
    );
  });

  test("a payment with no provider reference falls back to the recon id", async () => {
    repo.findById.mockResolvedValue({
      ...PENDING,
      provider_reference: null,
    });
    await service.match({
      id: "recon-1",
      brand: "faitlynhair",
      order_id: "ord-9",
      user: USER,
      request_id: "req-1",
    });
    expect(webhooksService.recordGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({ reference: "pos-recon:recon-1" }),
    );
  });

  test("an already-resolved payment is never paid twice", async () => {
    repo.findById.mockResolvedValue({ ...PENDING, status: "matched" });
    await expect(
      service.match({
        id: "recon-1",
        brand: "faitlynhair",
        order_id: "ord-9",
        user: USER,
        request_id: "req-1",
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(webhooksService.recordGatewayPayment).not.toHaveBeenCalled();
  });

  test("a user without access to the brand cannot match into it", async () => {
    await expect(
      service.match({
        id: "recon-1",
        brand: "pixiegirl",
        order_id: "ord-9",
        user: USER,
        request_id: "req-1",
      }),
    ).rejects.toMatchObject({ code: "BRAND_ACCESS_DENIED" });
    expect(webhooksService.recordGatewayPayment).not.toHaveBeenCalled();
  });
});

describe("pos.match — a USD row converts at the chosen order's locked rate", () => {
  const USD_ROW = {
    recon_id: "recon-2",
    status: "pending",
    amount_ngn: "0.00", // parked with no order → no honest Naira figure
    paid_currency: "USD",
    paid_amount: "249.99",
    provider_reference: "nomba-FLH-SO-0200-xyz",
    webhook_id: "wh-2",
  };

  test("credits paid × the order's rate and records the dollars", async () => {
    repo.findById.mockResolvedValue(USD_ROW);
    await service.match({
      id: "recon-2",
      brand: "faitlynhair",
      order_id: "ord-9",
      user: USER,
      request_id: "req-2",
    });
    expect(webhooksService.foreignCaptureCredit).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "USD", paidAmount: "249.99" }),
    );
    expect(webhooksService.recordGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_ngn: "374985.00",
        method: "nomba_online",
        paid_currency: "USD",
        paid_amount: "249.99",
        fx_rate_used: "1500.000000",
        recorded_by_user_id: "user-77",
      }),
    );
  });

  test("an order that can't take it (cancelled, no rate) refuses the match", async () => {
    repo.findById.mockResolvedValue(USD_ROW);
    webhooksService.foreignCaptureCredit.mockResolvedValueOnce({
      park: "USD 249.99 paid on FLH-SO-0200, which is cancelled — refund it.",
    });
    await expect(
      service.match({
        id: "recon-2",
        brand: "faitlynhair",
        order_id: "ord-9",
        user: USER,
        request_id: "req-3",
      }),
    ).rejects.toMatchObject({ code: "CANNOT_MATCH" });
    expect(webhooksService.recordGatewayPayment).not.toHaveBeenCalled();
    expect(repo.markMatched).not.toHaveBeenCalled();
  });
});
