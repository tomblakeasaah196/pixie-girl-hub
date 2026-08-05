"use strict";

/**
 * A paid order with nothing to draw has to reach a human.
 *
 * markPaid will not fail a payment over missing stock — the gateway already
 * took the money, and throwing would strand the order in pending_payment while
 * the webhook retries. So the deduction is savepointed and the shortfall is
 * flagged on the order instead. Correct.
 *
 * But `order.stock_shortfall` was emitted with NO subscribers. The only trace
 * was a JSON blob in the order's internal notes and a log line, so nobody was
 * told we had taken money for hair we don't have. It surfaced days later, as a
 * stylist assignment that couldn't go through.
 */

jest.mock("../../../src/shared/access/grants.repo", () => ({
  listUsersWithPermission: jest.fn(),
}));
jest.mock("../../../src/services/notifications.service", () => ({
  notify: jest.fn(),
}));
jest.mock("../../../src/modules/kaizen/errors/errors.capture", () => ({
  captureError: jest.fn(),
}));

const grantsRepo = require("../../../src/shared/access/grants.repo");
const notifications = require("../../../src/services/notifications.service");
const {
  captureError,
} = require("../../../src/modules/kaizen/errors/errors.capture");
const {
  onStockShortfall,
} = require("../../../src/modules/sales/stock-shortfall.subscribers");

const PAYLOAD = {
  brand: "faitlynhair",
  order_id: "order-1",
  lines: [{ variant_id: "variant-1", quantity: 1, name: "Lorato Bloom 22\"" }],
};

beforeEach(() => {
  jest.clearAllMocks();
  grantsRepo.listUsersWithPermission.mockResolvedValue([
    { user_id: "ops-1" },
    { user_id: "ops-2" },
  ]);
});

describe("order.stock_shortfall → somebody gets told", () => {
  it("notifies everyone who can actually move stock", async () => {
    await onStockShortfall(PAYLOAD);

    // Resolved from the permission, not a role name — brands rename roles.
    expect(grantsRepo.listUsersWithPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        business: "faitlynhair",
        module: "stock",
        action: "edit",
      }),
    );
    expect(notifications.notify).toHaveBeenCalledTimes(2);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "ops-1",
        priority: "high",
        reference_id: "order-1",
        action_url: "/sales/orders/order-1",
      }),
    );
  });

  it("names the affected hair, so the alert is actionable on its own", async () => {
    await onStockShortfall(PAYLOAD);

    const { body } = notifications.notify.mock.calls[0][0];
    expect(body).toContain('Lorato Bloom 22"');
  });

  it("files it in Kaizen so it lands on a board someone reads", async () => {
    await onStockShortfall(PAYLOAD);

    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      null,
      expect.objectContaining({
        severity: "warning",
        // No HTTP status here at all, so it must bypass the 4xx capture gate.
        force: true,
        context: expect.objectContaining({
          component: "stock shortfall on paid order",
        }),
      }),
    );
  });

  it("ignores an empty or malformed payload rather than alerting on nothing", async () => {
    await onStockShortfall({ brand: "faitlynhair", order_id: "o", lines: [] });
    await onStockShortfall({});
    await onStockShortfall(null);

    expect(notifications.notify).not.toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });

  it("never throws back into the emitter when notifying fails", async () => {
    // The shortfall is already durable on the order; a broken alert path must
    // not take down whatever emitted the event.
    grantsRepo.listUsersWithPermission.mockRejectedValue(new Error("db down"));

    await expect(onStockShortfall(PAYLOAD)).resolves.toBeUndefined();
    // Kaizen still got it — that capture happens before the notify fan-out.
    expect(captureError).toHaveBeenCalled();
  });
});
