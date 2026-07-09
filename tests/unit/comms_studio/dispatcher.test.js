"use strict";

/**
 * Communications Studio dispatcher — the central send funnel. We mock the
 * repo, policy resolver, brand tokens, and BullMQ enqueue so the test
 * stays hermetic and asserts only on the dispatcher's behaviour.
 */

jest.mock("../../../src/modules/comms_studio/comms-studio.repo", () => ({
  getAutomation: jest.fn(),
  claimSend: jest.fn(),
  markSendStatus: jest.fn(),
}));
jest.mock("../../../src/modules/outbound_policy/outbound-policy.service", () => ({
  resolveChannel: jest.fn(),
}));
jest.mock("../../../src/modules/email_campaigns/email-render", () => ({
  resolveBrandTokens: jest.fn(async () => ({
    brand_name: "Pixie Girl",
    brand_color: "#690909",
    logo_url: "",
    website_url: "",
    year: "2026",
  })),
}));
jest.mock("../../../src/jobs/queue", () => ({
  enqueue: jest.fn(async () => ({})),
}));
jest.mock("../../../src/config/database", () => ({
  query: jest.fn(async () => ({ rows: [] })),
}));

const repo = require("../../../src/modules/comms_studio/comms-studio.repo");
const policy = require("../../../src/modules/outbound_policy/outbound-policy.service");
const { enqueue } = require("../../../src/jobs/queue");
const { query } = require("../../../src/config/database");
const dispatcher = require("../../../src/modules/comms_studio/dispatcher");

function baseAutomation(overrides = {}) {
  return {
    policy_id: "auto-1",
    business: "pixiegirl",
    event_key: "layaway_reminder",
    channel_preference: "email",
    fallback_channel: null,
    block_whatsapp: false,
    is_active: true,
    display_name: "Layaway Reminder",
    description: "",
    category: "transactional",
    trigger_type: "scheduled",
    cadence_config: {},
    subject_template: "Hello {{first_name}}",
    preheader_template: "",
    email_blocks_json: [
      { type: "heading", text: "Order {{order_number}}" },
    ],
    whatsapp_body_template: "Hi {{first_name}}!",
    instagram_body_template: null,
    variables_schema: [],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("dispatcher.dispatch", () => {
  test("skips when the automation row does not exist", async () => {
    repo.getAutomation.mockResolvedValueOnce(null);
    const r = await dispatcher.dispatch({
      brand: "pixiegirl",
      event_key: "missing",
    });
    expect(r).toEqual({ dispatched: false, reason: "not_configured" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("skips when the automation is disabled", async () => {
    repo.getAutomation.mockResolvedValueOnce(baseAutomation({ is_active: false }));
    const r = await dispatcher.dispatch({
      brand: "pixiegirl",
      event_key: "layaway_reminder",
    });
    expect(r).toEqual({ dispatched: false, reason: "disabled" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("respects the cadence min_amount_paid_ngn gate (₦0.00 layaway bug fix)", async () => {
    repo.getAutomation.mockResolvedValueOnce(
      baseAutomation({ cadence_config: { min_amount_paid_ngn: 1 } }),
    );
    policy.resolveChannel.mockResolvedValueOnce({
      channel: "email",
      reason: "policy_default",
    });
    const r = await dispatcher.dispatch({
      brand: "pixiegirl",
      event_key: "layaway_reminder",
      contact_id: "c-1",
      variables: { amount_paid_ngn_raw: 0 },
    });
    expect(r).toEqual({
      dispatched: false,
      reason: "min_amount_paid_ngn_gate",
    });
    expect(repo.claimSend).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("duplicate dispatch (same dedup key) is a silent no-op", async () => {
    repo.getAutomation.mockResolvedValueOnce(baseAutomation());
    policy.resolveChannel.mockResolvedValueOnce({
      channel: "email",
      reason: "policy_default",
    });
    // claimSend returns null when the dedup key already exists.
    repo.claimSend.mockResolvedValueOnce(null);
    const r = await dispatcher.dispatch({
      brand: "pixiegirl",
      event_key: "layaway_reminder",
      contact_id: "c-1",
      dedup_key: "layaway:1:xyz",
    });
    expect(r).toEqual({
      dispatched: false,
      duplicate: true,
      reason: "already_sent",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("dispatches email through the email-send queue with rendered subject + html", async () => {
    repo.getAutomation.mockResolvedValueOnce(baseAutomation());
    policy.resolveChannel.mockResolvedValueOnce({
      channel: "email",
      reason: "policy_default",
    });
    repo.claimSend.mockResolvedValueOnce({ send_id: "s-1" });
    // Contact lookup returns an email address.
    query.mockResolvedValueOnce({
      rows: [
        {
          contact_id: "c-1",
          first_name: "Adaeze",
          display_name: "Adaeze O",
          email: "ada@example.com",
          primary_phone: "234801",
          whatsapp_number: null,
          preferred_channel: null,
        },
      ],
    });

    const r = await dispatcher.dispatch({
      brand: "pixiegirl",
      event_key: "layaway_reminder",
      contact_id: "c-1",
      variables: { order_number: "FLH-SO-0080" },
    });

    expect(r.dispatched).toBe(true);
    expect(r.channel).toBe("email");
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [queueName, jobName, payload] = enqueue.mock.calls[0];
    expect(queueName).toBe("email-send");
    expect(jobName).toBe("automation:layaway_reminder");
    expect(payload.to).toBe("ada@example.com");
    expect(payload.subject).toBe("Hello Adaeze");
    expect(payload.html).toContain("Order FLH-SO-0080");
    expect(repo.markSendStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent" }),
    );
  });

  test("policy 'disabled' short-circuits without enqueuing", async () => {
    repo.getAutomation.mockResolvedValueOnce(baseAutomation());
    policy.resolveChannel.mockResolvedValueOnce({
      channel: "disabled",
      reason: "contact_do_not_contact",
    });
    const r = await dispatcher.dispatch({
      brand: "pixiegirl",
      event_key: "layaway_reminder",
      contact_id: "c-1",
    });
    expect(r).toEqual({
      dispatched: false,
      channel: "disabled",
      reason: "contact_do_not_contact",
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("routes WhatsApp through the whatsapp-send queue", async () => {
    repo.getAutomation.mockResolvedValueOnce(baseAutomation());
    policy.resolveChannel.mockResolvedValueOnce({
      channel: "whatsapp",
      reason: "policy_default",
    });
    repo.claimSend.mockResolvedValueOnce({ send_id: "s-2" });
    query.mockResolvedValueOnce({
      rows: [
        {
          contact_id: "c-1",
          first_name: "Adaeze",
          display_name: "Adaeze O",
          email: null,
          primary_phone: "234801",
          whatsapp_number: "234801",
        },
      ],
    });

    const r = await dispatcher.dispatch({
      brand: "pixiegirl",
      event_key: "layaway_reminder",
      contact_id: "c-1",
    });

    expect(r.dispatched).toBe(true);
    expect(r.channel).toBe("whatsapp");
    const [queueName, , payload] = enqueue.mock.calls[0];
    expect(queueName).toBe("whatsapp-send");
    expect(payload.to).toBe("234801");
    expect(payload.body).toBe("Hi Adaeze!");
  });
});

describe("dispatcher.defaultDedupKey", () => {
  test("birthday_wish keys by year + contact for once-per-year semantics", () => {
    const key = dispatcher.defaultDedupKey({
      event_key: "birthday_wish",
      contact_id: "c-1",
      variables: {},
    });
    expect(key).toMatch(/^birthday-\d{4}-c-1$/);
  });
});
