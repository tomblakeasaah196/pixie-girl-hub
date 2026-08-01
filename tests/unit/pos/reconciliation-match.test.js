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
}));
jest.mock("../../../src/modules/business_setup/webhooks.service", () => ({
  recordGatewayPayment: jest.fn(async () => {}),
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
