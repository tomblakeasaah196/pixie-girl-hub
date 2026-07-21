"use strict";

/**
 * comms-studio.service.getAutomationStates — the lean on/off read the Sales
 * impact modal uses to decide "will send" vs "won't send — it's off". We mock
 * the repo (and the dispatcher/provider deps the service pulls at require time)
 * so the test asserts only the state-mapping logic.
 */

const mockRepo = {
  getAutomationStates: jest.fn(),
};
jest.mock(
  "../../../src/modules/comms_studio/comms-studio.repo",
  () => mockRepo,
);
jest.mock("../../../src/modules/comms_studio/dispatcher", () => ({
  dispatch: jest.fn(),
}));
jest.mock("../../../src/modules/email_campaigns/email-render", () => ({
  resolveBrandTokens: jest.fn(),
}));
jest.mock("../../../src/services/whatsapp.service", () => ({}));
jest.mock("../../../src/services/email.service", () => ({}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));

const service = require("../../../src/modules/comms_studio/comms-studio.service");

const brand = "pixiegirl";

beforeEach(() => jest.clearAllMocks());

describe("getAutomationStates", () => {
  it("reports an active automation as on, with its channel", async () => {
    mockRepo.getAutomationStates.mockResolvedValue([
      { event_key: "order_ready", is_active: true, channel_preference: "whatsapp" },
    ]);
    const states = await service.getAutomationStates({
      brand,
      event_keys: ["order_ready"],
    });
    expect(states).toEqual([
      {
        event_key: "order_ready",
        configured: true,
        is_active: true,
        channel: "whatsapp",
      },
    ]);
  });

  it("reports an explicitly disabled automation as off", async () => {
    mockRepo.getAutomationStates.mockResolvedValue([
      { event_key: "order_shipped", is_active: false, channel_preference: "email" },
    ]);
    const [state] = await service.getAutomationStates({
      brand,
      event_keys: ["order_shipped"],
    });
    expect(state.is_active).toBe(false);
    expect(state.configured).toBe(true);
    expect(state.channel).toBe("email");
  });

  it("reports a missing automation row as not configured and off", async () => {
    mockRepo.getAutomationStates.mockResolvedValue([]);
    const [state] = await service.getAutomationStates({
      brand,
      event_keys: ["order_ready"],
    });
    expect(state).toEqual({
      event_key: "order_ready",
      configured: false,
      is_active: false,
      channel: null,
    });
  });

  it("returns one entry per requested key, in order", async () => {
    mockRepo.getAutomationStates.mockResolvedValue([
      { event_key: "order_shipped", is_active: true, channel_preference: null },
    ]);
    const states = await service.getAutomationStates({
      brand,
      event_keys: ["order_ready", "order_shipped"],
    });
    expect(states.map((s) => s.event_key)).toEqual([
      "order_ready",
      "order_shipped",
    ]);
    expect(states[0].configured).toBe(false); // absent → not configured
    expect(states[1]).toMatchObject({ is_active: true, channel: null });
  });
});
