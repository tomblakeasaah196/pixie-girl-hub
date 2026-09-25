"use strict";

/**
 * The "your pre-order has arrived" notice is EMAIL ONLY and manual. It must go
 * straight through the email service (never Comms Studio, which could pick a
 * WhatsApp/IG channel), refuse gracefully when the customer has no email, and
 * stamp the send on the order.
 */

jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findById: jest.fn(),
  markArrivalNotified: jest.fn(),
}));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) => fn({ __fakeClient: true })),
}));
jest.mock("../../../src/services/transactional-email", () => ({
  sendTransactionalEmail: jest.fn(),
}));
jest.mock("../../../src/utils/brand-urls", () => ({
  payLinkUrl: jest.fn(async () => "https://pay.example/abc"),
  publicBaseUrl: jest.fn(async () => "https://shop.example"),
}));
jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn(async () => {}),
}));

const repo = require("../../../src/modules/sales/sales.repo");
const {
  sendTransactionalEmail,
} = require("../../../src/services/transactional-email");
const {
  notifyPreorderArrival,
} = require("../../../src/modules/sales/preorder-arrival.service");

const USER = { user_id: "staff-1" };

beforeEach(() => {
  jest.clearAllMocks();
  repo.markArrivalNotified.mockResolvedValue("2026-09-25T10:00:00.000Z");
  sendTransactionalEmail.mockResolvedValue({ messageId: "m-1" });
});

describe("notifyPreorderArrival — email only", () => {
  it("emails the customer and stamps the send", async () => {
    repo.findById.mockResolvedValue({
      order_id: "o-1",
      order_number: "PXG-SO-1",
      is_preorder: true,
      contact_email: "buyer@example.com",
      contact_name: "Ada Obi",
      public_tracking_token: "tok-1",
    });

    const res = await notifyPreorderArrival({
      brand: "pixiegirl",
      user: USER,
      order_id: "o-1",
    });

    expect(sendTransactionalEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "pixiegirl",
        to: "buyer@example.com",
        subject: expect.stringContaining("PXG-SO-1"),
      }),
    );
    // Greets by first name and links to the tracking/pay link.
    const parts = sendTransactionalEmail.mock.calls[0][0];
    expect(parts.intro).toContain("Ada");
    expect(parts.cta.url).toBe("https://pay.example/abc");
    expect(repo.markArrivalNotified).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: "o-1" }),
    );
    expect(res).toEqual({
      sent: true,
      to: "buyer@example.com",
      notified_at: "2026-09-25T10:00:00.000Z",
    });
  });

  it("refuses when the customer has no email — nothing sent", async () => {
    repo.findById.mockResolvedValue({
      order_id: "o-2",
      order_number: "PXG-SO-2",
      is_preorder: true,
      contact_email: null,
    });

    await expect(
      notifyPreorderArrival({ brand: "pixiegirl", user: USER, order_id: "o-2" }),
    ).rejects.toMatchObject({ code: "NO_CUSTOMER_EMAIL" });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
    expect(repo.markArrivalNotified).not.toHaveBeenCalled();
  });

  it("refuses on an order that was never a pre-order", async () => {
    repo.findById.mockResolvedValue({
      order_id: "o-3",
      order_number: "PXG-SO-3",
      is_preorder: false,
      preorder_fulfilled_at: null,
      preorder_ready_by: null,
      contact_email: "buyer@example.com",
    });

    await expect(
      notifyPreorderArrival({ brand: "pixiegirl", user: USER, order_id: "o-3" }),
    ).rejects.toMatchObject({ code: "NOT_A_PREORDER" });
    expect(sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("still offers the notice after fulfilment (is_preorder already cleared)", async () => {
    repo.findById.mockResolvedValue({
      order_id: "o-4",
      order_number: "PXG-SO-4",
      is_preorder: false,
      preorder_fulfilled_at: "2026-09-20T00:00:00.000Z",
      contact_email: "buyer@example.com",
      contact_name: "Zed",
    });

    const res = await notifyPreorderArrival({
      brand: "pixiegirl",
      user: USER,
      order_id: "o-4",
    });
    expect(res.sent).toBe(true);
    expect(sendTransactionalEmail).toHaveBeenCalledTimes(1);
  });
});
