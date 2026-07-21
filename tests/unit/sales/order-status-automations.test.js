"use strict";

/**
 * order-comms — the manual-move → customer-automation map, and forStatus().
 *
 * This map is the single source of truth shared by two call sites:
 *   • sales.service.setOrderStatus (what actually fires on a move)
 *   • sales.service.getStatusAutomationStates (what the impact modal promises)
 * so the test locks the mapping and proves forStatus dispatches exactly the
 * mapped event — and nothing for a stage with no message.
 */

const mockDispatch = jest.fn(async () => ({ dispatched: true }));
jest.mock(
  "../../../src/modules/comms_studio/comms-studio.service",
  () => ({ dispatch: mockDispatch }),
);
jest.mock("../../../src/utils/brand-urls", () => ({
  payLinkUrl: jest.fn(async () => "https://pay.example/abc"),
  publicBaseUrl: jest.fn(async () => "https://shop.example"),
}));

const orderComms = require("../../../src/modules/sales/order-comms");

const brand = "pixiegirl";
const order = {
  order_id: "ord-1",
  order_number: "PXG-1001",
  contact_id: "contact-1",
  public_tracking_token: "tok-1",
};

beforeEach(() => jest.clearAllMocks());

describe("MANUAL_STATUS_EVENT map", () => {
  it("maps the two message-bearing fulfilment moves", () => {
    expect(orderComms.MANUAL_STATUS_EVENT).toEqual({
      order_ready: "order_ready",
      dispatched: "order_shipped",
    });
  });

  it("has no entry for stages that send nothing", () => {
    expect(orderComms.MANUAL_STATUS_EVENT.assigned).toBeUndefined();
    expect(orderComms.MANUAL_STATUS_EVENT.completed).toBeUndefined();
  });
});

describe("forStatus", () => {
  it("dispatches the order_ready automation on an Order Ready move", async () => {
    await orderComms.forStatus({ brand, order, status: "order_ready" });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ brand, event_key: "order_ready" }),
    );
  });

  it("dispatches the order_shipped automation on a Dispatched move", async () => {
    await orderComms.forStatus({ brand, order, status: "dispatched" });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ brand, event_key: "order_shipped" }),
    );
  });

  it("is a no-op for a stage with no customer message", async () => {
    await orderComms.forStatus({ brand, order, status: "assigned" });
    await orderComms.forStatus({ brand, order, status: "completed" });
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
